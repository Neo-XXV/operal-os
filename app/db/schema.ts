import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  timestamp,
  bigint,
  json,
  boolean,
  index,
} from "drizzle-orm/mysql-core";

// ─── Users ───────────────────────────────────────────────────────────
// Nota: No existe "setter" como entidad independiente. Un Usuario con rol=SETTER
// puede recibir asignaciones de leads. V1: setter ya existe como usuario activo.

export const users = mysqlTable(
  "users",
  {
    id: serial("id").primaryKey(),
    nombre: varchar("nombre", { length: 255 }).notNull(),
    email: varchar("email", { length: 320 }).notNull().unique(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    rol: mysqlEnum("rol", ["SETTER", "MANAGER", "ADMIN"]).notNull(),
    activo: boolean("activo").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    emailIdx: index("email_idx").on(table.email),
    rolIdx: index("rol_idx").on(table.rol),
  })
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Leads ───────────────────────────────────────────────────────────
// Importante: Lead NO guarda etapa_actual, setter_asignado ni creado_en
// como campos propios — todos son proyecciones derivadas del Event Log.

export const leads = mysqlTable(
  "leads",
  {
    id: serial("id").primaryKey(),
    nombre: varchar("nombre", { length: 255 }).notNull(),
    instagramUsername: varchar("instagram_username", { length: 255 }).notNull(),
  },
  (table) => ({
    igIdx: index("ig_username_idx").on(table.instagramUsername),
  })
);

export type Lead = typeof leads.$inferSelect;
export type InsertLead = typeof leads.$inferInsert;

// ─── Eventos ─────────────────────────────────────────────────────────
// La entidad central del sistema. El Event Log es la unica fuente de verdad.
// Cada evento es inmutable: una vez creado, no se edita ni se elimina.

export const eventos = mysqlTable(
  "eventos",
  {
    id: serial("id").primaryKey(),
    tipo: mysqlEnum("tipo", [
      "LEAD_CREADO",
      "LEAD_ASIGNADO",
      "ESTADO_CAMBIADO",
      "SEGUIMIENTO_ENVIADO",
      "RESPUESTA_RECIBIDA",
      "OBJECION_REGISTRADA",
      "LEAD_DESCARTADO",
      "NOTA_AGREGADA",
    ]).notNull(),
    leadId: bigint("lead_id", { mode: "number", unsigned: true }).notNull(),
    actorTipo: mysqlEnum("actor_tipo", ["SETTER", "MANAGER", "ADMIN", "SISTEMA"])
      .notNull(),
    actorId: bigint("actor_id", {
      mode: "number",
      unsigned: true,
    }),
    timestamp: timestamp("timestamp").notNull().defaultNow(),
    payload: json("payload").notNull(),
  },
  (table) => ({
    leadIdx: index("event_lead_idx").on(table.leadId),
    tipoIdx: index("event_tipo_idx").on(table.tipo),
    timestampIdx: index("event_timestamp_idx").on(table.timestamp),
  })
);

export type Evento = typeof eventos.$inferSelect;
export type InsertEvento = typeof eventos.$inferInsert;
