import { drizzle, eq, and, sql, inArray } from "./drizzle-shared.ts";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { users, leads, eventos } from "../../app/db/schema.ts";
import type { EventoCandidato, LeadImportado, EstadoConocido, Etapa } from "./parse.ts";

export const JORGE_EMAIL = "jorge.historico@operal.local";
export const JORGE_NOMBRE = "Jorge (historico)";

export function crearConexion(databaseUrl: string) {
  return drizzle(databaseUrl, { mode: "planetscale", schema: { users, leads, eventos } });
}

export async function obtenerOCrearJorge(db: ReturnType<typeof crearConexion>): Promise<number> {
  const existente = await db.select().from(users).where(eq(users.email, JORGE_EMAIL)).limit(1);
  if (existente.length > 0) return existente[0].id;

  const hash = await bcrypt.hash(randomUUID(), 12); // nunca va a loguearse
  const [{ id }] = await db
    .insert(users)
    .values({
      nombre: JORGE_NOMBRE,
      email: JORGE_EMAIL,
      passwordHash: hash,
      rol: "SETTER",
      activo: false,
    })
    .$returningId();
  return id;
}

async function obtenerOCrearLead(
  db: ReturnType<typeof crearConexion>,
  username: string,
  nombre: string,
): Promise<number> {
  const existente = await db
    .select()
    .from(leads)
    .where(sql`LOWER(${leads.instagramUsername}) = ${username.toLowerCase()}`)
    .limit(1);
  if (existente.length > 0) return existente[0].id;

  const [{ id }] = await db
    .insert(leads)
    .values({ nombre, instagramUsername: username })
    .$returningId();
  return id;
}

// Nota: LEAD_ASIGNADO no incluye el setter en la clave -- este script solo
// genera una asignacion por lead (a Jorge), y el candidato en memoria usa el
// placeholder "JORGE" mientras que lo leido de la DB ya tiene el id numerico
// real. Si algun dia esto importa reasignaciones reales, hay que revisar esto.
function claveSemantica(ev: EventoCandidato): string {
  switch (ev.tipo) {
    case "LEAD_CREADO":
      return "LEAD_CREADO";
    case "LEAD_ASIGNADO":
      return "LEAD_ASIGNADO";
    case "ESTADO_CAMBIADO":
      return `ESTADO_CAMBIADO:${ev.payload.estado_nuevo}`;
    case "SEGUIMIENTO_ENVIADO":
      return `SEGUIMIENTO_ENVIADO:${ev.payload.etapa}:${ev.payload.numero}`;
  }
}

async function clavesExistentes(db: ReturnType<typeof crearConexion>, leadId: number): Promise<Set<string>> {
  const filas = await db.select().from(eventos).where(eq(eventos.leadId, leadId));
  const claves = new Set<string>();
  for (const ev of filas) {
    const payload = ev.payload as Record<string, unknown>;
    switch (ev.tipo) {
      case "LEAD_CREADO":
        claves.add("LEAD_CREADO");
        break;
      case "LEAD_ASIGNADO":
        claves.add("LEAD_ASIGNADO");
        break;
      case "ESTADO_CAMBIADO":
        claves.add(`ESTADO_CAMBIADO:${payload.estado_nuevo}`);
        break;
      case "SEGUIMIENTO_ENVIADO":
        claves.add(`SEGUIMIENTO_ENVIADO:${payload.etapa}:${payload.numero}`);
        break;
    }
  }
  return claves;
}

// Precarga el estado conocido (etapa actual + nombre) de todos los leads ya
// importados por Jorge en corridas anteriores (ej: Julio, ya en la base real)
// -- necesario para que un mes posterior reconozca la continuacion de un
// lead cuyo bloque A esta en un mes YA importado, en vez de marcarlo huerfano.
export async function obtenerEstadoConocido(
  db: ReturnType<typeof crearConexion>,
  jorgeId: number,
): Promise<Map<string, EstadoConocido>> {
  const leadsDeJorge = await db
    .select({ id: leads.id, nombre: leads.nombre, instagramUsername: leads.instagramUsername })
    .from(leads)
    .innerJoin(eventos, eq(eventos.leadId, leads.id))
    .where(and(eq(eventos.tipo, "LEAD_CREADO"), eq(eventos.actorId, jorgeId)));

  const resultado = new Map<string, EstadoConocido>();
  if (leadsDeJorge.length === 0) return resultado;

  const idsUnicos = [...new Set(leadsDeJorge.map((l) => l.id))];
  const cambios = await db
    .select()
    .from(eventos)
    .where(and(eq(eventos.tipo, "ESTADO_CAMBIADO"), inArray(eventos.leadId, idsUnicos)));

  // mismo criterio de desempate que el resto de la app: timestamp, luego id.
  const ultimoPorLead = new Map<number, { timestamp: Date; id: number; estado: string }>();
  for (const ev of cambios) {
    const estado = (ev.payload as { estado_nuevo: string }).estado_nuevo;
    const actual = ultimoPorLead.get(ev.leadId);
    if (!actual || ev.timestamp > actual.timestamp || (ev.timestamp.getTime() === actual.timestamp.getTime() && ev.id > actual.id)) {
      ultimoPorLead.set(ev.leadId, { timestamp: ev.timestamp, id: ev.id, estado });
    }
  }

  for (const lead of leadsDeJorge) {
    const etapa = (ultimoPorLead.get(lead.id)?.estado ?? "A") as Etapa;
    resultado.set(lead.instagramUsername.toLowerCase(), { etapa, nombre: lead.nombre });
  }
  return resultado;
}

export type ResumenImportLead = {
  enlace: string;
  leadId: number;
  eventosInsertados: number;
  eventosYaExistentes: number;
};

// Idempotente: por cada lead, busca/crea el lead real, calcula que eventos ya
// existen (por clave semantica) y solo inserta los que faltan. Todo el lead
// (alta + eventos nuevos) va en una unica transaccion.
export async function importarLead(
  db: ReturnType<typeof crearConexion>,
  jorgeId: number,
  lead: LeadImportado,
): Promise<ResumenImportLead> {
  return db.transaction(async (tx) => {
    const leadId = await obtenerOCrearLead(tx as never, lead.enlace, lead.nombre);
    const yaExistentes = await clavesExistentes(tx as never, leadId);

    let insertados = 0;
    let yaEstaban = 0;

    for (const ev of lead.eventos) {
      const clave = claveSemantica(ev);
      if (yaExistentes.has(clave)) {
        yaEstaban++;
        continue;
      }

      const payload =
        ev.tipo === "LEAD_ASIGNADO"
          ? { setter_anterior: null, setter_nuevo: jorgeId }
          : ev.payload;

      await tx.insert(eventos).values({
        tipo: ev.tipo,
        leadId,
        actorTipo: "SETTER",
        actorId: jorgeId,
        timestamp: ev.timestamp,
        payload,
      } as typeof eventos.$inferInsert);

      yaExistentes.add(clave);
      insertados++;
    }

    return { enlace: lead.enlace, leadId, eventosInsertados: insertados, eventosYaExistentes: yaEstaban };
  });
}
