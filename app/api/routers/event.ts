import { z } from "zod";
import { createRouter, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { leads, eventos } from "@db/schema";
import { eq, desc, and } from "drizzle-orm";

async function verificarLeadActivo(db: ReturnType<typeof getDb>, leadId: number) {
  const descarte = await db.query.eventos.findFirst({
    where: and(eq(eventos.leadId, leadId), eq(eventos.tipo, "LEAD_DESCARTADO")),
    orderBy: [desc(eventos.timestamp)],
  });
  if (descarte) throw new Error("El lead esta descartado. No se pueden registrar nuevos eventos.");
}

async function obtenerSetterActual(db: ReturnType<typeof getDb>, leadId: number) {
  const ultimaAsignacion = await db.query.eventos.findFirst({
    where: and(eq(eventos.leadId, leadId), eq(eventos.tipo, "LEAD_ASIGNADO")),
    orderBy: [desc(eventos.timestamp)],
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
    orderBy: [desc(eventos.timestamp)],
  });
  return ultimo
    ? (ultimo.payload as { estado_nuevo: string }).estado_nuevo
    : null;
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

      if (input.tipo === "ESTADO_CAMBIADO") {
        const payload = input.payload as { estado_anterior: string; estado_nuevo: string };
        const estadoActual = await obtenerEstadoActual(db, input.leadId);
        await verificarLeadActivo(db, input.leadId);
        validarTransicion(estadoActual, payload.estado_nuevo);
      }

      if (input.tipo === "SEGUIMIENTO_ENVIADO") {
        await verificarLeadActivo(db, input.leadId);
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
        payload: input.payload,
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
        orderBy: [desc(eventos.timestamp)],
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
          orderBy: [desc(eventos.timestamp)],
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
          orderBy: [desc(eventos.timestamp)],
          limit: input?.limit ?? 50,
          offset: input?.offset ?? 0,
          with: { lead: true, actor: true },
        });
      }

      return db.query.eventos.findMany({
        orderBy: [desc(eventos.timestamp)],
        limit: input?.limit ?? 50,
        offset: input?.offset ?? 0,
        with: { lead: true, actor: true },
      });
    }),
});
