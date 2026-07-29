import { z } from "zod";
import { createRouter, adminQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { eventos } from "@db/schema";
import { eq, and, gte, lte, isNull, isNotNull, inArray, desc } from "drizzle-orm";
import { GeminiProvider } from "../lib/geminiProvider";
import { validarRespuesta } from "../lib/iaValidador";
import { resolverVentana, calcularEmbudo, conLeadId } from "./event";
import { ANOMALIA_CONFIG, type TipoAnomaliaTiempo } from "../lib/anomaliaConfig";

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

type AnomaliaTiempoPayload = {
  tipo_anomalia: string;
  atribuible_a: string;
  setter_id: number | null;
  horas_transcurridas: number;
  umbral_horas: number;
  desde: string;
};

const MAX_ANOMALIAS_TIEMPO = 40;

// A diferencia del evento guardado (que puede tener dias de antiguedad),
// esto recalcula si la anomalia sigue vigente: el lead tiene que seguir en
// la etapa que la origino y no estar descartado -- si ya avanzo o se
// descarto, no es una accion pendiente hoy. horas_transcurridas se
// recalcula contra el `desde` guardado; umbral_horas se reusa tal cual
// (no cambia con el tiempo). No toca anomalia.ts -- es una query de
// lectura nueva, la deteccion/escritura sigue siendo la unica duena de
// ese archivo.
async function obtenerAnomaliasTiempoActivas(db: ReturnType<typeof getDb>) {
  const eventosTiempo = await db.query.eventos.findMany({
    where: and(eq(eventos.tipo, "ANOMALIA_DETECTADA"), isNotNull(eventos.leadId)),
  });
  if (eventosTiempo.length === 0) return [];

  const leadIds = [...new Set(eventosTiempo.map((e) => e.leadId as number))];
  const [cambios, descartes] = await Promise.all([
    db.query.eventos.findMany({
      where: and(inArray(eventos.leadId, leadIds), eq(eventos.tipo, "ESTADO_CAMBIADO")),
      orderBy: [desc(eventos.timestamp), desc(eventos.id)],
    }),
    db.query.eventos.findMany({
      where: and(inArray(eventos.leadId, leadIds), eq(eventos.tipo, "LEAD_DESCARTADO")),
    }),
  ]);

  const etapaPorLead = new Map<number, string>();
  for (const ev of cambios) {
    const leadId = ev.leadId as number;
    if (!etapaPorLead.has(leadId)) {
      etapaPorLead.set(leadId, (ev.payload as { estado_nuevo: string }).estado_nuevo);
    }
  }
  const descartados = new Set(descartes.map((d) => d.leadId as number));

  const ahora = new Date();
  const activas: {
    lead_id: number;
    tipo_anomalia: string;
    setter_id: number | null;
    atribuible_a: string;
    horas_transcurridas: number;
    umbral_horas: number;
  }[] = [];

  for (const ev of eventosTiempo) {
    const leadId = ev.leadId as number;
    if (descartados.has(leadId)) continue;

    const payload = ev.payload as AnomaliaTiempoPayload;
    const cfg = ANOMALIA_CONFIG.tiempo[payload.tipo_anomalia as TipoAnomaliaTiempo] as
      | (typeof ANOMALIA_CONFIG.tiempo)[TipoAnomaliaTiempo]
      | undefined;
    if (!cfg || etapaPorLead.get(leadId) !== cfg.etapaOrigen) continue;

    const desde = new Date(payload.desde);
    const horasTranscurridasAhora = (ahora.getTime() - desde.getTime()) / 3_600_000;
    activas.push({
      lead_id: leadId,
      tipo_anomalia: payload.tipo_anomalia,
      setter_id: payload.setter_id,
      atribuible_a: payload.atribuible_a,
      horas_transcurridas: Math.round(horasTranscurridasAhora * 10) / 10,
      umbral_horas: payload.umbral_horas,
    });
  }

  activas.sort((a, b) => b.horas_transcurridas - b.umbral_horas - (a.horas_transcurridas - a.umbral_horas));
  return activas.slice(0, MAX_ANOMALIAS_TIEMPO);
}

// Limitacion aceptada (docs/99_deuda_tecnica.md): usa el ultimo evento
// registrado por (tipo_anomalia, setter_id/EQUIPO) sin re-verificar si la
// tasa sigue anomala ahora mismo -- eso requeriria reprocesar todo el
// historial de conversion en cada consulta de IA. Prototipo liviano, no
// infraestructura de re-calculo en tiempo real.
async function obtenerAnomaliasConversionRecientes(db: ReturnType<typeof getDb>) {
  const eventosConversion = await db.query.eventos.findMany({
    where: and(eq(eventos.tipo, "ANOMALIA_DETECTADA"), isNull(eventos.leadId)),
    orderBy: [desc(eventos.timestamp), desc(eventos.id)],
  });

  const vistos = new Set<string>();
  const recientes: ReturnType<typeof construirContextoConversion>[] = [];
  for (const ev of eventosConversion) {
    const payload = ev.payload as AnomaliaConversionPayload;
    const clave = `${payload.tipo_anomalia}:${payload.setter_id ?? "EQUIPO"}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    recientes.push(construirContextoConversion(payload));
  }
  return recientes;
}

async function obtenerKpisMesActual(db: ReturnType<typeof getDb>) {
  const ventana = resolverVentana("mensual");
  const condiciones = [eq(eventos.tipo, "ESTADO_CAMBIADO"), lte(eventos.timestamp, ventana.hasta)];
  if (ventana.desde) condiciones.push(gte(eventos.timestamp, ventana.desde));

  const cambios = conLeadId(await db.query.eventos.findMany({ where: and(...condiciones) }));
  const embudo = calcularEmbudo(cambios);

  const { MSR_BAJO, PRR_BAJO, CSR_BAJO } = ANOMALIA_CONFIG.conversion;
  return {
    MSR: { actual: embudo.tasas.MSR, umbral_anomalia: MSR_BAJO.umbral, objetivo: MSR_BAJO.objetivo },
    PRR: { actual: embudo.tasas.PRR, umbral_anomalia: PRR_BAJO.umbral, objetivo: PRR_BAJO.objetivo },
    CSR: { actual: embudo.tasas.CSR, umbral_anomalia: CSR_BAJO.umbral, objetivo: CSR_BAJO.objetivo },
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

  // Tercera funcionalidad de docs/10_arquitectura_ia.md seccion 8 (#2).
  // Sin input -- siempre es "hoy".
  top3AccionesDelDia: adminQuery.mutation(async () => {
    const db = getDb();
    const [anomaliasTiempo, anomaliasConversion, kpis] = await Promise.all([
      obtenerAnomaliasTiempoActivas(db),
      obtenerAnomaliasConversionRecientes(db),
      obtenerKpisMesActual(db),
    ]);

    const contexto = {
      anomalias_tiempo_activas: anomaliasTiempo,
      anomalias_conversion_recientes: anomaliasConversion,
      kpis_mes_actual: kpis,
    };
    const contextoJSON = JSON.stringify(contexto);

    const provider = new GeminiProvider();
    const respuesta = await provider.completar(
      PROMPT_SISTEMA_BASE,
      contextoJSON,
      "Con base unicamente en el contexto, identifica las 3 acciones mas prioritarias para el administrador hoy. " +
        "Para cada una, indica en que dato del contexto se basa (un lead_id, un setter_id, o un KPI puntual). Si no " +
        "hay suficiente informacion para priorizar 3, da menos.",
      0.4,
    );

    const { advertencia } = validarRespuesta(respuesta, contexto);

    return { respuesta, advertencia };
  }),
});
