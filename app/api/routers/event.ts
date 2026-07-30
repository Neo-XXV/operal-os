import { z } from "zod";
import { createRouter, authedQuery, adminQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { leads, eventos, users } from "@db/schema";
import { eq, desc, and, gte, lte, inArray, notInArray, count, sql } from "drizzle-orm";

// Tipos de evento de la fase de llamada -- visibles UNICAMENTE para ADMIN
// (docs/02_reglas_de_negocio (1).md seccion 7: "Los datos de la fase de
// llamada (montos, cash collected, grabaciones, notas de la call) son
// visibles unicamente para ADMIN. El SETTER no tiene acceso a esta
// informacion en la V1"). Los endpoints agregados de la fase de llamada ya
// son adminQuery; esta constante cubre los que devuelven eventos crudos de
// un lead, donde el chequeo de ownership pasa pero igual hay que filtrar
// por tipo (hallazgo A-1, docs/11_auditoria_seguridad.md). Una sola lista
// compartida a proposito: dos listas separadas divergen con el tiempo.
export const TIPOS_SOLO_ADMIN = ["LLAMADA_REGISTRADA", "PAGO_REGISTRADO"] as const;

// lead_id es nullable a nivel de columna (unico caso real: ANOMALIA_DETECTADA
// de nivel SETTER/EQUIPO, ver 03_catalogo_eventos.md evento 14) -- pero todo
// el resto de los tipos de evento (los que se leen en este archivo) siempre
// lo llevan. Angosta el tipo una sola vez en el punto de lectura en vez de
// repetir el chequeo en cada consumidor.
export function conLeadId<T extends { leadId: number | null }>(rows: T[]): (T & { leadId: number })[] {
  return rows.filter((r): r is T & { leadId: number } => r.leadId !== null);
}

// timestamp de MySQL tiene resolucion de 1 segundo — la carga rapida (Enter,
// Enter, Enter) y los seguimientos en lote (Sprint 2) generan varios eventos
// en el mismo segundo como flujo normal, no como caso borde. Desempatar SIEMPRE
// por id (autoincremental, refleja el orden real de insercion) o el "ultimo
// evento" no es deterministico.
export async function verificarLeadActivo(db: ReturnType<typeof getDb>, leadId: number) {
  const descarte = await db.query.eventos.findFirst({
    where: and(eq(eventos.leadId, leadId), eq(eventos.tipo, "LEAD_DESCARTADO")),
    orderBy: [desc(eventos.timestamp), desc(eventos.id)],
  });
  if (descarte) throw new Error("El lead esta descartado. No se pueden registrar nuevos eventos.");
}

export async function obtenerSetterActual(db: ReturnType<typeof getDb>, leadId: number) {
  const ultimaAsignacion = await db.query.eventos.findFirst({
    where: and(eq(eventos.leadId, leadId), eq(eventos.tipo, "LEAD_ASIGNADO")),
    orderBy: [desc(eventos.timestamp), desc(eventos.id)],
  });
  return ultimaAsignacion
    ? (ultimaAsignacion.payload as { setter_nuevo: number }).setter_nuevo
    : null;
}

const ESTADOS_VALIDOS = ["A", "MS", "B", "C", "D"] as const;

export function validarTransicion(anterior: string | null, nuevo: string) {
  if (!anterior) {
    if (nuevo !== "A") throw new Error("El primer estado debe ser A");
    return;
  }
  const idxAnterior = ESTADOS_VALIDOS.indexOf(anterior as typeof ESTADOS_VALIDOS[number]);
  const idxNuevo = ESTADOS_VALIDOS.indexOf(nuevo as typeof ESTADOS_VALIDOS[number]);
  if (idxNuevo === -1) throw new Error(`Estado invalido: ${nuevo}`);
  if (idxNuevo !== idxAnterior + 1) {
    throw new Error(`Transicion invalida: ${anterior} -> ${nuevo}`);
  }
}

export async function obtenerEstadoActual(db: ReturnType<typeof getDb>, leadId: number) {
  const ultimo = await db.query.eventos.findFirst({
    where: and(eq(eventos.leadId, leadId), eq(eventos.tipo, "ESTADO_CAMBIADO")),
    orderBy: [desc(eventos.timestamp), desc(eventos.id)],
  });
  return ultimo
    ? (ultimo.payload as { estado_nuevo: string }).estado_nuevo
    : null;
}

// ─── Sprint 4: fase de llamada (proyecciones, ver 03_catalogo_eventos.md
// eventos 9-10 y 08_modelo_de_datos.md) ────────────────────────────────────

type EstadoLlamada = "PENDIENTE_LLAMAR" | "PENDIENTE_REAGENDA" | "CERRADO" | "PERDIDO";

type LlamadaPayload = {
  numero: number;
  fecha_call: string;
  se_presento: boolean;
  califico: boolean | null;
  cerro: boolean | null;
  monto_cierre: number | null;
  moneda: string | null;
  situacion?: string;
  notas?: string;
  autoevaluacion?: string;
  grabacion_url?: string;
};

type EventoLlamada = { id: number; timestamp: Date; payload: unknown };

// Agrupa llamadas por numero, quedandose con la mas reciente de cada una
// (ya vienen ordenadas timestamp DESC, id DESC) -- el mismo numero puede
// tener mas de un evento si se corrigio (ver reglas de LLAMADA_REGISTRADA).
// fecha_call/fecha_pago son fechas de negocio locales, string "YYYY-MM-DD"
// (ver 03_catalogo_eventos.md eventos 9-10) -- convierte una ventana de
// resolverVentana (Date) al mismo formato para poder compararlas.
function fechaLocalISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function ultimaLlamadaPorNumero(llamadasDesc: EventoLlamada[]) {
  const porNumero = new Map<number, LlamadaPayload>();
  for (const ev of llamadasDesc) {
    const payload = ev.payload as LlamadaPayload;
    if (!porNumero.has(payload.numero)) porNumero.set(payload.numero, payload);
  }
  return porNumero;
}

// Funcion pura: separa el calculo de la lectura de DB (mismo patron que
// calcularEmbudo) -- la usan tanto la version de un lead como la de lote.
export function calcularEstadoLlamada(llamadasDesc: EventoLlamada[]): EstadoLlamada {
  if (llamadasDesc.length === 0) return "PENDIENTE_LLAMAR";

  const porNumero = ultimaLlamadaPorNumero(llamadasDesc);
  const cerro = [...porNumero.values()].some((l) => l.cerro === true);
  if (cerro) return "CERRADO";

  const maxNumero = Math.max(...porNumero.keys());
  return maxNumero >= 3 ? "PERDIDO" : "PENDIENTE_REAGENDA";
}

// null = el lead nunca llego a D, la fase de llamada no aplica todavia
// (agregado sobre lo documentado: sin esto, un lead en B mostraria
// "PENDIENTE_LLAMAR", enganoso -- no hay ninguna accion pendiente ahi).
export async function obtenerEstadoLlamada(db: ReturnType<typeof getDb>, leadId: number): Promise<EstadoLlamada | null> {
  const etapaActual = await obtenerEstadoActual(db, leadId);
  if (etapaActual !== "D") return null;

  const llamadas = await db.query.eventos.findMany({
    where: and(eq(eventos.leadId, leadId), eq(eventos.tipo, "LLAMADA_REGISTRADA")),
    orderBy: [desc(eventos.timestamp), desc(eventos.id)],
  });
  return calcularEstadoLlamada(llamadas);
}

export async function obtenerEstadoLlamadaLote(
  db: ReturnType<typeof getDb>,
  leadIds: number[],
): Promise<Map<number, EstadoLlamada | null>> {
  const resultado = new Map<number, EstadoLlamada | null>();
  if (leadIds.length === 0) return resultado;

  // Dos queries batcheadas (nunca N+1): una para saber quien esta en D, otra
  // para las llamadas de todos los leads pedidos.
  const [cambios, llamadas] = await Promise.all([
    db.query.eventos.findMany({
      where: and(inArray(eventos.leadId, leadIds), eq(eventos.tipo, "ESTADO_CAMBIADO")),
      orderBy: [desc(eventos.timestamp), desc(eventos.id)],
    }).then(conLeadId),
    db.query.eventos.findMany({
      where: and(inArray(eventos.leadId, leadIds), eq(eventos.tipo, "LLAMADA_REGISTRADA")),
      orderBy: [desc(eventos.timestamp), desc(eventos.id)],
    }).then(conLeadId),
  ]);

  const etapaPorLead = new Map<number, string>();
  for (const ev of cambios) {
    if (!etapaPorLead.has(ev.leadId)) {
      etapaPorLead.set(ev.leadId, (ev.payload as { estado_nuevo: string }).estado_nuevo);
    }
  }

  const llamadasPorLead = new Map<number, EventoLlamada[]>();
  for (const ev of llamadas) {
    const lista = llamadasPorLead.get(ev.leadId);
    if (lista) lista.push(ev);
    else llamadasPorLead.set(ev.leadId, [ev]);
  }

  for (const leadId of leadIds) {
    if (etapaPorLead.get(leadId) !== "D") {
      resultado.set(leadId, null);
      continue;
    }
    resultado.set(leadId, calcularEstadoLlamada(llamadasPorLead.get(leadId) ?? []));
  }

  return resultado;
}

type Cierre = { cerrado: boolean; montoCierre: number | null; moneda: string | null; timestamp: Date | null };

const CIERRE_VACIO: Cierre = { cerrado: false, montoCierre: null, moneda: null, timestamp: null };

// Gracias al bloqueo post-cierre (no se puede registrar otra llamada una vez
// que existe una con cerro=true), hay a lo sumo un evento asi por lead --
// lookup directo filtrado en SQL, no una reconstruccion de la secuencia.
export async function obtenerCierre(db: ReturnType<typeof getDb>, leadId: number): Promise<Cierre> {
  const cierre = await db.query.eventos.findFirst({
    where: and(
      eq(eventos.leadId, leadId),
      eq(eventos.tipo, "LLAMADA_REGISTRADA"),
      sql`${eventos.payload}->>'$.cerro' = 'true'`,
    ),
  });
  if (!cierre) return CIERRE_VACIO;
  const payload = cierre.payload as LlamadaPayload;
  return { cerrado: true, montoCierre: payload.monto_cierre, moneda: payload.moneda, timestamp: cierre.timestamp };
}

export async function obtenerCierreLote(db: ReturnType<typeof getDb>, leadIds: number[]): Promise<Map<number, Cierre>> {
  const resultado = new Map<number, Cierre>();
  if (leadIds.length === 0) return resultado;
  for (const leadId of leadIds) resultado.set(leadId, CIERRE_VACIO);

  const cierres = conLeadId(await db.query.eventos.findMany({
    where: and(
      inArray(eventos.leadId, leadIds),
      eq(eventos.tipo, "LLAMADA_REGISTRADA"),
      sql`${eventos.payload}->>'$.cerro' = 'true'`,
    ),
  }));
  for (const ev of cierres) {
    const payload = ev.payload as LlamadaPayload;
    resultado.set(ev.leadId, { cerrado: true, montoCierre: payload.monto_cierre, moneda: payload.moneda, timestamp: ev.timestamp });
  }
  return resultado;
}

// Cash collected nunca se guarda -- es la suma de PAGO_REGISTRADO de ese
// lead, calculada al consultar (02_reglas_de_negocio.md seccion 7 / 4).
export async function cashCollected(db: ReturnType<typeof getDb>, leadId: number): Promise<number> {
  const pagos = await db.query.eventos.findMany({
    where: and(eq(eventos.leadId, leadId), eq(eventos.tipo, "PAGO_REGISTRADO")),
  });
  return pagos.reduce((acc, ev) => acc + (ev.payload as { monto: number }).monto, 0);
}

export async function cashCollectedLote(db: ReturnType<typeof getDb>, leadIds: number[]): Promise<Map<number, number>> {
  const resultado = new Map<number, number>();
  if (leadIds.length === 0) return resultado;
  for (const leadId of leadIds) resultado.set(leadId, 0);

  const pagos = conLeadId(await db.query.eventos.findMany({
    where: and(inArray(eventos.leadId, leadIds), eq(eventos.tipo, "PAGO_REGISTRADO")),
  }));
  for (const ev of pagos) {
    const monto = (ev.payload as { monto: number }).monto;
    resultado.set(ev.leadId, (resultado.get(ev.leadId) ?? 0) + monto);
  }
  return resultado;
}

// El numero de seguimiento se deriva contando eventos previos en la misma
// etapa — nunca se pide como dato al cliente (Sprint 2, principio de UX).
async function contarSeguimientos(db: ReturnType<typeof getDb>, leadId: number, etapa: string) {
  const previos = await db.query.eventos.findMany({
    where: and(eq(eventos.leadId, leadId), eq(eventos.tipo, "SEGUIMIENTO_ENVIADO")),
  });
  return previos.filter((e) => (e.payload as { etapa: string }).etapa === etapa).length;
}

// ─── Sprint 3, punto 1: dashboard ejecutivo ──────────────────────────────

// Funcion pura: recibe eventos ESTADO_CAMBIADO ya filtrados por quien la
// llama (por rango de fechas o no) y calcula conteos/tasas. No sabe de donde
// vienen los eventos — el dia que existan proyecciones pre-calculadas
// (Nota tecnica, 08_modelo_de_datos.md), esta funcion no cambia, solo cambia
// que arreglo de eventos se le pasa.
export function calcularEmbudo(cambiosEstado: { leadId: number; payload: unknown }[]) {
  const leadsPorEtapa: Record<string, Set<number>> = {
    A: new Set(),
    MS: new Set(),
    B: new Set(),
    C: new Set(),
    D: new Set(),
  };
  for (const ev of cambiosEstado) {
    const estadoNuevo = (ev.payload as { estado_nuevo: string }).estado_nuevo;
    leadsPorEtapa[estadoNuevo]?.add(ev.leadId);
  }

  const conteos = {
    A: leadsPorEtapa.A.size,
    MS: leadsPorEtapa.MS.size,
    B: leadsPorEtapa.B.size,
    C: leadsPorEtapa.C.size,
    D: leadsPorEtapa.D.size,
  };

  const tasa = (numerador: number, denominador: number) =>
    denominador > 0 ? numerador / denominador : null;

  return {
    conteos,
    tasas: {
      MSR: tasa(conteos.MS, conteos.A),
      PRR: tasa(conteos.B, conteos.MS),
      CSR: tasa(conteos.C, conteos.B),
      ABR: tasa(conteos.D, conteos.C),
    },
  };
}

type Periodo = "lifetime" | "mensual" | "trimestral" | "semestral" | "anual" | "rango";

// Resuelve [desde, hasta] del periodo actual y una ventana anterior de
// igual duracion (evita comparar periodos de distinta longitud a mitad de
// mes/trimestre/etc). "lifetime" no tiene ventana anterior.
export function resolverVentana(periodo: Periodo, desdeInput?: Date, hastaInput?: Date) {
  const ahora = new Date();

  if (periodo === "lifetime") {
    return { desde: null as Date | null, hasta: ahora, desdeAnterior: null as Date | null, hastaAnterior: null as Date | null };
  }

  let desde: Date;
  let hasta: Date;

  if (periodo === "rango") {
    if (!desdeInput) throw new Error("El periodo 'rango' requiere 'desde'");
    desde = new Date(desdeInput);
    desde.setHours(0, 0, 0, 0);
    hasta = hastaInput ? new Date(hastaInput) : new Date(ahora);
    hasta.setHours(23, 59, 59, 999);
  } else {
    const hoy = new Date(ahora);
    hoy.setHours(0, 0, 0, 0);
    if (periodo === "mensual") {
      desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    } else if (periodo === "trimestral") {
      const inicioTrimestre = Math.floor(hoy.getMonth() / 3) * 3;
      desde = new Date(hoy.getFullYear(), inicioTrimestre, 1);
    } else if (periodo === "semestral") {
      const inicioSemestre = hoy.getMonth() < 6 ? 0 : 6;
      desde = new Date(hoy.getFullYear(), inicioSemestre, 1);
    } else {
      desde = new Date(hoy.getFullYear(), 0, 1);
    }
    hasta = ahora;
  }

  const duracionMs = hasta.getTime() - desde.getTime();
  const hastaAnterior = new Date(desde.getTime() - 1);
  const desdeAnterior = new Date(hastaAnterior.getTime() - duracionMs);

  return { desde, hasta, desdeAnterior, hastaAnterior };
}

// leadsNuevos / descartados / agendados son metricas de flujo — cuentan
// hechos ocurridos DENTRO del periodo (filtrar y agregar eventos, tal como
// pide la Nota tecnica).
function flowKpis(eventosDelPeriodo: { tipo: string; leadId: number; payload: unknown }[]) {
  const nuevos = new Set(
    eventosDelPeriodo.filter((e) => e.tipo === "LEAD_CREADO").map((e) => e.leadId),
  ).size;
  const descartados = new Set(
    eventosDelPeriodo.filter((e) => e.tipo === "LEAD_DESCARTADO").map((e) => e.leadId),
  ).size;
  const agendados = new Set(
    eventosDelPeriodo
      .filter((e) => e.tipo === "ESTADO_CAMBIADO" && (e.payload as { estado_nuevo: string }).estado_nuevo === "D")
      .map((e) => e.leadId),
  ).size;
  return { leadsNuevos: nuevos, descartados, agendados };
}

async function contarEventosLead(
  db: ReturnType<typeof getDb>,
  tipo: "LEAD_CREADO" | "LEAD_DESCARTADO",
  hasta: Date | null,
) {
  const condiciones = [eq(eventos.tipo, tipo)];
  if (hasta) condiciones.push(lte(eventos.timestamp, hasta));
  const [{ total }] = await db
    .select({ total: count() })
    .from(eventos)
    .where(and(...condiciones));
  return total;
}

// "activos" es un snapshot al cierre del periodo (no un conteo de flujo):
// leads creados hasta esa fecha que no estaban descartados en esa fecha.
// LEAD_CREADO y LEAD_DESCARTADO ocurren a lo sumo una vez por lead, asi que
// la resta de counts es exacta sin necesitar DISTINCT.
async function activosAlCorte(db: ReturnType<typeof getDb>, hasta: Date | null) {
  const [creados, descartados] = await Promise.all([
    contarEventosLead(db, "LEAD_CREADO", hasta),
    contarEventosLead(db, "LEAD_DESCARTADO", hasta),
  ]);
  return creados - descartados;
}

// ─── Sprint 3, punto 2: historico y comparacion por periodo ─────────────
//
// resolverVentana (arriba) da UN punto de comparacion (actual vs. ventana
// anterior de igual duracion) — sirve para "¿mejoro respecto al periodo
// pasado?". Este bloque es distinto a proposito: genera una SERIE de N
// unidades calendario completas (no ventanas de igual duracion corridas
// hacia atras, que no tienen sentido de calendario mas alla de 2 puntos).
// No toca resolverVentana ni el procedimiento dashboardEjecutivo.

type GranularidadHistorico = "mensual" | "trimestral" | "semestral" | "anual";

const MESES_POR_UNIDAD: Record<GranularidadHistorico, number> = {
  mensual: 1,
  trimestral: 3,
  semestral: 6,
  anual: 12,
};

const CANTIDAD_BUCKETS_HISTORICO = 6;

function inicioDeUnidad(totalMeses: number): Date {
  const anio = Math.floor(totalMeses / 12);
  const mes = ((totalMeses % 12) + 12) % 12;
  return new Date(anio, mes, 1);
}

// Genera `cantidad` buckets calendario consecutivos, del mas viejo al mas
// nuevo. El mas nuevo queda parcial (termina "ahora", como resolverVentana);
// los anteriores son unidades calendario completas y cerradas.
function resolverBucketsCalendario(granularidad: GranularidadHistorico, cantidad: number) {
  const ahora = new Date();
  const m = MESES_POR_UNIDAD[granularidad];
  const totalMesesActual = ahora.getFullYear() * 12 + ahora.getMonth();
  const inicioUnidadActual = Math.floor(totalMesesActual / m) * m;

  const buckets: { desde: Date; hasta: Date; esActual: boolean }[] = [];
  for (let i = cantidad - 1; i >= 0; i--) {
    const inicioMeses = inicioUnidadActual - i * m;
    const desde = inicioDeUnidad(inicioMeses);
    const esActual = i === 0;
    const hasta = esActual ? ahora : new Date(inicioDeUnidad(inicioMeses + m).getTime() - 1);
    buckets.push({ desde, hasta, esActual });
  }
  return buckets;
}

// ─── Sprint 3, punto 3: comparacion por setter ───────────────────────────
//
// Atribucion por intervalo de tiempo: reconstruye, por lead, la linea de
// tiempo de sus LEAD_ASIGNADO (ordenados por timestamp), y clasifica cada
// ESTADO_CAMBIADO segun quien tenia el lead asignado en ese instante exacto
// — no segun el dueno actual. Intervalo cerrado-abierto: un ESTADO_CAMBIADO
// con timestamp igual al de una asignacion se atribuye al nuevo dueno.
// Un lead sin ninguna asignacion queda excluido de toda atribucion (mismo
// criterio que setterActual: null en el resto del codigo). El resultado se
// le pasa a calcularEmbudo sin cambios, mismo patron que dashboardEjecutivo
// y dashboardHistorico. timestamp/id se preservan en la salida (ademas de
// leadId/payload) para consumidores que necesitan orden cronologico exacto
// -- ver detectarTransicionConversion en anomalia.ts.
export function construirAsignacionPorSetter(
  cambiosEstado: { id: number; leadId: number; timestamp: Date; payload: unknown }[],
  asignaciones: { id: number; leadId: number; timestamp: Date; payload: unknown }[],
): Map<number, { leadId: number; timestamp: Date; id: number; payload: unknown }[]> {
  const asignacionesPorLead = new Map<number, { setterId: number; desde: Date; id: number }[]>();
  for (const ev of asignaciones) {
    const setterId = (ev.payload as { setter_nuevo: number }).setter_nuevo;
    const entrada = { setterId, desde: ev.timestamp, id: ev.id };
    const lista = asignacionesPorLead.get(ev.leadId);
    if (lista) lista.push(entrada);
    else asignacionesPorLead.set(ev.leadId, [entrada]);
  }
  // Desempate por id: dos LEAD_ASIGNADO del mismo lead en el mismo segundo
  // (posible, aunque menos frecuente que en la carga rapida) deben quedar en
  // el orden real de insercion, no en el orden arbitrario que devuelva la DB.
  for (const lista of asignacionesPorLead.values()) {
    lista.sort((a, b) => a.desde.getTime() - b.desde.getTime() || a.id - b.id);
  }

  const resultado = new Map<number, { leadId: number; timestamp: Date; id: number; payload: unknown }[]>();
  for (const ev of cambiosEstado) {
    const intervalos = asignacionesPorLead.get(ev.leadId);
    if (!intervalos) continue;

    let dueno: number | null = null;
    for (const intervalo of intervalos) {
      if (intervalo.desde.getTime() <= ev.timestamp.getTime()) {
        dueno = intervalo.setterId;
      } else {
        break;
      }
    }
    if (dueno === null) continue;

    const entrada = { leadId: ev.leadId, timestamp: ev.timestamp, id: ev.id, payload: ev.payload };
    const lista = resultado.get(dueno);
    if (lista) lista.push(entrada);
    else resultado.set(dueno, [entrada]);
  }

  return resultado;
}

// ─── Sprint 3, punto 4: comparacion por origen ───────────────────────────
//
// Mas simple que por setter: origen es fijo desde LEAD_CREADO y ese evento
// ocurre una unica vez en toda la vida del lead (03_catalogo_eventos.md) —
// no hay intervalos ni reasignaciones que reconstruir, solo un mapa directo
// leadId -> origen. Por la misma razon no hace falta desempatar por id aca:
// no hay "mas reciente" que elegir entre varios LEAD_CREADO de un mismo lead.
const ORIGENES = ["SCRAPING", "MANUAL", "RPP"] as const;

function construirEventosPorOrigen(
  cambiosEstado: { leadId: number; payload: unknown }[],
  creaciones: { leadId: number; payload: unknown }[],
): Map<string, { leadId: number; payload: unknown }[]> {
  const origenPorLead = new Map<number, string>();
  for (const ev of creaciones) {
    origenPorLead.set(ev.leadId, (ev.payload as { origen: string }).origen);
  }

  const resultado = new Map<string, { leadId: number; payload: unknown }[]>();
  for (const ev of cambiosEstado) {
    const origen = origenPorLead.get(ev.leadId);
    if (!origen) continue;

    const entrada = { leadId: ev.leadId, payload: ev.payload };
    const lista = resultado.get(origen);
    if (lista) lista.push(entrada);
    else resultado.set(origen, [entrada]);
  }

  return resultado;
}

export const eventRouter = createRouter({
  create: authedQuery
    .input(
      z.object({
        tipo: z.enum([
          "ESTADO_CAMBIADO",
          "SEGUIMIENTO_ENVIADO",
          "RESPUESTA_RECIBIDA",
          "OBJECION_REGISTRADA",
          "LEAD_DESCARTADO",
          "NOTA_AGREGADA",
          "LLAMADA_REGISTRADA",
          "PAGO_REGISTRADO",
        ]),
        leadId: z.number(),
        payload: z.record(z.string(), z.any()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      const lead = await db.query.leads.findFirst({
        where: eq(leads.id, input.leadId),
      });
      if (!lead) throw new Error("Lead no encontrado");

      if (ctx.user.rol === "SETTER") {
        const setterActual = await obtenerSetterActual(db, input.leadId);
        if (setterActual !== ctx.user.id) {
          throw new Error("No tienes asignado este lead");
        }
      }

      let payloadFinal = input.payload;

      if (input.tipo === "ESTADO_CAMBIADO") {
        const payload = input.payload as { estado_anterior: string; estado_nuevo: string };
        const estadoActual = await obtenerEstadoActual(db, input.leadId);
        await verificarLeadActivo(db, input.leadId);
        validarTransicion(estadoActual, payload.estado_nuevo);
      }

      if (input.tipo === "SEGUIMIENTO_ENVIADO") {
        await verificarLeadActivo(db, input.leadId);
        const etapaActual = await obtenerEstadoActual(db, input.leadId);
        if (!etapaActual) {
          throw new Error("El lead todavia no tiene un estado registrado (A); no se puede enviar un seguimiento.");
        }
        if (etapaActual === "D") {
          throw new Error("El lead ya esta en D; no aplica un seguimiento.");
        }
        const numeroActual = await contarSeguimientos(db, input.leadId, etapaActual);
        payloadFinal = { etapa: etapaActual, numero: numeroActual + 1 };
      }

      if (input.tipo === "RESPUESTA_RECIBIDA") {
        await verificarLeadActivo(db, input.leadId);
      }

      if (input.tipo === "OBJECION_REGISTRADA") {
        const payload = input.payload as { tipo: string };
        const tiposValidos = [
          "PRECIO",
          "DESCONFIANZA",
          "TIEMPO",
          "EXPERIENCIA_PREVIA_SIMILAR",
          "YA_TIENE_PROVEEDOR",
          "YA_PAGO_MENTOR",
          "OTRA",
        ];
        if (!tiposValidos.includes(payload.tipo)) {
          throw new Error(`Tipo de objecion invalido: ${payload.tipo}`);
        }
        await verificarLeadActivo(db, input.leadId);
      }

      if (input.tipo === "LEAD_DESCARTADO") {
        const payload = input.payload as { motivo: string };
        const motivosValidos = ["SIN_RESPUESTA", "RECHAZO_EXPLICITO", "NO_CALIFICA", "DUPLICADO", "ERROR_CARGA"];
        if (!motivosValidos.includes(payload.motivo)) {
          throw new Error(`Motivo de descarte invalido: ${payload.motivo}`);
        }
        await verificarLeadActivo(db, input.leadId);
        // Sprint 4: "un lead ya cerrado no puede descartarse -- el cierre es
        // terminal, no hay 'descartar una venta'" (03_catalogo_eventos.md,
        // reglas de LEAD_DESCARTADO / interaccion con la fase de llamada).
        const cierre = await obtenerCierre(db, input.leadId);
        if (cierre.cerrado) {
          throw new Error("El lead ya cerro. No se puede descartar un lead cerrado.");
        }
      }

      if (input.tipo === "LLAMADA_REGISTRADA") {
        if (ctx.user.rol !== "ADMIN") {
          throw new Error("Solo un ADMIN puede registrar una llamada.");
        }
        await verificarLeadActivo(db, input.leadId);

        // Independiente del chequeo de arriba: un lead puede estar en D Y
        // descartado a la vez (el descarte durante la fase de llamada lo
        // genera el ADMIN, ver 03_catalogo_eventos.md) -- verificarLeadActivo
        // ya cubre "no descartado"; esto cubre "esta en D", son chequeos
        // independientes, no uno implica el otro.
        const etapaActual = await obtenerEstadoActual(db, input.leadId);
        if (etapaActual !== "D") {
          throw new Error("El lead debe estar en D para registrar una llamada.");
        }

        const payload = input.payload as Partial<LlamadaPayload>;

        if (
          typeof payload.numero !== "number" ||
          !Number.isInteger(payload.numero) ||
          payload.numero < 1 ||
          payload.numero > 3
        ) {
          throw new Error("numero debe ser 1, 2 o 3.");
        }
        if (typeof payload.fecha_call !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(payload.fecha_call)) {
          throw new Error("fecha_call debe ser un string 'YYYY-MM-DD' (fecha local, sin hora).");
        }
        if (typeof payload.se_presento !== "boolean") {
          throw new Error("se_presento es obligatorio (boolean).");
        }
        if (!payload.se_presento && payload.califico != null) {
          throw new Error("califico debe ser null si se_presento es false.");
        }
        if (payload.califico !== true && payload.cerro != null) {
          throw new Error("cerro debe ser null si califico no es true.");
        }
        if (payload.cerro === true) {
          if (
            typeof payload.monto_cierre !== "number" ||
            !Number.isInteger(payload.monto_cierre) ||
            payload.monto_cierre < 0
          ) {
            throw new Error("monto_cierre es obligatorio (entero en centavos) si cerro=true.");
          }
          if (payload.moneda !== "USD") {
            throw new Error("moneda es obligatoria ('USD') si hay monto_cierre.");
          }
        } else if (payload.monto_cierre != null) {
          throw new Error("monto_cierre debe ser null si cerro no es true.");
        }

        // numero secuencial: nueva llamada (maxNumero+1) o correccion de la
        // ultima (maxNumero, solo si no cerro -- ya lo garantiza el chequeo
        // de "yaCerrado" de abajo). Nunca se salta ni se corrige una ya
        // superada por la siguiente.
        const llamadasExistentes = await db.query.eventos.findMany({
          where: and(eq(eventos.leadId, input.leadId), eq(eventos.tipo, "LLAMADA_REGISTRADA")),
          orderBy: [desc(eventos.timestamp), desc(eventos.id)],
        });
        const porNumero = ultimaLlamadaPorNumero(llamadasExistentes);
        const yaCerrado = [...porNumero.values()].some((l) => l.cerro === true);
        if (yaCerrado) {
          throw new Error("El lead ya cerro. No se pueden registrar mas llamadas.");
        }
        const maxNumero = porNumero.size === 0 ? 0 : Math.max(...porNumero.keys());
        const esNueva = payload.numero === maxNumero + 1;
        const esCorreccion = maxNumero > 0 && payload.numero === maxNumero;
        if (!esNueva && !esCorreccion) {
          throw new Error(
            maxNumero === 0
              ? "La primera llamada debe ser numero=1."
              : `numero invalido: la siguiente llamada valida es ${maxNumero + 1}, o corregir la ${maxNumero} (la mas reciente, no cerrada).`,
          );
        }
      }

      if (input.tipo === "PAGO_REGISTRADO") {
        if (ctx.user.rol !== "ADMIN") {
          throw new Error("Solo un ADMIN puede registrar un pago.");
        }
        await verificarLeadActivo(db, input.leadId);

        const cierre = await obtenerCierre(db, input.leadId);
        if (!cierre.cerrado) {
          throw new Error("Solo se puede registrar un pago sobre un lead cerrado (LLAMADA_REGISTRADA con cerro=true).");
        }

        const payload = input.payload as { monto?: unknown; moneda?: unknown; fecha_pago?: unknown };
        if (typeof payload.monto !== "number" || !Number.isInteger(payload.monto) || payload.monto <= 0) {
          throw new Error("monto es obligatorio (entero positivo en centavos).");
        }
        if (payload.moneda !== "USD") {
          throw new Error("moneda es obligatoria ('USD').");
        }
        if (typeof payload.fecha_pago !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(payload.fecha_pago)) {
          throw new Error("fecha_pago debe ser un string 'YYYY-MM-DD' (fecha local, sin hora).");
        }
      }

      // NOTA_AGREGADA es la unica excepcion al bloqueo post-descarte: es el
      // mecanismo para dejar contexto adicional sobre un lead ya cerrado.

      const result = await db.insert(eventos).values({
        tipo: input.tipo as any,
        leadId: input.leadId,
        actorTipo: ctx.user.rol as any,
        actorId: ctx.user.id,
        payload: payloadFinal,
      }).$returningId();

      const insertedId = result[0]?.id;
      if (!insertedId) throw new Error("Error al crear el evento");

      return db.query.eventos.findFirst({
        where: eq(eventos.id, insertedId),
        with: { actor: true },
      });
    }),

  timeline: authedQuery
    .input(z.object({ leadId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();

      if (ctx.user.rol === "SETTER") {
        const setterActual = await obtenerSetterActual(db, input.leadId);
        if (setterActual !== ctx.user.id) {
          throw new Error("No tienes asignado este lead");
        }
      }

      // El chequeo de ownership de arriba no alcanza: un lead PROPIO del
      // setter puede tener eventos de la fase de llamada, que son
      // solo-ADMIN (ver TIPOS_SOLO_ADMIN). Se filtra en SQL, no en memoria
      // -- el dato no sale de la base si no corresponde.
      const condiciones = [eq(eventos.leadId, input.leadId)];
      if (ctx.user.rol === "SETTER") {
        condiciones.push(notInArray(eventos.tipo, [...TIPOS_SOLO_ADMIN]));
      }

      return db.query.eventos.findMany({
        where: and(...condiciones),
        orderBy: [desc(eventos.timestamp), desc(eventos.id)],
        with: { actor: true },
      });
    }),

  list: authedQuery
    .input(
      z.object({
        leadId: z.number().optional(),
        tipo: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const db = getDb();

      if (ctx.user.rol === "SETTER") {
        // Excluye en SQL los tipos de la fase de llamada (solo-ADMIN, ver
        // TIPOS_SOLO_ADMIN) -- el filtro de ownership de abajo no los
        // cubre, porque son eventos de leads que SI son del setter.
        const allEvents = await db.query.eventos.findMany({
          where: notInArray(eventos.tipo, [...TIPOS_SOLO_ADMIN]),
          orderBy: [desc(eventos.timestamp), desc(eventos.id)],
          with: { lead: true, actor: true },
        });

        const eventosFiltrados = [];
        for (const ev of allEvents) {
          // ANOMALIA_DETECTADA de nivel SETTER/EQUIPO no tiene lead_id -- un
          // SETTER nunca deberia ver estos (son operativos, no de un lead
          // suyo), se excluyen de su vista filtrada.
          if (ev.leadId === null) continue;
          const setterActual = await obtenerSetterActual(db, ev.leadId);
          if (setterActual === ctx.user.id) {
            if (!input?.tipo || ev.tipo === input.tipo) {
              if (!input?.leadId || ev.leadId === input.leadId) {
                eventosFiltrados.push(ev);
              }
            }
          }
        }
        const start = input?.offset ?? 0;
        const end = start + (input?.limit ?? 50);
        return eventosFiltrados.slice(start, end);
      }

      const conditions = [];
      if (input?.leadId) conditions.push(eq(eventos.leadId, input.leadId));
      if (input?.tipo) conditions.push(eq(eventos.tipo, input.tipo as any));

      if (conditions.length > 0) {
        return db.query.eventos.findMany({
          where: and(...conditions),
          orderBy: [desc(eventos.timestamp), desc(eventos.id)],
          limit: input?.limit ?? 50,
          offset: input?.offset ?? 0,
          with: { lead: true, actor: true },
        });
      }

      return db.query.eventos.findMany({
        orderBy: [desc(eventos.timestamp), desc(eventos.id)],
        limit: input?.limit ?? 50,
        offset: input?.offset ?? 0,
        with: { lead: true, actor: true },
      });
    }),

  // Sprint 2, punto 2: embudo general con tasas de conversion entre etapas
  // consecutivas (MSR, PRR, CSR, ABR), calculado leyendo el Event Log —
  // ningun conteo ni tasa se guarda como dato. Sprint 3 reutiliza la misma
  // matematica (calcularEmbudo) para la version acotada por periodo.
  embudo: adminQuery.query(async () => {
    const db = getDb();

    const cambiosEstado = conLeadId(await db.query.eventos.findMany({
      where: eq(eventos.tipo, "ESTADO_CAMBIADO"),
    }));

    return calcularEmbudo(cambiosEstado);
  }),

  // Sprint 3, punto 1: dashboard ejecutivo — KPIs y embudo acotados a un
  // periodo, con comparacion contra una ventana anterior de igual duracion.
  dashboardEjecutivo: adminQuery
    .input(
      z.object({
        periodo: z.enum(["lifetime", "mensual", "trimestral", "semestral", "anual", "rango"]),
        desde: z.coerce.date().optional(),
        hasta: z.coerce.date().optional(),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const ventana = resolverVentana(input.periodo, input.desde, input.hasta);
      const tieneAnterior = ventana.desdeAnterior !== null && ventana.hastaAnterior !== null;

      const condiciones = [
        inArray(eventos.tipo, ["LEAD_CREADO", "LEAD_DESCARTADO", "ESTADO_CAMBIADO"]),
        lte(eventos.timestamp, ventana.hasta),
      ];
      if (ventana.desdeAnterior) {
        condiciones.push(gte(eventos.timestamp, ventana.desdeAnterior));
      }

      const todosLosEventos = conLeadId(await db.query.eventos.findMany({
        where: and(...condiciones),
      }));

      const dentroDe = (ev: (typeof todosLosEventos)[number], desde: Date | null, hasta: Date) =>
        (!desde || ev.timestamp >= desde) && ev.timestamp <= hasta;

      const eventosActual = todosLosEventos.filter((e) => dentroDe(e, ventana.desde, ventana.hasta));
      const eventosAnterior = tieneAnterior
        ? todosLosEventos.filter((e) => dentroDe(e, ventana.desdeAnterior, ventana.hastaAnterior!))
        : [];

      const [activosActual, activosAnterior] = await Promise.all([
        activosAlCorte(db, ventana.hasta),
        tieneAnterior ? activosAlCorte(db, ventana.hastaAnterior!) : Promise.resolve(null),
      ]);

      const kpisActual = { ...flowKpis(eventosActual), activos: activosActual };
      const kpisAnterior = tieneAnterior
        ? { ...flowKpis(eventosAnterior), activos: activosAnterior as number }
        : null;

      const embudoActual = calcularEmbudo(eventosActual.filter((e) => e.tipo === "ESTADO_CAMBIADO"));
      const embudoAnterior = tieneAnterior
        ? calcularEmbudo(eventosAnterior.filter((e) => e.tipo === "ESTADO_CAMBIADO"))
        : null;

      // Cuello de botella: tasa mas baja del periodo actual + su tendencia
      // contra el periodo anterior.
      let claveMinima: keyof typeof embudoActual.tasas | null = null;
      let valorMinimo = Infinity;
      for (const clave of ["MSR", "PRR", "CSR", "ABR"] as const) {
        const valor = embudoActual.tasas[clave];
        if (valor !== null && valor < valorMinimo) {
          valorMinimo = valor;
          claveMinima = clave;
        }
      }

      let tendenciaCuelloDeBotella: "mejora" | "empeora" | "estable" | "sin_datos_previos" | null = null;
      let valorAnteriorCuelloDeBotella: number | null = null;
      if (claveMinima) {
        valorAnteriorCuelloDeBotella = embudoAnterior?.tasas[claveMinima] ?? null;
        if (valorAnteriorCuelloDeBotella === null) {
          tendenciaCuelloDeBotella = "sin_datos_previos";
        } else {
          const delta = valorMinimo - valorAnteriorCuelloDeBotella;
          tendenciaCuelloDeBotella = Math.abs(delta) < 0.01 ? "estable" : delta > 0 ? "mejora" : "empeora";
        }
      }

      return {
        ventana: {
          desde: ventana.desde,
          hasta: ventana.hasta,
          desdeAnterior: ventana.desdeAnterior,
          hastaAnterior: ventana.hastaAnterior,
        },
        kpis: { actual: kpisActual, anterior: kpisAnterior },
        embudo: { actual: embudoActual, anterior: embudoAnterior },
        cuelloDeBotella: claveMinima && {
          key: claveMinima,
          valorActual: valorMinimo,
          valorAnterior: valorAnteriorCuelloDeBotella,
          tendencia: tendenciaCuelloDeBotella,
        },
      };
    }),

  // Sprint 3, punto 2: serie historica de N periodos calendario, para leer
  // tendencia (no solo un salto actual-vs-anterior). Reutiliza calcularEmbudo
  // y flowKpis sin cambios — solo cambia que arreglo de eventos se les pasa.
  dashboardHistorico: adminQuery
    .input(
      z.object({
        granularidad: z.enum(["mensual", "trimestral", "semestral", "anual"]),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const buckets = resolverBucketsCalendario(input.granularidad, CANTIDAD_BUCKETS_HISTORICO);
      const desdeGlobal = buckets[0].desde;
      const hastaGlobal = buckets[buckets.length - 1].hasta;

      const [todosLosEventos, activosBase] = await Promise.all([
        db.query.eventos.findMany({
          where: and(
            inArray(eventos.tipo, ["LEAD_CREADO", "LEAD_DESCARTADO", "ESTADO_CAMBIADO"]),
            gte(eventos.timestamp, desdeGlobal),
            lte(eventos.timestamp, hastaGlobal),
          ),
        }).then(conLeadId),
        activosAlCorte(db, new Date(desdeGlobal.getTime() - 1)),
      ]);

      // "activos" se acumula bucket a bucket desde el snapshot base — evita
      // 2 queries de COUNT por bucket (ver Nota tecnica: una sola consulta
      // acotada, no N escaneos del Event Log).
      let activosCorrido = activosBase;

      const serie = buckets.map((b) => {
        const eventosBucket = todosLosEventos.filter(
          (e) => e.timestamp >= b.desde && e.timestamp <= b.hasta,
        );
        const kpisFlujo = flowKpis(eventosBucket);
        activosCorrido += kpisFlujo.leadsNuevos - kpisFlujo.descartados;
        const embudo = calcularEmbudo(eventosBucket.filter((e) => e.tipo === "ESTADO_CAMBIADO"));

        return {
          desde: b.desde,
          hasta: b.hasta,
          esActual: b.esActual,
          kpis: { ...kpisFlujo, activos: activosCorrido },
          embudo,
        };
      });

      return { granularidad: input.granularidad, serie };
    }),

  // Sprint 3, punto 3: comparacion por setter. Atribucion por INTERVALO DE
  // TIEMPO — cada ESTADO_CAMBIADO se atribuye a quien tenia el lead asignado
  // en el momento exacto de esa transicion (no al dueno actual), porque los
  // leads se reasignan (02_reglas_de_negocio: "la agencia rota setters
  // constantemente") y atribuir todo al dueno de hoy le daria/quitaria
  // credito por trabajo que no hizo. Documentado tambien en
  // 03_catalogo_eventos.md junto a la regla de "setter actual".
  // Sprint "dashboards individuales": authedQuery (ya no adminQuery) para que
  // un SETTER pueda pedir su propio detalle -- el scoping de abajo es la
  // barrera real, no depende de que el frontend pida bien. Un SETTER SIEMPRE
  // recibe unicamente su propia fila en `setters` (nunca la lista completa),
  // sin importar que `setterId` haya mandado o no.
  embudoPorSetter: authedQuery
    .input(
      z.object({
        periodo: z.enum(["lifetime", "mensual", "trimestral", "semestral", "anual", "rango"]),
        desde: z.coerce.date().optional(),
        hasta: z.coerce.date().optional(),
        setterId: z.number().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const ventana = resolverVentana(input.periodo, input.desde, input.hasta);

      const setterIdForzado = ctx.user.rol === "SETTER" ? ctx.user.id : input.setterId;

      const condicionesEstado = [eq(eventos.tipo, "ESTADO_CAMBIADO"), lte(eventos.timestamp, ventana.hasta)];
      if (ventana.desde) condicionesEstado.push(gte(eventos.timestamp, ventana.desde));

      const cambiosEstado = conLeadId(await db.query.eventos.findMany({
        where: and(...condicionesEstado),
      }));

      const leadIdsEnPeriodo = [...new Set(cambiosEstado.map((e) => e.leadId))];

      // LEAD_ASIGNADO se trae SIN acotar por fecha: un intervalo de dueño que
      // arranco antes del periodo pero sigue abierto necesita su historial
      // completo para resolverse bien.
      const [asignaciones, settersTodos] = await Promise.all([
        leadIdsEnPeriodo.length > 0
          ? db.query.eventos.findMany({
              where: and(eq(eventos.tipo, "LEAD_ASIGNADO"), inArray(eventos.leadId, leadIdsEnPeriodo)),
            }).then(conLeadId)
          : Promise.resolve([]),
        db.query.users.findMany({
          where: eq(users.rol, "SETTER"),
          columns: { id: true, nombre: true, activo: true },
        }),
      ]);

      const setters = setterIdForzado
        ? settersTodos.filter((s) => s.id === setterIdForzado)
        : settersTodos;

      const eventosPorSetter = construirAsignacionPorSetter(cambiosEstado, asignaciones);

      // Se incluyen todos los setters pedidos, incluidos inactivos y los que
      // no tuvieron actividad en el periodo — esa ausencia es informacion.
      const setterStats = setters.map((s) => ({
        id: s.id,
        nombre: s.nombre,
        activo: s.activo,
        ...calcularEmbudo(eventosPorSetter.get(s.id) ?? []),
      }));

      return {
        ventana: { desde: ventana.desde, hasta: ventana.hasta },
        setters: setterStats,
      };
    }),

  // Sprint 3, punto 4: comparacion por origen del lead (SCRAPING/MANUAL/RPP).
  embudoPorOrigen: adminQuery
    .input(
      z.object({
        periodo: z.enum(["lifetime", "mensual", "trimestral", "semestral", "anual", "rango"]),
        desde: z.coerce.date().optional(),
        hasta: z.coerce.date().optional(),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const ventana = resolverVentana(input.periodo, input.desde, input.hasta);

      const condicionesEstado = [eq(eventos.tipo, "ESTADO_CAMBIADO"), lte(eventos.timestamp, ventana.hasta)];
      if (ventana.desde) condicionesEstado.push(gte(eventos.timestamp, ventana.desde));

      const cambiosEstado = conLeadId(await db.query.eventos.findMany({
        where: and(...condicionesEstado),
      }));

      const leadIdsEnPeriodo = [...new Set(cambiosEstado.map((e) => e.leadId))];

      // LEAD_CREADO se trae SIN acotar por fecha (el lead puede haberse
      // creado mucho antes del periodo y tener actividad recien ahora).
      const creaciones = conLeadId(
        leadIdsEnPeriodo.length > 0
          ? await db.query.eventos.findMany({
              where: and(eq(eventos.tipo, "LEAD_CREADO"), inArray(eventos.leadId, leadIdsEnPeriodo)),
            })
          : [],
      );

      const eventosPorOrigen = construirEventosPorOrigen(cambiosEstado, creaciones);

      // Se incluyen los 3 origenes siempre, incluso en cero.
      const origenStats = ORIGENES.map((origen) => ({
        origen,
        ...calcularEmbudo(eventosPorOrigen.get(origen) ?? []),
      }));

      return {
        ventana: { desde: ventana.desde, hasta: ventana.hasta },
        origenes: origenStats,
      };
    }),

  // Sprint 4: proyecciones de la fase de llamada -- visibles unicamente para
  // ADMIN (02_reglas_de_negocio.md seccion 7 / 06_sprint_4.md).
  estadoLlamada: adminQuery
    .input(z.object({ leadId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return { estado: await obtenerEstadoLlamada(db, input.leadId) };
    }),

  cierre: adminQuery
    .input(z.object({ leadId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return obtenerCierre(db, input.leadId);
    }),

  cashCollected: adminQuery
    .input(z.object({ leadId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return { montoTotal: await cashCollected(db, input.leadId) };
    }),

  // Sprint 4, Fase 4: "cola" de leads pendientes de accion en la fase de
  // llamada. No es una lista "de hoy" en sentido literal -- no existe un
  // campo de "proxima llamada programada" (automatizacion de reagenda esta
  // fuera de alcance del sprint, ver 06_sprint_4.md) -- es todo lo que esta
  // en D, no descartado, y en PENDIENTE_LLAMAR o PENDIENTE_REAGENDA.
  leadsParaLlamar: adminQuery.query(async () => {
    const db = getDb();

    const cambios = conLeadId(await db.query.eventos.findMany({
      where: eq(eventos.tipo, "ESTADO_CAMBIADO"),
      orderBy: [desc(eventos.timestamp), desc(eventos.id)],
    }));
    const etapaPorLead = new Map<number, string>();
    for (const ev of cambios) {
      if (!etapaPorLead.has(ev.leadId)) {
        etapaPorLead.set(ev.leadId, (ev.payload as { estado_nuevo: string }).estado_nuevo);
      }
    }
    const leadIdsEnD = [...etapaPorLead.entries()].filter(([, e]) => e === "D").map(([id]) => id);
    if (leadIdsEnD.length === 0) return [];

    // Un lead en D puede estar descartado (lo genera el ADMIN durante la
    // fase de llamada, ver 03_catalogo_eventos.md) -- se excluye aca, no
    // aparece en la cola de llamadas pendientes.
    const descartes = await db.query.eventos.findMany({
      where: and(inArray(eventos.leadId, leadIdsEnD), eq(eventos.tipo, "LEAD_DESCARTADO")),
    });
    const idsDescartados = new Set(descartes.map((e) => e.leadId));
    const leadIdsActivos = leadIdsEnD.filter((id) => !idsDescartados.has(id));
    if (leadIdsActivos.length === 0) return [];

    const [estados, llamadas, asignaciones, creaciones, leadsInfo] = await Promise.all([
      obtenerEstadoLlamadaLote(db, leadIdsActivos),
      db.query.eventos.findMany({
        where: and(inArray(eventos.leadId, leadIdsActivos), eq(eventos.tipo, "LLAMADA_REGISTRADA")),
        orderBy: [desc(eventos.timestamp), desc(eventos.id)],
      }).then(conLeadId),
      db.query.eventos.findMany({
        where: and(inArray(eventos.leadId, leadIdsActivos), eq(eventos.tipo, "LEAD_ASIGNADO")),
        orderBy: [desc(eventos.timestamp), desc(eventos.id)],
      }).then(conLeadId),
      db.query.eventos.findMany({
        where: and(inArray(eventos.leadId, leadIdsActivos), eq(eventos.tipo, "LEAD_CREADO")),
      }).then(conLeadId),
      db.query.leads.findMany({ where: inArray(leads.id, leadIdsActivos) }),
    ]);

    const idsParaLlamar = leadIdsActivos.filter((id) => {
      const estado = estados.get(id);
      return estado === "PENDIENTE_LLAMAR" || estado === "PENDIENTE_REAGENDA";
    });

    const llamadasPorLead = new Map<number, EventoLlamada[]>();
    for (const ev of llamadas) {
      const lista = llamadasPorLead.get(ev.leadId);
      if (lista) lista.push(ev);
      else llamadasPorLead.set(ev.leadId, [ev]);
    }

    const setterPorLead = new Map<number, number>();
    for (const ev of asignaciones) {
      if (!setterPorLead.has(ev.leadId)) {
        setterPorLead.set(ev.leadId, (ev.payload as { setter_nuevo: number }).setter_nuevo);
      }
    }

    const origenPorLead = new Map<number, string>();
    for (const ev of creaciones) {
      origenPorLead.set(ev.leadId, (ev.payload as { origen: string }).origen);
    }

    const setterIds = [...new Set(setterPorLead.values())];
    const setters =
      setterIds.length > 0
        ? await db.query.users.findMany({ where: inArray(users.id, setterIds), columns: { id: true, nombre: true } })
        : [];
    const nombreSetterPorId = new Map(setters.map((s) => [s.id, s.nombre]));

    const leadsPorId = new Map(leadsInfo.map((l) => [l.id, l]));

    return idsParaLlamar.map((id) => {
      const lead = leadsPorId.get(id)!;
      const porNumero = ultimaLlamadaPorNumero(llamadasPorLead.get(id) ?? []);
      const maxNumero = porNumero.size === 0 ? 0 : Math.max(...porNumero.keys());
      const ultima = maxNumero > 0 ? porNumero.get(maxNumero)! : null;
      const setterId = setterPorLead.get(id) ?? null;

      return {
        leadId: id,
        nombre: lead.nombre,
        instagramUsername: lead.instagramUsername,
        estadoLlamada: estados.get(id),
        origen: origenPorLead.get(id) ?? null,
        setterId,
        setterNombre: setterId ? (nombreSetterPorId.get(setterId) ?? null) : null,
        ultimaLlamada: ultima ? { numero: maxNumero, fecha_call: ultima.fecha_call } : null,
      };
    });
  }),

  // Sprint 4, Fase 4: dashboard de la fase de llamada, period-aware.
  // Reusa resolverVentana (Sprint 3) sin tocarla. Bucketea por fecha_call /
  // fecha_pago (fecha de negocio), NUNCA por eventos.timestamp -- regla
  // explicita de 06_sprint_4.md, el ADMIN puede cargar el resultado dias o
  // meses despues de que la llamada/el cobro ocurrio en realidad.
  dashboardLlamadas: adminQuery
    .input(
      z.object({
        periodo: z.enum(["lifetime", "mensual", "trimestral", "semestral", "anual", "rango"]),
        desde: z.coerce.date().optional(),
        hasta: z.coerce.date().optional(),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const ventana = resolverVentana(input.periodo, input.desde, input.hasta);
      const hastaStr = fechaLocalISO(ventana.hasta);
      const desdeStr = ventana.desde ? fechaLocalISO(ventana.desde) : null;

      // Se trae TODO LLAMADA_REGISTRADA sin acotar por fecha en SQL todavia:
      // una correccion puede cambiar el fecha_call de una llamada, y filtrar
      // por fecha antes de quedarse con "la version mas reciente por numero"
      // podria dejar afuera la version vigente o dejar adentro una ya
      // superada. Se deduplica primero (mismo criterio que event.create),
      // se filtra por fecha despues. Volumen chico (maximo 3 por lead en D).
      const todasLasLlamadas = conLeadId(await db.query.eventos.findMany({
        where: eq(eventos.tipo, "LLAMADA_REGISTRADA"),
        orderBy: [desc(eventos.timestamp), desc(eventos.id)],
      }));
      const llamadasPorLead = new Map<number, EventoLlamada[]>();
      for (const ev of todasLasLlamadas) {
        const lista = llamadasPorLead.get(ev.leadId);
        if (lista) lista.push(ev);
        else llamadasPorLead.set(ev.leadId, [ev]);
      }
      const llamadasVigentes: { leadId: number; payload: LlamadaPayload }[] = [];
      for (const [leadId, evs] of llamadasPorLead) {
        for (const payload of ultimaLlamadaPorNumero(evs).values()) {
          llamadasVigentes.push({ leadId, payload });
        }
      }

      const enPeriodo = llamadasVigentes.filter(
        (l) => l.payload.fecha_call <= hastaStr && (!desdeStr || l.payload.fecha_call >= desdeStr),
      );

      // "Actividad" -- cuenta LLAMADAS, no leads. "agendados" del Show Up
      // Rate = llamadas totales de este periodo (NO el KPI "agendados" de
      // dashboardEjecutivo, que cuenta leads llegando a D por timestamp --
      // son ejes de tiempo distintos: un lead puede llegar a D en junio y
      // tener su primera llamada en julio. Mezclarlos comparia numerador y
      // denominador de grupos de leads distintos). Confirmado, no comparar
      // este numero contra el "agendados" del otro dashboard.
      const llamadasTotales = enPeriodo.length;
      const llamadasCalificadas = enPeriodo.filter((l) => l.payload.califico === true).length;
      const sePresentaron = enPeriodo.filter((l) => l.payload.se_presento === true).length;
      const showUpRate = llamadasTotales > 0 ? sePresentaron / llamadasTotales : null;

      // Close Rate (KPI principal del sprint) -- cuenta LEADS, no llamadas:
      // un lead que califico en la call 1 y cerro en la 3 no debe contar 2
      // veces en "calificados". Deduplicado por leadId via Set, mismo
      // criterio que calcularEmbudo usa para el embudo del setter.
      const leadsCalificados = new Set(enPeriodo.filter((l) => l.payload.califico === true).map((l) => l.leadId));
      const leadsCerrados = new Set(enPeriodo.filter((l) => l.payload.cerro === true).map((l) => l.leadId));
      const closeRate = leadsCalificados.size > 0 ? leadsCerrados.size / leadsCalificados.size : null;

      // PAGO_REGISTRADO no tiene numero/correccion (cada pago es un hecho
      // propio, no hay version "vigente" que resolver) -- solo se filtra
      // por fecha_pago.
      const condicionesPago = [eq(eventos.tipo, "PAGO_REGISTRADO")];
      if (desdeStr) condicionesPago.push(sql`${eventos.payload}->>'$.fecha_pago' >= ${desdeStr}`);
      condicionesPago.push(sql`${eventos.payload}->>'$.fecha_pago' <= ${hastaStr}`);
      const pagosEnPeriodo = await db.query.eventos.findMany({ where: and(...condicionesPago) });
      const cashCollectedTotal = pagosEnPeriodo.reduce((acc, ev) => acc + (ev.payload as { monto: number }).monto, 0);

      // AOV: cash collected (por fecha_pago) sobre actividad de llamadas
      // (por fecha_call) del MISMO periodo -- no necesariamente los mismos
      // leads, por los planes de pago (una cuota puede caer meses despues
      // del cierre). El AOV de un mes puede salir alto por cuotas viejas
      // cobradas ese mes con pocos cierres nuevos -- es el comportamiento
      // esperado con bucketeo por fecha de negocio propia (confirmado, no
      // cohorte), no un error a corregir. Ver docs/06_sprint_4.md.
      const aovCallEfectiva = sePresentaron > 0 ? cashCollectedTotal / sePresentaron : null;
      const aovTratoCerrado = leadsCerrados.size > 0 ? cashCollectedTotal / leadsCerrados.size : null;

      return {
        ventana: { desde: ventana.desde, hasta: ventana.hasta },
        llamadasTotales,
        llamadasCalificadas,
        showUpRate,
        closeRate,
        clientesCerrados: leadsCerrados.size,
        cashCollected: cashCollectedTotal,
        aovCallEfectiva,
        aovTratoCerrado,
      };
    }),
});
