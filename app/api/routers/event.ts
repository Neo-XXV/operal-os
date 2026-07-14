import { z } from "zod";
import { createRouter, authedQuery, adminQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { leads, eventos, users } from "@db/schema";
import { eq, desc, and, gte, lte, inArray, count } from "drizzle-orm";

// timestamp de MySQL tiene resolucion de 1 segundo — la carga rapida (Enter,
// Enter, Enter) y los seguimientos en lote (Sprint 2) generan varios eventos
// en el mismo segundo como flujo normal, no como caso borde. Desempatar SIEMPRE
// por id (autoincremental, refleja el orden real de insercion) o el "ultimo
// evento" no es deterministico.
async function verificarLeadActivo(db: ReturnType<typeof getDb>, leadId: number) {
  const descarte = await db.query.eventos.findFirst({
    where: and(eq(eventos.leadId, leadId), eq(eventos.tipo, "LEAD_DESCARTADO")),
    orderBy: [desc(eventos.timestamp), desc(eventos.id)],
  });
  if (descarte) throw new Error("El lead esta descartado. No se pueden registrar nuevos eventos.");
}

async function obtenerSetterActual(db: ReturnType<typeof getDb>, leadId: number) {
  const ultimaAsignacion = await db.query.eventos.findFirst({
    where: and(eq(eventos.leadId, leadId), eq(eventos.tipo, "LEAD_ASIGNADO")),
    orderBy: [desc(eventos.timestamp), desc(eventos.id)],
  });
  return ultimaAsignacion
    ? (ultimaAsignacion.payload as { setter_nuevo: number }).setter_nuevo
    : null;
}

const ESTADOS_VALIDOS = ["A", "MS", "B", "C", "D"] as const;

function validarTransicion(anterior: string | null, nuevo: string) {
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

async function obtenerEstadoActual(db: ReturnType<typeof getDb>, leadId: number) {
  const ultimo = await db.query.eventos.findFirst({
    where: and(eq(eventos.leadId, leadId), eq(eventos.tipo, "ESTADO_CAMBIADO")),
    orderBy: [desc(eventos.timestamp), desc(eventos.id)],
  });
  return ultimo
    ? (ultimo.payload as { estado_nuevo: string }).estado_nuevo
    : null;
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
function calcularEmbudo(cambiosEstado: { leadId: number; payload: unknown }[]) {
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
function resolverVentana(periodo: Periodo, desdeInput?: Date, hastaInput?: Date) {
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
// y dashboardHistorico.
function construirAsignacionPorSetter(
  cambiosEstado: { leadId: number; timestamp: Date; payload: unknown }[],
  asignaciones: { id: number; leadId: number; timestamp: Date; payload: unknown }[],
): Map<number, { leadId: number; payload: unknown }[]> {
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

  const resultado = new Map<number, { leadId: number; payload: unknown }[]>();
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

    const entrada = { leadId: ev.leadId, payload: ev.payload };
    const lista = resultado.get(dueno);
    if (lista) lista.push(entrada);
    else resultado.set(dueno, [entrada]);
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

      return db.query.eventos.findMany({
        where: eq(eventos.leadId, input.leadId),
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
        const allEvents = await db.query.eventos.findMany({
          orderBy: [desc(eventos.timestamp), desc(eventos.id)],
          with: { lead: true, actor: true },
        });

        const eventosFiltrados = [];
        for (const ev of allEvents) {
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

    const cambiosEstado = await db.query.eventos.findMany({
      where: eq(eventos.tipo, "ESTADO_CAMBIADO"),
    });

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

      const todosLosEventos = await db.query.eventos.findMany({
        where: and(...condiciones),
      });

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
        }),
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
  embudoPorSetter: adminQuery
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

      const cambiosEstado = await db.query.eventos.findMany({
        where: and(...condicionesEstado),
      });

      const leadIdsEnPeriodo = [...new Set(cambiosEstado.map((e) => e.leadId))];

      // LEAD_ASIGNADO se trae SIN acotar por fecha: un intervalo de dueño que
      // arranco antes del periodo pero sigue abierto necesita su historial
      // completo para resolverse bien.
      const [asignaciones, setters] = await Promise.all([
        leadIdsEnPeriodo.length > 0
          ? db.query.eventos.findMany({
              where: and(eq(eventos.tipo, "LEAD_ASIGNADO"), inArray(eventos.leadId, leadIdsEnPeriodo)),
            })
          : Promise.resolve([]),
        db.query.users.findMany({
          where: eq(users.rol, "SETTER"),
          columns: { id: true, nombre: true, activo: true },
        }),
      ]);

      const eventosPorSetter = construirAsignacionPorSetter(cambiosEstado, asignaciones);

      // Se incluyen todos los setters, incluidos inactivos y los que no
      // tuvieron actividad en el periodo — esa ausencia es informacion.
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
});
