import { z } from "zod";
import { createRouter, adminQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { eventos } from "@db/schema";
import { eq } from "drizzle-orm";
import { GeminiProvider } from "../lib/geminiProvider";
import { validarRespuesta } from "../lib/iaValidador";

const TIPOS_CONVERSION = ["MSR_BAJO", "PRR_BAJO", "CSR_BAJO"] as const;

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
});
