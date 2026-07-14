import { z } from "zod";
import { createRouter, authedQuery, adminQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { leads, eventos } from "@db/schema";
import { eq, desc, inArray } from "drizzle-orm";

export const leadRouter = createRouter({
  // El setter carga el lead cuando decide contactarlo: LEAD_CREADO, la
  // auto-asignacion y la primera transicion (null -> A) ocurren en el mismo acto.
  // Admin/manager pueden cargar leads sin asignarlos ni moverlos de etapa todavia
  // (p.ej. carga en lote antes de repartir).
  create: authedQuery
    .input(
      z.object({
        // Nombre queda vacio si no se completa (p.ej. carga rapida por username) —
        // es un dato real que se completa despues, no se rellena con un valor falso.
        nombre: z.string().default(""),
        instagramUsername: z.string().min(1, "Username requerido"),
        setterId: z.number().optional(),
        origen: z.enum(["SCRAPING", "MANUAL", "RPP"]).default("MANUAL"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const esSetter = ctx.user.rol === "SETTER";
      const setterAsignado = esSetter ? ctx.user.id : input.setterId;

      const leadId = await db.transaction(async (tx) => {
        const [{ id: leadId }] = await tx
          .insert(leads)
          .values({
            nombre: input.nombre,
            instagramUsername: input.instagramUsername,
          })
          .$returningId();

        await tx.insert(eventos).values({
          tipo: "LEAD_CREADO" as any,
          leadId,
          actorTipo: ctx.user.rol as any,
          actorId: ctx.user.id,
          payload: { origen: input.origen },
        } as any);

        if (setterAsignado) {
          await tx.insert(eventos).values({
            tipo: "LEAD_ASIGNADO" as any,
            leadId,
            actorTipo: ctx.user.rol as any,
            actorId: ctx.user.id,
            payload: { setter_anterior: null, setter_nuevo: setterAsignado },
          } as any);
        }

        if (esSetter) {
          await tx.insert(eventos).values({
            tipo: "ESTADO_CAMBIADO" as any,
            leadId,
            actorTipo: ctx.user.rol as any,
            actorId: ctx.user.id,
            payload: { estado_anterior: null, estado_nuevo: "A" },
          } as any);
        }

        return leadId;
      });

      const lead = await db.query.leads.findFirst({
        where: eq(leads.id, leadId),
      });
      return lead;
    }),

  list: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const allLeads = await db.query.leads.findMany({
      orderBy: (leads, { desc }) => [desc(leads.id)],
    });

    const proyecciones = await obtenerProyeccionesLote(db, allLeads.map((l) => l.id));
    const leadsConProyecciones = allLeads.map((lead) => ({
      ...lead,
      ...(proyecciones.get(lead.id) ?? PROYECCION_VACIA),
    }));

    if (ctx.user.rol === "SETTER") {
      return leadsConProyecciones.filter(
        (l) => l.setterActual === ctx.user.id,
      );
    }

    return leadsConProyecciones;
  }),

  getById: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const lead = await db.query.leads.findFirst({
        where: eq(leads.id, input.id),
      });
      if (!lead) return null;

      const proyecciones = (await obtenerProyeccionesLote(db, [lead.id])).get(lead.id) ?? PROYECCION_VACIA;

      if (ctx.user.rol === "SETTER" && proyecciones.setterActual !== ctx.user.id) {
        return null;
      }

      return { ...lead, ...proyecciones };
    }),

  // Nombre e Instagram son campos propios de la entidad Lead (no proyecciones
  // del Event Log) — editables directamente, como marca la tabla de columnas
  // del Sprint 2.
  update: authedQuery
    .input(
      z.object({
        id: z.number(),
        nombre: z.string().optional(),
        instagramUsername: z.string().min(1, "Username requerido").optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      if (ctx.user.rol === "SETTER") {
        const proyecciones = (await obtenerProyeccionesLote(db, [input.id])).get(input.id) ?? PROYECCION_VACIA;
        if (proyecciones.setterActual !== ctx.user.id) {
          throw new Error("No tienes asignado este lead");
        }
      }

      const { id, ...data } = input;
      if (Object.keys(data).length === 0) {
        throw new Error("Nada para actualizar");
      }

      await db.update(leads).set(data).where(eq(leads.id, id));
      return db.query.leads.findFirst({ where: eq(leads.id, id) });
    }),

  assign: adminQuery
    .input(
      z.object({
        leadId: z.number(),
        setterId: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      const proyecciones = (await obtenerProyeccionesLote(db, [input.leadId])).get(input.leadId) ?? PROYECCION_VACIA;

      if (proyecciones.descartado) {
        throw new Error("El lead esta descartado. No se puede reasignar.");
      }

      const setterAnterior = proyecciones.setterActual;

      if (setterAnterior === input.setterId) {
        throw new Error("El lead ya esta asignado a ese setter");
      }

      await db.insert(eventos).values({
        tipo: "LEAD_ASIGNADO" as any,
        leadId: input.leadId,
        actorTipo: ctx.user.rol as any,
        actorId: ctx.user.id,
        payload: {
          setter_anterior: setterAnterior,
          setter_nuevo: input.setterId,
        },
      } as any);

      return { success: true };
    }),
});

type Proyeccion = {
  setterActual: number | null;
  etapaActual: string | null;
  descartado: boolean;
  motivoDescarte: string | null;
  seguimientosCount: number;
  ultimoContacto: Date | null;
  ultimaNota: string | null;
};

const PROYECCION_VACIA: Proyeccion = {
  setterActual: null,
  etapaActual: null,
  descartado: false,
  motivoDescarte: null,
  seguimientosCount: 0,
  ultimoContacto: null,
  ultimaNota: null,
};

// Trae en una sola query todos los eventos de los leads pedidos y calcula las
// proyecciones de cada uno en memoria — evita el N+1 de resolver lead por lead.
async function obtenerProyeccionesLote(
  db: ReturnType<typeof getDb>,
  leadIds: number[],
): Promise<Map<number, Proyeccion>> {
  const resultado = new Map<number, Proyeccion>();
  if (leadIds.length === 0) return resultado;

  const todosLosEventos = await db.query.eventos.findMany({
    where: inArray(eventos.leadId, leadIds),
    orderBy: [desc(eventos.timestamp)],
  });

  const porLead = new Map<number, typeof todosLosEventos>();
  for (const ev of todosLosEventos) {
    const lista = porLead.get(ev.leadId);
    if (lista) lista.push(ev);
    else porLead.set(ev.leadId, [ev]);
  }

  for (const leadId of leadIds) {
    // ya vienen ordenados desc por timestamp
    const eventosLead = porLead.get(leadId) ?? [];

    const ultimaAsignacion = eventosLead.find((e) => e.tipo === "LEAD_ASIGNADO");
    const setterActual = ultimaAsignacion
      ? (ultimaAsignacion.payload as { setter_nuevo: number }).setter_nuevo
      : null;

    const ultimoEstado = eventosLead.find((e) => e.tipo === "ESTADO_CAMBIADO");
    const etapaActual = ultimoEstado
      ? (ultimoEstado.payload as { estado_nuevo: string }).estado_nuevo
      : null;

    const descarte = eventosLead.find((e) => e.tipo === "LEAD_DESCARTADO");
    const descartado = !!descarte;
    const motivoDescarte = descarte
      ? (descarte.payload as { motivo: string }).motivo
      : null;

    const seguimientosCount = eventosLead.filter((e) => e.tipo === "SEGUIMIENTO_ENVIADO").length;

    const ultimaNotaEv = eventosLead.find((e) => e.tipo === "NOTA_AGREGADA");
    const ultimaNota = ultimaNotaEv
      ? (ultimaNotaEv.payload as { texto: string }).texto
      : null;

    const ultimoContacto = eventosLead[0]?.timestamp ?? null;

    resultado.set(leadId, {
      setterActual,
      etapaActual,
      descartado,
      motivoDescarte,
      seguimientosCount,
      ultimoContacto,
      ultimaNota,
    });
  }

  return resultado;
}
