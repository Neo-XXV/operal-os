import { z } from "zod";
import { createRouter, authedQuery, adminQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { googleCalendarConnections, eventos, leads } from "@db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { verificarLeadActivo, obtenerEstadoActual, obtenerSetterActual } from "./event";
import { GoogleCalendarService } from "../lib/googleCalendarService";

// Sprint 5: el vinculo lead<->evento de Google vive en el payload de
// CALENDAR_EVENTO_CREADO/ACTUALIZADO (google_event_id), nunca en una tabla
// aparte -- "evento vigente" es el mas reciente de esos dos tipos para ese
// lead, mismo patron "ultimo evento gana" que obtenerEstadoActual. Ver
// docs/03_catalogo_eventos.md eventos 11-12.
async function obtenerCalendarVigente(db: ReturnType<typeof getDb>, leadId: number) {
  return db.query.eventos.findFirst({
    where: and(
      eq(eventos.leadId, leadId),
      inArray(eventos.tipo, ["CALENDAR_EVENTO_CREADO", "CALENDAR_EVENTO_ACTUALIZADO"]),
    ),
    orderBy: [desc(eventos.timestamp), desc(eventos.id)],
  });
}

async function verificarPermisoLead(db: ReturnType<typeof getDb>, leadId: number, ctx: { user: { rol: string; id: number } }) {
  if (ctx.user.rol === "SETTER") {
    const setterActual = await obtenerSetterActual(db, leadId);
    if (setterActual !== ctx.user.id) {
      throw new Error("No tienes asignado este lead");
    }
  }
  await verificarLeadActivo(db, leadId);
  const etapaActual = await obtenerEstadoActual(db, leadId);
  if (etapaActual !== "C" && etapaActual !== "D") {
    throw new Error("El lead debe estar en etapa C o D para agendar en Calendar.");
  }
}

export const calendarRouter = createRouter({
  // Todos los roles necesitan saber si esta conectado -- incluso el setter,
  // para entender por que el boton de "Agendar" puede estar deshabilitado.
  // Nunca expone la cuenta de Google conectada (el scope es solo Calendar,
  // no hay permiso para leer esa identidad) -- solo quien de OPERAL conecto.
  estado: authedQuery.query(async () => {
    const db = getDb();
    const conexion = await db.query.googleCalendarConnections.findFirst({
      with: { connectedBy: true },
    });
    if (!conexion) return { conectado: false as const };
    return {
      conectado: true as const,
      calendarId: conexion.calendarId,
      conectadoPor: { id: conexion.connectedBy.id, nombre: conexion.connectedBy.nombre },
      conectadoEn: conexion.connectedAt,
    };
  }),

  desconectar: adminQuery.mutation(async () => {
    const db = getDb();
    await db.delete(googleCalendarConnections);
    return { success: true };
  }),

  crearEvento: authedQuery
    .input(
      z.object({
        leadId: z.number(),
        fechaHoraInicio: z.string(),
        fechaHoraFin: z.string(),
        titulo: z.string().min(1),
        email: z.string().email().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const lead = await db.query.leads.findFirst({ where: eq(leads.id, input.leadId) });
      if (!lead) throw new Error("Lead no encontrado");

      await verificarPermisoLead(db, input.leadId, ctx);

      const vigente = await obtenerCalendarVigente(db, input.leadId);
      if (vigente) {
        throw new Error("Ya existe un evento de Calendar vigente para este lead. Usa 'Editar'.");
      }

      const service = await GoogleCalendarService.forConnection(db);
      if (!service) throw new Error("Google Calendar no esta conectado.");

      const inicio = new Date(input.fechaHoraInicio);
      const fin = new Date(input.fechaHoraFin);
      const invitados = input.email ? [input.email] : undefined;

      // Efecto de Google confirmado antes de tocar el Event Log -- si esto
      // tira, no se escribe nada en eventos (CALENDAR_EVENTO_CREADO solo
      // existe como efecto real de una llamada exitosa a Google).
      const { googleEventId } = await service.createEvent({ titulo: input.titulo, inicio, fin, invitados });

      // Email del lead: campo propio (no event-sourced, igual que
      // nombre/instagramUsername) -- se guarda si vino y difiere del actual.
      if (input.email && input.email !== lead.email) {
        await db.update(leads).set({ email: input.email }).where(eq(leads.id, input.leadId));
      }

      await db.insert(eventos).values({
        tipo: "CALENDAR_EVENTO_CREADO" as any,
        leadId: input.leadId,
        actorTipo: ctx.user.rol as any,
        actorId: ctx.user.id,
        payload: {
          google_event_id: googleEventId,
          calendar_id: service.calendarId,
          fecha_hora_inicio: inicio.toISOString(),
          fecha_hora_fin: fin.toISOString(),
          titulo: input.titulo,
          invitados,
        },
      } as any);

      return { success: true, googleEventId };
    }),

  editarEvento: authedQuery
    .input(
      z.object({
        leadId: z.number(),
        fechaHoraInicio: z.string(),
        fechaHoraFin: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      await verificarPermisoLead(db, input.leadId, ctx);

      const vigente = await obtenerCalendarVigente(db, input.leadId);
      if (!vigente) {
        throw new Error("Este lead todavia no tiene un evento de Calendar. Usa 'Agendar' primero.");
      }
      const googleEventId = (vigente.payload as { google_event_id: string }).google_event_id;

      const service = await GoogleCalendarService.forConnection(db);
      if (!service) throw new Error("Google Calendar no esta conectado.");

      const inicio = new Date(input.fechaHoraInicio);
      const fin = new Date(input.fechaHoraFin);
      await service.updateEvent(googleEventId, { inicio, fin });

      await db.insert(eventos).values({
        tipo: "CALENDAR_EVENTO_ACTUALIZADO" as any,
        leadId: input.leadId,
        actorTipo: ctx.user.rol as any,
        actorId: ctx.user.id,
        payload: {
          google_event_id: googleEventId,
          fecha_hora_inicio: inicio.toISOString(),
          fecha_hora_fin: fin.toISOString(),
        },
      } as any);

      return { success: true };
    }),

  listarEventos: authedQuery
    .input(z.object({ desde: z.string(), hasta: z.string() }))
    .query(async ({ input }) => {
      const db = getDb();
      const service = await GoogleCalendarService.forConnection(db);
      if (!service) return { conectado: false as const, eventos: [] };

      const googleEventos = await service.listEvents({
        timeMin: new Date(input.desde),
        timeMax: new Date(input.hasta),
      });

      // Cruce contra los CALENDAR_EVENTO_CREADO del sistema para marcar
      // cuales son leads de OPERAL vs eventos externos -- volumen chico (a
      // lo sumo un vigente por lead), una sola query, sin N+1.
      const creados = await db.query.eventos.findMany({
        where: eq(eventos.tipo, "CALENDAR_EVENTO_CREADO"),
        with: { lead: true },
      });
      const porGoogleEventId = new Map<string, { leadId: number; leadNombre: string }>();
      for (const ev of creados) {
        const googleEventId = (ev.payload as { google_event_id: string }).google_event_id;
        if (ev.lead) porGoogleEventId.set(googleEventId, { leadId: ev.leadId, leadNombre: ev.lead.nombre });
      }

      return {
        conectado: true as const,
        eventos: googleEventos.map((ev) => {
          const vinculo = porGoogleEventId.get(ev.id);
          return {
            ...ev,
            esOperalLead: !!vinculo,
            leadId: vinculo?.leadId ?? null,
            leadNombre: vinculo?.leadNombre ?? null,
          };
        }),
      };
    }),
});
