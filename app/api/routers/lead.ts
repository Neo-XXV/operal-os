import { z } from "zod";
import { createRouter, authedQuery, adminQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { leads, eventos } from "@db/schema";
import { eq, desc, and } from "drizzle-orm";

export const leadRouter = createRouter({
  // El setter carga el lead cuando decide contactarlo: LEAD_CREADO, la
  // auto-asignacion y la primera transicion (null -> A) ocurren en el mismo acto.
  // Admin/manager pueden cargar leads sin asignarlos ni moverlos de etapa todavia
  // (p.ej. carga en lote antes de repartir).
  create: authedQuery
    .input(
      z.object({
        nombre: z.string().min(1, "Nombre requerido"),
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

    const leadsConProyecciones = await Promise.all(
      allLeads.map(async (lead) => {
        const proyecciones = await obtenerProyecciones(db, lead.id);
        return { ...lead, ...proyecciones };
      }),
    );

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

      const proyecciones = await obtenerProyecciones(db, lead.id);

      if (ctx.user.rol === "SETTER" && proyecciones.setterActual !== ctx.user.id) {
        return null;
      }

      return { ...lead, ...proyecciones };
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

      const proyecciones = await obtenerProyecciones(db, input.leadId);

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

async function obtenerProyecciones(
  db: ReturnType<typeof getDb>,
  leadId: number,
) {
  const ultimaAsignacion = await db.query.eventos.findFirst({
    where: and(eq(eventos.leadId, leadId), eq(eventos.tipo, "LEAD_ASIGNADO")),
    orderBy: [desc(eventos.timestamp)],
  });

  const setterActual = ultimaAsignacion
    ? (ultimaAsignacion.payload as { setter_nuevo: number }).setter_nuevo
    : null;

  const ultimoEstado = await db.query.eventos.findFirst({
    where: and(
      eq(eventos.leadId, leadId),
      eq(eventos.tipo, "ESTADO_CAMBIADO"),
    ),
    orderBy: [desc(eventos.timestamp)],
  });

  const etapaActual = ultimoEstado
    ? (ultimoEstado.payload as { estado_nuevo: string }).estado_nuevo
    : null;

  const descarte = await db.query.eventos.findFirst({
    where: and(eq(eventos.leadId, leadId), eq(eventos.tipo, "LEAD_DESCARTADO")),
    orderBy: [desc(eventos.timestamp)],
  });

  const descartado = !!descarte;
  const motivoDescarte = descarte
    ? (descarte.payload as { motivo: string }).motivo
    : null;

  return { setterActual, etapaActual, descartado, motivoDescarte };
}
