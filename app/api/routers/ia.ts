import { z } from "zod";
import { createRouter, adminQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { eventos } from "@db/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { GeminiProvider } from "../lib/geminiProvider";
import { validarRespuesta } from "../lib/iaValidador";
import { resolverVentana } from "./event";

const TIPOS_CONVERSION = ["MSR_BAJO", "PRR_BAJO", "CSR_BAJO"] as const;

// Taxonomia cerrada de OBJECION_REGISTRADA -- docs/03_catalogo_eventos.md
// evento 6. Redefinida aca (no exportada desde event.ts hoy) porque es la
// unica funcionalidad de IA que la necesita.
const TIPOS_OBJECION = [
  "PRECIO",
  "DESCONFIANZA",
  "TIEMPO",
  "EXPERIENCIA_PREVIA_SIMILAR",
  "YA_TIENE_PROVEEDOR",
  "YA_PAGO_MENTOR",
  "OTRA",
] as const;

// docs/10_arquitectura_ia.md seccion 6, punto 2 -- instruccion anti-
// alucinacion explicita y no negociable, comun a toda funcionalidad de IA.
// Constante de codigo (seccion 10: "los prompts son constantes de codigo",
// no hay tabla de prompts en V1).
const PROMPT_SISTEMA_BASE =
  "Sos un asistente de analisis para el administrador de una agencia de ventas (OPERAL OS). " +
  "Solo podes usar los numeros que aparecen en el JSON de contexto que se te da -- nunca inventes " +
  "una tasa, un conteo o un umbral que no este ahi. Si falta un dato para responder con precision, " +
  "decilo explicitamente en vez de estimarlo. No sugieras acciones automaticas ni ejecutables: tu " +
  "respuesta es solo lectura, la decide y ejecuta un humano. Responde en espanol, en un parrafo breve.";

type AnomaliaConversionPayload = {
  tipo_anomalia: string;
  nivel: "SETTER" | "EQUIPO";
  setter_id: number | null;
  tasa_medida: number | null;
  umbral_anomalia: number;
  objetivo: number | null;
  numerador: number;
  denominador: number;
};

// ContextBuilder puro -- docs/10_arquitectura_ia.md seccion 5. Arma
// exactamente los campos que esta pregunta necesita, nunca nombre/
// instagram/email de nadie (seccion 3) -- ni siquiera los selecciona.
export function construirContextoConversion(payload: AnomaliaConversionPayload) {
  return {
    tipo_anomalia: payload.tipo_anomalia,
    nivel: payload.nivel,
    setter_id: payload.setter_id,
    tasa_medida: payload.tasa_medida,
    umbral_anomalia: payload.umbral_anomalia,
    objetivo: payload.objetivo,
    numerador: payload.numerador,
    denominador: payload.denominador,
  };
}

type ObjecionPayload = { tipo: string; detalle?: string; es_nueva?: boolean };

const MAX_MUESTRA_DETALLE = 30;

// ContextBuilder puro -- docs/10_arquitectura_ia.md seccion 5. Sin lead_id
// ni nombre de nadie: es un agregado de equipo, la pregunta no necesita
// identificar de que lead vino cada objecion. Excepcion documentada
// (seccion 3, nota agregada en este commit): `detalle` es texto libre
// escrito por el setter y puede mencionar incidentalmente un nombre --
// no se sanitiza con regex fragil, es una limitacion aceptada.
export function construirContextoObjeciones(objeciones: { payload: unknown }[], periodo: string) {
  const conteo_por_tipo: Record<string, number> = {};
  for (const t of TIPOS_OBJECION) conteo_por_tipo[t] = 0;

  const muestra_detalle: { tipo: string; detalle: string }[] = [];
  for (const ev of objeciones) {
    const p = ev.payload as ObjecionPayload;
    if (p.tipo in conteo_por_tipo) conteo_por_tipo[p.tipo]++;
    if (p.detalle && muestra_detalle.length < MAX_MUESTRA_DETALLE) {
      muestra_detalle.push({ tipo: p.tipo, detalle: p.detalle });
    }
  }

  const total = objeciones.length;
  const porcentaje_por_tipo: Record<string, number> = {};
  for (const t of TIPOS_OBJECION) {
    porcentaje_por_tipo[t] = total > 0 ? conteo_por_tipo[t] / total : 0;
  }

  return { periodo, total, conteo_por_tipo, porcentaje_por_tipo, muestra_detalle };
}

export const iaRouter = createRouter({
  // Primera funcionalidad de docs/10_arquitectura_ia.md seccion 8 (#1) --
  // mutation, no query: llama a un proveedor externo de pago con cada
  // invocacion, no es idempotente ni gratis, no debe dispararse por
  // refetch-on-focus/refetch-on-mount de react-query.
  explicarAnomaliaConversion: adminQuery
    .input(z.object({ anomaliaId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const evento = await db.query.eventos.findFirst({
        where: eq(eventos.id, input.anomaliaId),
      });
      if (!evento || evento.tipo !== "ANOMALIA_DETECTADA") {
        throw new Error("El id no corresponde a un evento ANOMALIA_DETECTADA.");
      }

      const payload = evento.payload as AnomaliaConversionPayload;
      if (!TIPOS_CONVERSION.includes(payload.tipo_anomalia as (typeof TIPOS_CONVERSION)[number])) {
        throw new Error(
          `Esta funcionalidad solo explica anomalias de conversion (${TIPOS_CONVERSION.join(", ")}). Recibido: ${payload.tipo_anomalia}.`,
        );
      }

      const contexto = construirContextoConversion(payload);
      const contextoJSON = JSON.stringify(contexto);

      const provider = new GeminiProvider();
      const respuesta = await provider.completar(
        PROMPT_SISTEMA_BASE,
        contextoJSON,
        "Explica en un parrafo breve por que esta tasa de conversion esta anomala, en base unicamente a los datos del contexto.",
        0.2,
      );

      const { advertencia } = validarRespuesta(respuesta, contexto);

      return { respuesta, advertencia };
    }),

  // Segunda funcionalidad de docs/10_arquitectura_ia.md seccion 8 (#3).
  resumirObjeciones: adminQuery
    .input(
      z.object({
        periodo: z.enum(["lifetime", "mensual", "trimestral", "semestral", "anual", "rango"]),
        desde: z.coerce.date().optional(),
        hasta: z.coerce.date().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const ventana = resolverVentana(input.periodo, input.desde, input.hasta);

      const condiciones = [eq(eventos.tipo, "OBJECION_REGISTRADA"), lte(eventos.timestamp, ventana.hasta)];
      if (ventana.desde) condiciones.push(gte(eventos.timestamp, ventana.desde));

      const objeciones = await db.query.eventos.findMany({ where: and(...condiciones) });

      const contexto = construirContextoObjeciones(objeciones, input.periodo);
      const contextoJSON = JSON.stringify(contexto);

      const provider = new GeminiProvider();
      const respuesta = await provider.completar(
        PROMPT_SISTEMA_BASE,
        contextoJSON,
        "Con base unicamente en el contexto: (1) cuales son las objeciones mas frecuentes, (2) que patrones hay en los " +
          "ejemplos de texto libre de muestra_detalle, y (3) que sugiere esto para mejorar el guion de ventas. Si total " +
          "es 0, decilo explicitamente y no inventes patrones.",
        0.3,
      );

      const { advertencia } = validarRespuesta(respuesta, contexto);

      return { respuesta, advertencia };
    }),
});
