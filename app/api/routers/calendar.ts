import { z } from "zod";
import { createRouter, authedQuery, adminQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { googleCalendarConnections, eventos, leads } from "@db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { verificarLeadActivo, obtenerEstadoActual, obtenerSetterActual, conLeadId } from "./event";
import { GoogleCalendarService } from "../lib/googleCalendarService";

const TIPOS_CALENDAR = [
  "CALENDAR_EVENTO_CREADO",
  "CALENDAR_EVENTO_ACTUALIZADO",
  "CALENDAR_EVENTO_SINCRONIZADO",
] as const;

type CalendarEventoPayload = {
  google_event_id: string | null;
  calendar_id?: string;
  fecha_hora_inicio: string;
  fecha_hora_fin: string;
  titulo?: string;
  invitados?: string[];
};

// Sprint 5b: el evento local es el canonico -- vive siempre en el payload de
// CALENDAR_EVENTO_CREADO/ACTUALIZADO/SINCRONIZADO, nunca en una tabla aparte.
// "Evento vigente" es el mas reciente de los 3 tipos para ese lead, mismo
// patron "ultimo evento gana" que obtenerEstadoActual. Ver
// docs/03_catalogo_eventos.md eventos 11-13.
export async function obtenerCalendarVigente(db: ReturnType<typeof getDb>, leadId: number) {
  return db.query.eventos.findFirst({
    where: and(eq(eventos.leadId, leadId), inArray(eventos.tipo, TIPOS_CALENDAR)),
    orderBy: [desc(eventos.timestamp), desc(eventos.id)],
  });
}

// A lo sumo un CALENDAR_EVENTO_CREADO por lead (crearEvento rechaza si ya
// existe un vigente) -- es la unica fuente de titulo/invitados, que los
// eventos de ACTUALIZADO/SINCRONIZADO no repiten en su payload.
async function obtenerCalendarCreacion(db: ReturnType<typeof getDb>, leadId: number) {
  return db.query.eventos.findFirst({
    where: and(eq(eventos.leadId, leadId), eq(eventos.tipo, "CALENDAR_EVENTO_CREADO")),
  });
}

// Scoping por rol para las vistas de agenda -- hallazgo A-2
// (docs/11_auditoria_seguridad.md). Un SETTER ve estrictamente los eventos
// de calendario de SUS leads: ni nombres, ni horarios, ni slots ocupados
// anonimizados de leads ajenos (criterio confirmado con el dueño del
// producto). El ADMIN/MANAGER ve todos. Mismo patron que embudoPorSetter
// y que el filtro de TIPOS_SOLO_ADMIN en event.ts: la barrera es el rol
// del contexto, nunca lo que mande el cliente.
async function leadIdsVisiblesPara(
  db: ReturnType<typeof getDb>,
  ctx: { user: { rol: string; id: number } },
  leadIds: number[],
): Promise<Set<number>> {
  if (ctx.user.rol !== "SETTER" || leadIds.length === 0) return new Set(leadIds);

  const asignaciones = await db.query.eventos.findMany({
    where: and(inArray(eventos.leadId, leadIds), eq(eventos.tipo, "LEAD_ASIGNADO")),
    orderBy: [desc(eventos.timestamp), desc(eventos.id)],
  });

  // "Setter actual" = ultimo LEAD_ASIGNADO por lead (mismo criterio que
  // obtenerSetterActual, pero en lote para no hacer N+1).
  const setterPorLead = new Map<number, number>();
  for (const ev of asignaciones) {
    const leadId = ev.leadId as number;
    if (!setterPorLead.has(leadId)) {
      setterPorLead.set(leadId, (ev.payload as { setter_nuevo: number }).setter_nuevo);
    }
  }

  return new Set(leadIds.filter((id) => setterPorLead.get(id) === ctx.user.id));
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

function mensajeError(err: unknown): string {
  return err instanceof Error ? err.message : "No se pudo sincronizar con Google Calendar.";
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

      const inicio = new Date(input.fechaHoraInicio);
      const fin = new Date(input.fechaHoraFin);
      const invitados = input.email ? [input.email] : undefined;

      // El evento local es el canonico -- se guarda siempre. La
      // sincronizacion con Google es un efecto adicional que nunca bloquea
      // ni revierte esta escritura (docs/02_reglas_de_negocio (1).md
      // seccion 8).
      let googleEventId: string | null = null;
      let calendarId: string | undefined;
      let syncWarning: string | undefined;
      try {
        const service = await GoogleCalendarService.forConnection(db);
        if (service) {
          const resultado = await service.createEvent({ titulo: input.titulo, inicio, fin, invitados });
          googleEventId = resultado.googleEventId;
          calendarId = service.calendarId;
        }
      } catch (err) {
        // forConnection() tambien puede tirar (token invalido/corrupto,
        // refresh fallido) -- tiene que quedar adentro del mismo try que
        // createEvent, si no un fallo ahi se escapa y aborta la mutacion
        // entera, contradiciendo "el evento local se guarda siempre".
        syncWarning = mensajeError(err);
      }

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
          calendar_id: calendarId,
          fecha_hora_inicio: inicio.toISOString(),
          fecha_hora_fin: fin.toISOString(),
          titulo: input.titulo,
          invitados,
        },
      } as any);

      return { success: true, googleEventId, syncWarning };
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
      const vigentePayload = vigente.payload as CalendarEventoPayload;

      const inicio = new Date(input.fechaHoraInicio);
      const fin = new Date(input.fechaHoraFin);

      let googleEventId = vigentePayload.google_event_id;
      let syncWarning: string | undefined;
      try {
        const service = await GoogleCalendarService.forConnection(db);
        if (service) {
          if (googleEventId) {
            await service.updateEvent(googleEventId, { inicio, fin });
          } else {
            // Nunca se habia sincronizado -- se aprovecha esta edicion para
            // crearlo en Google recien ahora, en vez de esperar un
            // "Sincronizar" aparte (docs/02_reglas_de_negocio (1).md
            // seccion 8).
            const creacion = await obtenerCalendarCreacion(db, input.leadId);
            const creacionPayload = creacion?.payload as CalendarEventoPayload | undefined;
            const resultado = await service.createEvent({
              titulo: creacionPayload?.titulo ?? "Llamada",
              inicio,
              fin,
              invitados: creacionPayload?.invitados,
            });
            googleEventId = resultado.googleEventId;
          }
        }
      } catch (err) {
        // Mismo motivo que en crearEvento: forConnection() puede tirar y
        // tiene que quedar adentro del try, no solo las llamadas a Google.
        syncWarning = mensajeError(err);
      }

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

      return { success: true, googleEventId, syncWarning };
    }),

  // Empuja a Google un evento vigente que quedo sin sincronizar (creado o
  // editado sin conexion, o cuya sincronizacion fallo). A diferencia de
  // crear/editar, si esto falla no se escribe nada -- el unico motivo de
  // este evento es registrar que el link con Google existe.
  sincronizarEvento: authedQuery
    .input(z.object({ leadId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      await verificarPermisoLead(db, input.leadId, ctx);

      const vigente = await obtenerCalendarVigente(db, input.leadId);
      if (!vigente) {
        throw new Error("Este lead no tiene un evento de Calendar para sincronizar.");
      }
      const vigentePayload = vigente.payload as CalendarEventoPayload;
      if (vigentePayload.google_event_id) {
        throw new Error("Este evento ya esta sincronizado con Google.");
      }

      const service = await GoogleCalendarService.forConnection(db);
      if (!service) throw new Error("Google Calendar no esta conectado.");

      const creacion = await obtenerCalendarCreacion(db, input.leadId);
      const creacionPayload = creacion?.payload as CalendarEventoPayload | undefined;

      const inicio = new Date(vigentePayload.fecha_hora_inicio);
      const fin = new Date(vigentePayload.fecha_hora_fin);
      const { googleEventId } = await service.createEvent({
        titulo: creacionPayload?.titulo ?? "Llamada",
        inicio,
        fin,
        invitados: creacionPayload?.invitados,
      });

      await db.insert(eventos).values({
        tipo: "CALENDAR_EVENTO_SINCRONIZADO" as any,
        leadId: input.leadId,
        actorTipo: ctx.user.rol as any,
        actorId: ctx.user.id,
        payload: {
          google_event_id: googleEventId,
          fecha_hora_inicio: vigentePayload.fecha_hora_inicio,
          fecha_hora_fin: vigentePayload.fecha_hora_fin,
        },
      } as any);

      return { success: true, googleEventId };
    }),

  // Agenda interna de OPERAL OS -- lee directo de eventos, nunca llama a
  // Google. Es la fuente confiable para cualquier cosa que necesite la
  // fecha de la llamada sin depender de que haya conexion en ese momento
  // (docs/02_reglas_de_negocio (1).md seccion 8).
  listarEventosLocales: authedQuery
    .input(z.object({ desde: z.string(), hasta: z.string() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();

      // Volumen chico (a lo sumo un vigente por lead) -- se trae todo el
      // universo de eventos de calendario y se agrupa en memoria, mismo
      // criterio ya usado en dashboardLlamadas/listarEventos.
      const todos = conLeadId(await db.query.eventos.findMany({
        where: inArray(eventos.tipo, TIPOS_CALENDAR),
        orderBy: [desc(eventos.timestamp), desc(eventos.id)],
        with: { lead: true },
      }));

      const vigentePorLead = new Map<number, (typeof todos)[number]>();
      const creacionPorLead = new Map<number, { titulo?: string }>();
      for (const ev of todos) {
        if (!vigentePorLead.has(ev.leadId)) vigentePorLead.set(ev.leadId, ev);
        if (ev.tipo === "CALENDAR_EVENTO_CREADO" && !creacionPorLead.has(ev.leadId)) {
          creacionPorLead.set(ev.leadId, { titulo: (ev.payload as CalendarEventoPayload).titulo });
        }
      }

      // Un lead descartado despues de agendar no debe seguir apareciendo en
      // la agenda -- mismo criterio que leadsParaLlamar (Sprint 4), que
      // tampoco muestra leads descartados en sus listas operativas.
      const leadIds = [...vigentePorLead.keys()];
      const [descartes, visibles] = await Promise.all([
        leadIds.length
          ? db.query.eventos.findMany({
              where: and(inArray(eventos.leadId, leadIds), eq(eventos.tipo, "LEAD_DESCARTADO")),
            })
          : Promise.resolve([]),
        leadIdsVisiblesPara(db, ctx, leadIds),
      ]);
      const leadsDescartados = new Set(descartes.map((d) => d.leadId));

      const resultado: {
        leadId: number;
        leadNombre: string;
        titulo: string;
        fechaHoraInicio: string;
        fechaHoraFin: string;
        googleEventId: string | null;
      }[] = [];
      for (const ev of vigentePorLead.values()) {
        if (!ev.lead || leadsDescartados.has(ev.leadId)) continue;
        if (!visibles.has(ev.leadId)) continue;
        const payload = ev.payload as CalendarEventoPayload;
        if (payload.fecha_hora_inicio < input.desde || payload.fecha_hora_inicio > input.hasta) continue;
        resultado.push({
          leadId: ev.leadId,
          leadNombre: ev.lead.nombre,
          titulo: creacionPorLead.get(ev.leadId)?.titulo ?? `Llamada con ${ev.lead.nombre}`,
          fechaHoraInicio: payload.fecha_hora_inicio,
          fechaHoraFin: payload.fecha_hora_fin,
          googleEventId: payload.google_event_id,
        });
      }
      return resultado;
    }),

  listarEventos: authedQuery
    .input(z.object({ desde: z.string(), hasta: z.string() }))
    .query(async ({ ctx, input }) => {
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
      const creados = conLeadId(await db.query.eventos.findMany({
        where: eq(eventos.tipo, "CALENDAR_EVENTO_CREADO"),
        with: { lead: true },
      }));
      const porGoogleEventId = new Map<string, { leadId: number; leadNombre: string }>();
      for (const ev of creados) {
        const googleEventId = (ev.payload as CalendarEventoPayload).google_event_id;
        if (googleEventId && ev.lead) porGoogleEventId.set(googleEventId, { leadId: ev.leadId, leadNombre: ev.lead.nombre });
      }

      const visibles = await leadIdsVisiblesPara(db, ctx, [...new Set([...porGoogleEventId.values()].map((v) => v.leadId))]);

      const enriquecidos = googleEventos.map((ev) => {
        const vinculo = porGoogleEventId.get(ev.id);
        return {
          ...ev,
          esOperalLead: !!vinculo,
          leadId: vinculo?.leadId ?? null,
          leadNombre: vinculo?.leadNombre ?? null,
        };
      });

      // El calendario de Google es compartido por la agencia: trae tanto
      // eventos de leads de OPERAL como eventos externos ajenos al sistema.
      // Para un SETTER se deja UNICAMENTE lo vinculado a sus propios leads
      // -- los de otros setters filtran datos ajenos (A-2), y los externos
      // no son "sus eventos de calendario" bajo el criterio estricto
      // acordado. El ADMIN sigue viendo el calendario completo.
      const eventosVisibles =
        ctx.user.rol === "SETTER"
          ? enriquecidos.filter((ev) => ev.leadId !== null && visibles.has(ev.leadId))
          : enriquecidos;

      return { conectado: true as const, eventos: eventosVisibles };
    }),
});
