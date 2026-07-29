import { z } from "zod";
import { createRouter, adminQuery, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { eventos, users } from "@db/schema";
import { eq, and, desc, gte, inArray, sql } from "drizzle-orm";
import { ANOMALIA_CONFIG, type TipoAnomaliaConversion, type TipoAnomaliaTiempo } from "../lib/anomaliaConfig";
import { obtenerSetterActual, construirAsignacionPorSetter } from "./event";
import { obtenerCalendarVigente } from "./calendar";

// ─── Anomalias de tiempo (lead individual) ───────────────────────────────
// Funcion pura: sin acceso a DB, mismo espiritu que validarTransicion
// (event.ts). "deadline" ya viene resuelto por el llamador (desde + umbral
// fijo, o la fecha de la llamada para TIEMPO_C_D) -- esta funcion solo
// compara contra "ahora".
export function detectarAnomaliaTiempo(desde: Date, ahora: Date, deadline: Date) {
  const horasTranscurridas = (ahora.getTime() - desde.getTime()) / 3_600_000;
  const umbralHoras = (deadline.getTime() - desde.getTime()) / 3_600_000;
  return { esAnomalia: ahora.getTime() > deadline.getTime(), horasTranscurridas, umbralHoras };
}

// ─── Anomalias de conversion (setter/equipo) ─────────────────────────────
// Idempotencia por borde (docs/02_reglas_de_negocio (1).md seccion 9,
// docs/03_catalogo_eventos.md evento 14): un barrido hacia adelante sobre el
// historial ordenado, no una comparacion contra el ultimo evento nada mas --
// eso no es robusto si entran varios eventos relevantes entre corridas (ver
// plan tecnico). Encuentra "inicioStreak": el evento que arranco la racha
// anomala VIGENTE (null si en este momento no es anomalo, o si la racha
// vigente arranca en el primer evento de la lista y por lo tanto no hay
// "antes" que comparar -- ese caso igual queda cubierto: inicioStreak apunta
// a ese primer evento).
export type EventoConversion = { estadoNuevo: string; timestamp: Date; id: number };

export function detectarTransicionConversion(
  eventosOrdenados: EventoConversion[],
  config: { origen: string; destino: string; umbral: number; piso: number },
) {
  let numerador = 0;
  let denominador = 0;
  let anomalousPrev = false;
  let inicioStreak: { timestamp: Date; id: number } | null = null;

  for (const ev of eventosOrdenados) {
    if (ev.estadoNuevo === config.origen) denominador++;
    else if (ev.estadoNuevo === config.destino) numerador++;

    const anomalousNow = denominador >= config.piso && numerador / denominador < config.umbral;
    if (anomalousNow && !anomalousPrev) inicioStreak = { timestamp: ev.timestamp, id: ev.id };
    if (!anomalousNow) inicioStreak = null;
    anomalousPrev = anomalousNow;
  }

  return {
    anomaloAhora: anomalousPrev,
    inicioStreak,
    numerador,
    denominador,
    tasaMedida: denominador > 0 ? numerador / denominador : null,
  };
}

// Filtra los eventos relevantes para una transicion (origen/destino) y los
// ordena cronologicamente ascendente (timestamp, desempate por id) -- entrada
// del algoritmo de arriba.
function ordenarParaConversion(
  entradas: { timestamp: Date; id: number; payload: unknown }[],
  origen: string,
  destino: string,
): EventoConversion[] {
  return entradas
    .map((e) => ({ estadoNuevo: (e.payload as { estado_nuevo: string }).estado_nuevo, timestamp: e.timestamp, id: e.id }))
    .filter((e) => e.estadoNuevo === origen || e.estadoNuevo === destino)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime() || a.id - b.id);
}

type ConfigConversion = { origen: string; destino: string; umbral: number; objetivo: number | null; nivel: "SETTER" | "EQUIPO" };

// Orquestacion (con acceso a DB) de una sola transicion de conversion:
// corre el algoritmo puro, y si hay una racha anomala vigente sin registrar
// todavia, inserta ANOMALIA_DETECTADA. setterId null = nivel EQUIPO (CSR).
async function procesarConversion(
  db: ReturnType<typeof getDb>,
  tipoAnomalia: TipoAnomaliaConversion,
  setterId: number | null,
  eventosOrdenados: EventoConversion[],
  cfg: ConfigConversion,
): Promise<number> {
  const resultado = detectarTransicionConversion(eventosOrdenados, {
    origen: cfg.origen,
    destino: cfg.destino,
    umbral: cfg.umbral,
    piso: ANOMALIA_CONFIG.pisoLeadsContactados,
  });
  if (!resultado.anomaloAhora || !resultado.inicioStreak) return 0;

  const condiciones = [
    eq(eventos.tipo, "ANOMALIA_DETECTADA"),
    sql`${eventos.payload}->>'$.tipo_anomalia' = ${tipoAnomalia}`,
    gte(eventos.timestamp, resultado.inicioStreak.timestamp),
  ];
  if (setterId !== null) {
    condiciones.push(sql`CAST(${eventos.payload}->>'$.setter_id' AS UNSIGNED) = ${setterId}`);
  }
  const existente = await db.query.eventos.findFirst({ where: and(...condiciones) });
  if (existente) return 0;

  await db.insert(eventos).values({
    tipo: "ANOMALIA_DETECTADA" as any,
    leadId: null,
    actorTipo: "SISTEMA",
    actorId: null,
    payload: {
      tipo_anomalia: tipoAnomalia,
      nivel: cfg.nivel,
      setter_id: setterId,
      tasa_medida: resultado.tasaMedida,
      umbral_anomalia: cfg.umbral,
      objetivo: cfg.objetivo,
      numerador: resultado.numerador,
      denominador: resultado.denominador,
    },
  } as any);
  return 1;
}

export async function evaluarAnomaliasDeConversion(db: ReturnType<typeof getDb>): Promise<number> {
  let insertadas = 0;

  const cambiosEstado = await db.query.eventos.findMany({
    where: eq(eventos.tipo, "ESTADO_CAMBIADO"),
  });
  const cambiosConLead = cambiosEstado.filter(
    (e): e is typeof e & { leadId: number } => e.leadId !== null,
  );

  // CSR (equipo): universo completo de ESTADO_CAMBIADO, sin particion por
  // setter -- es la unica de las tres que se evalua a nivel de equipo (ver
  // 02_reglas_de_negocio.md seccion 9).
  const csrCfg = ANOMALIA_CONFIG.conversion.CSR_BAJO;
  const eventosCsr = ordenarParaConversion(cambiosConLead, csrCfg.origen, csrCfg.destino);
  insertadas += await procesarConversion(db, "CSR_BAJO", null, eventosCsr, csrCfg);

  // MSR/PRR (por setter): atribucion por intervalo de tiempo (mismo criterio
  // que embudoPorSetter, Sprint 3) -- un ESTADO_CAMBIADO se atribuye a quien
  // tenia el lead asignado en ese instante, no al dueno actual.
  const [asignaciones, setters] = await Promise.all([
    db.query.eventos.findMany({ where: eq(eventos.tipo, "LEAD_ASIGNADO") }),
    db.query.users.findMany({ where: eq(users.rol, "SETTER"), columns: { id: true } }),
  ]);
  const asignacionesConLead = asignaciones.filter(
    (e): e is typeof e & { leadId: number } => e.leadId !== null,
  );
  const eventosPorSetter = construirAsignacionPorSetter(cambiosConLead, asignacionesConLead);

  const tiposSetter: [TipoAnomaliaConversion, ConfigConversion][] = [
    ["MSR_BAJO", ANOMALIA_CONFIG.conversion.MSR_BAJO],
    ["PRR_BAJO", ANOMALIA_CONFIG.conversion.PRR_BAJO],
  ];

  for (const setter of setters) {
    const entradas = eventosPorSetter.get(setter.id) ?? [];
    for (const [tipoAnomalia, cfg] of tiposSetter) {
      const eventosFiltrados = ordenarParaConversion(entradas, cfg.origen, cfg.destino);
      insertadas += await procesarConversion(db, tipoAnomalia, setter.id, eventosFiltrados, cfg);
    }
  }

  return insertadas;
}

// ─── Anomalias de tiempo: orquestacion ───────────────────────────────────
export async function evaluarAnomaliasDeTiempo(db: ReturnType<typeof getDb>): Promise<number> {
  const ahora = new Date();
  let insertadas = 0;

  const cambios = await db.query.eventos.findMany({
    where: eq(eventos.tipo, "ESTADO_CAMBIADO"),
    orderBy: [desc(eventos.timestamp), desc(eventos.id)],
  });
  const ultimoCambioPorLead = new Map<number, { estadoNuevo: string; timestamp: Date }>();
  for (const ev of cambios) {
    if (ev.leadId === null) continue;
    if (!ultimoCambioPorLead.has(ev.leadId)) {
      ultimoCambioPorLead.set(ev.leadId, {
        estadoNuevo: (ev.payload as { estado_nuevo: string }).estado_nuevo,
        timestamp: ev.timestamp,
      });
    }
  }

  const leadIdsCandidatos = [...ultimoCambioPorLead.keys()];
  if (leadIdsCandidatos.length === 0) return 0;

  // Mismo criterio que leadsParaLlamar/listarEventosLocales: un lead
  // descartado no genera anomalias nuevas.
  const descartes = await db.query.eventos.findMany({
    where: and(inArray(eventos.leadId, leadIdsCandidatos), eq(eventos.tipo, "LEAD_DESCARTADO")),
  });
  const descartados = new Set(descartes.map((d) => d.leadId));

  const tipos = Object.entries(ANOMALIA_CONFIG.tiempo) as [
    TipoAnomaliaTiempo,
    (typeof ANOMALIA_CONFIG.tiempo)[TipoAnomaliaTiempo],
  ][];

  for (const [tipoAnomalia, cfg] of tipos) {
    for (const [leadId, info] of ultimoCambioPorLead) {
      if (info.estadoNuevo !== cfg.etapaOrigen || descartados.has(leadId)) continue;

      let deadline: Date;
      if (tipoAnomalia === "TIEMPO_C_D") {
        const cfgCD = cfg as (typeof ANOMALIA_CONFIG.tiempo)["TIEMPO_C_D"];
        const vigente = await obtenerCalendarVigente(db, leadId);
        const fechaHoraInicio = vigente ? (vigente.payload as { fecha_hora_inicio: string }).fecha_hora_inicio : null;
        deadline = fechaHoraInicio
          ? new Date(fechaHoraInicio)
          : new Date(info.timestamp.getTime() + cfgCD.horasDefault * 3_600_000);
      } else {
        const cfgHoras = cfg as { horas: number };
        deadline = new Date(info.timestamp.getTime() + cfgHoras.horas * 3_600_000);
      }

      const { esAnomalia, horasTranscurridas, umbralHoras } = detectarAnomaliaTiempo(info.timestamp, ahora, deadline);
      if (!esAnomalia) continue;

      const existente = await db.query.eventos.findFirst({
        where: and(
          eq(eventos.tipo, "ANOMALIA_DETECTADA"),
          eq(eventos.leadId, leadId),
          sql`${eventos.payload}->>'$.tipo_anomalia' = ${tipoAnomalia}`,
        ),
      });
      if (existente) continue;

      const setterId = await obtenerSetterActual(db, leadId);
      await db.insert(eventos).values({
        tipo: "ANOMALIA_DETECTADA" as any,
        leadId,
        actorTipo: "SISTEMA",
        actorId: null,
        payload: {
          tipo_anomalia: tipoAnomalia,
          atribuible_a: cfg.atribuibleA,
          setter_id: setterId,
          horas_transcurridas: horasTranscurridas,
          umbral_horas: umbralHoras,
          desde: info.timestamp.toISOString(),
        },
      } as any);
      insertadas++;
    }
  }

  return insertadas;
}

// ─── Orquestacion general + router ───────────────────────────────────────
export async function evaluarAnomalias(db: ReturnType<typeof getDb>) {
  const [tiempo, conversion] = await Promise.all([
    evaluarAnomaliasDeTiempo(db),
    evaluarAnomaliasDeConversion(db),
  ]);
  return { insertadas: tiempo + conversion };
}

export const anomaliaRouter = createRouter({
  // Corrida manual -- para pruebas o uso ad-hoc. La corrida real y periodica
  // vive en el scheduler (app/api/lib/anomaliaScheduler.ts), no aca.
  evaluarAhora: adminQuery.mutation(async () => {
    const db = getDb();
    return evaluarAnomalias(db);
  }),

  // Primera UI de ANOMALIA_DETECTADA (dashboard individual por setter, ver
  // 02_reglas_de_negocio.md seccion 10). Mismo scoping que embudoPorSetter:
  // un SETTER siempre recibe las suyas, nunca las de otro, sin importar que
  // setterId haya mandado.
  listarPorSetter: authedQuery
    .input(z.object({ setterId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const setterId = ctx.user.rol === "SETTER" ? ctx.user.id : input.setterId;

      const anomalias = await db.query.eventos.findMany({
        where: and(
          eq(eventos.tipo, "ANOMALIA_DETECTADA"),
          sql`CAST(${eventos.payload}->>'$.setter_id' AS UNSIGNED) = ${setterId}`,
        ),
        orderBy: [desc(eventos.timestamp), desc(eventos.id)],
        with: { lead: true },
      });

      return anomalias;
    }),
});
