import { z } from "zod";
import { createRouter, adminQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { eventos } from "@db/schema";
import { eq, and, gte, lte, isNull, isNotNull, inArray, desc } from "drizzle-orm";
import { GeminiProvider } from "../lib/geminiProvider";
import { validarRespuesta } from "../lib/iaValidador";
import { resolverVentana, calcularEmbudo, conLeadId } from "./event";
import { ANOMALIA_CONFIG, type TipoAnomaliaTiempo } from "@contracts/anomaliaConfig";

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
  "respuesta es solo lectura, la decide y ejecuta un humano. Responde en espanol, en un parrafo breve. " +
  "No uses separador de miles en los numeros (escribi 1601, nunca 1.601 ni 1,601) -- se necesita poder " +
  "verificar cada numero contra el contexto de forma automatica.";

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

const TRANSICIONES_CLAVE = ["A_a_MS", "MS_a_B", "B_a_C", "C_a_D"] as const;
type TiemposEntreEtapas = Record<(typeof TRANSICIONES_CLAVE)[number], number | null> & { en_etapa_actual: number | null };

// Funcion pura nueva -- no existia una version por-lead de esto (el motor
// de anomalias solo necesita "tiempo desde la ultima transicion", no el
// desglose completo). Recorre los ESTADO_CAMBIADO de UN lead ya ordenados
// cronologicamente y calcula el delta entre cada transicion consecutiva;
// `en_etapa_actual` es el tramo abierto desde la ultima transicion hasta
// `hastaFinal` (el descarte, o ahora si sigue activo).
export function calcularTiemposEntreEtapas(
  cambiosOrdenados: { timestamp: Date; payload: unknown }[],
  hastaFinal: Date,
): TiemposEntreEtapas {
  const resultado: TiemposEntreEtapas = {
    A_a_MS: null,
    MS_a_B: null,
    B_a_C: null,
    C_a_D: null,
    en_etapa_actual: null,
  };
  if (cambiosOrdenados.length === 0) return resultado;

  for (let i = 1; i < cambiosOrdenados.length; i++) {
    const anterior = (cambiosOrdenados[i - 1].payload as { estado_nuevo: string }).estado_nuevo;
    const actual = (cambiosOrdenados[i].payload as { estado_nuevo: string }).estado_nuevo;
    const clave = `${anterior}_a_${actual}` as (typeof TRANSICIONES_CLAVE)[number];
    if (TRANSICIONES_CLAVE.includes(clave)) {
      const horas = (cambiosOrdenados[i].timestamp.getTime() - cambiosOrdenados[i - 1].timestamp.getTime()) / 3_600_000;
      resultado[clave] = Math.round(horas * 10) / 10;
    }
  }

  const ultimo = cambiosOrdenados[cambiosOrdenados.length - 1];
  const horasEnEtapaActual = (hastaFinal.getTime() - ultimo.timestamp.getTime()) / 3_600_000;
  resultado.en_etapa_actual = Math.round(horasEnEtapaActual * 10) / 10;

  return resultado;
}

const UMBRAL_AGREGACION = 30;
const ETAPAS_POSIBLES = ["A", "MS", "B", "C", "D", "Sin etapa"] as const;
const ORIGENES_POSIBLES = ["SCRAPING", "MANUAL", "RPP"] as const;

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

  // Cuarta funcionalidad de docs/10_arquitectura_ia.md seccion 8 (#4).
  // Umbral de 30 (acordado con el usuario, doc sugiere 20-30): por debajo
  // se manda una fila por lead, por encima se agrega por segmento -- nunca
  // se trunca en silencio, el alcance "descartados" no tiene limite de
  // query (el filtro define la poblacion).
  analizarLeads: adminQuery
    .input(
      z.object({
        alcance: z.enum(["recientes", "descartados"]),
        limite: z.number().min(1).max(500).default(50),
        motivoDescarte: z.string().optional(),
        desde: z.coerce.date().optional(),
        hasta: z.coerce.date().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();

      let leadIds: number[];
      if (input.alcance === "recientes") {
        const creaciones = await db.query.eventos.findMany({
          where: eq(eventos.tipo, "LEAD_CREADO"),
          orderBy: [desc(eventos.timestamp), desc(eventos.id)],
          limit: input.limite,
        });
        leadIds = creaciones.map((e) => e.leadId as number);
      } else {
        const condiciones = [eq(eventos.tipo, "LEAD_DESCARTADO")];
        if (input.desde) condiciones.push(gte(eventos.timestamp, input.desde));
        if (input.hasta) condiciones.push(lte(eventos.timestamp, input.hasta));
        const descartes = await db.query.eventos.findMany({ where: and(...condiciones) });
        leadIds = descartes
          .filter((e) => !input.motivoDescarte || (e.payload as { motivo: string }).motivo === input.motivoDescarte)
          .map((e) => e.leadId as number);
      }

      if (leadIds.length === 0) {
        throw new Error("No hay leads que coincidan con el alcance pedido.");
      }

      const [cambios, creaciones, descartesTodos, seguimientos] = await Promise.all([
        db.query.eventos.findMany({ where: and(inArray(eventos.leadId, leadIds), eq(eventos.tipo, "ESTADO_CAMBIADO")) }),
        db.query.eventos.findMany({ where: and(inArray(eventos.leadId, leadIds), eq(eventos.tipo, "LEAD_CREADO")) }),
        db.query.eventos.findMany({ where: and(inArray(eventos.leadId, leadIds), eq(eventos.tipo, "LEAD_DESCARTADO")) }),
        db.query.eventos.findMany({ where: and(inArray(eventos.leadId, leadIds), eq(eventos.tipo, "SEGUIMIENTO_ENVIADO")) }),
      ]);

      const cambiosPorLead = new Map<number, { timestamp: Date; id: number; payload: unknown }[]>();
      for (const ev of cambios) {
        const id = ev.leadId as number;
        const lista = cambiosPorLead.get(id);
        if (lista) lista.push(ev);
        else cambiosPorLead.set(id, [ev]);
      }
      for (const lista of cambiosPorLead.values()) {
        lista.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime() || a.id - b.id);
      }

      const origenPorLead = new Map<number, string>();
      for (const ev of creaciones) origenPorLead.set(ev.leadId as number, (ev.payload as { origen: string }).origen);

      const descartePorLead = new Map<number, { motivo: string; timestamp: Date }>();
      for (const ev of descartesTodos) {
        const id = ev.leadId as number;
        if (!descartePorLead.has(id)) {
          descartePorLead.set(id, { motivo: (ev.payload as { motivo: string }).motivo, timestamp: ev.timestamp });
        }
      }

      const seguimientosPorLead = new Map<number, number>();
      for (const ev of seguimientos) {
        const id = ev.leadId as number;
        seguimientosPorLead.set(id, (seguimientosPorLead.get(id) ?? 0) + 1);
      }

      const etapaAlcanzada = (id: number): (typeof ETAPAS_POSIBLES)[number] => {
        const cambiosLead = cambiosPorLead.get(id);
        if (!cambiosLead || cambiosLead.length === 0) return "Sin etapa";
        return (cambiosLead[cambiosLead.length - 1].payload as { estado_nuevo: string }).estado_nuevo as (typeof ETAPAS_POSIBLES)[number];
      };

      let contexto: Record<string, unknown>;

      if (leadIds.length > UMBRAL_AGREGACION) {
        const porEtapa: Record<string, number> = Object.fromEntries(ETAPAS_POSIBLES.map((e) => [e, 0]));
        const porOrigen: Record<string, number> = Object.fromEntries(ORIGENES_POSIBLES.map((o) => [o, 0]));
        let totalSeguimientos = 0;
        for (const id of leadIds) {
          porEtapa[etapaAlcanzada(id)]++;
          const origen = origenPorLead.get(id);
          if (origen && origen in porOrigen) porOrigen[origen]++;
          totalSeguimientos += seguimientosPorLead.get(id) ?? 0;
        }
        contexto = {
          alcance: input.alcance,
          motivo_filtro: input.motivoDescarte ?? null,
          total: leadIds.length,
          por_etapa_alcanzada: porEtapa,
          por_origen: porOrigen,
          promedio_seguimientos: Math.round((totalSeguimientos / leadIds.length) * 10) / 10,
        };
      } else {
        const leads = leadIds.map((id) => {
          const cambiosLead = cambiosPorLead.get(id) ?? [];
          const descarte = descartePorLead.get(id);
          const hastaFinal = descarte ? descarte.timestamp : new Date();
          return {
            lead_id: id,
            etapa_alcanzada: etapaAlcanzada(id),
            origen: origenPorLead.get(id) ?? null,
            seguimientos: seguimientosPorLead.get(id) ?? 0,
            motivo_descarte: descarte?.motivo ?? null,
            tiempos_horas: calcularTiemposEntreEtapas(cambiosLead, hastaFinal),
          };
        });
        contexto = {
          alcance: input.alcance,
          motivo_filtro: input.motivoDescarte ?? null,
          total: leadIds.length,
          leads,
        };
      }

      const contextoJSON = JSON.stringify(contexto);

      const provider = new GeminiProvider();
      const respuesta = await provider.completar(
        PROMPT_SISTEMA_BASE,
        contextoJSON,
        "Con base unicamente en el contexto, identifica patrones: en que etapa se caen mas estos leads, y (si el " +
          "contexto trae leads individuales) que diferencia a los que avanzaron mas de los que no. Si el contexto es " +
          "agregado (no hay un array 'leads'), respondé sobre las distribuciones que ves.",
        0.3,
      );

      const { advertencia } = validarRespuesta(respuesta, contexto);

      return { respuesta, advertencia, modo: leadIds.length > UMBRAL_AGREGACION ? "agregado" : "individual" };
    }),
});
