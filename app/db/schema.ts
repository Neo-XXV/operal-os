import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
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
    // Sprint 5: campo propio del Lead (como nombre/instagramUsername, no
    // event-sourced) -- el scraping no trae email, se carga a mano cuando
    // hace falta para agendar en Calendar (docs/02_reglas_de_negocio (1).md
    // seccion 8).
    email: varchar("email", { length: 320 }),
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
      "LLAMADA_REGISTRADA",
      "PAGO_REGISTRADO",
      "CALENDAR_EVENTO_CREADO",
      "CALENDAR_EVENTO_ACTUALIZADO",
      "CALENDAR_EVENTO_SINCRONIZADO",
      "ANOMALIA_DETECTADA",
    ]).notNull(),
    // Nullable: unico caso es ANOMALIA_DETECTADA de nivel SETTER/EQUIPO (sin
    // lead asociado) -- ver docs/03_catalogo_eventos.md evento 14.
    leadId: bigint("lead_id", { mode: "number", unsigned: true }),
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

// ─── Google Calendar (Sprint 5) ─────────────────────────────────────────
// Conexion unica, agencywide (no por-usuario) -- ver
// docs/02_reglas_de_negocio (1).md seccion 8. Fila unica esperada por
// convencion de la app, no por constraint de DB (mismo criterio laxo que el
// resto del schema, sin FKs reales).

export const googleCalendarConnections = mysqlTable("google_calendar_connections", {
  id: serial("id").primaryKey(),
  calendarId: varchar("calendar_id", { length: 255 }).notNull().default("primary"),
  refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
  connectedByUserId: bigint("connected_by_user_id", { mode: "number", unsigned: true }).notNull(),
  connectedAt: timestamp("connected_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export type GoogleCalendarConnection = typeof googleCalendarConnections.$inferSelect;
export type InsertGoogleCalendarConnection = typeof googleCalendarConnections.$inferInsert;
