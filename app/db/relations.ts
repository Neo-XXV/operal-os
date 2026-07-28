import { relations } from "drizzle-orm";
import { users, leads, eventos, googleCalendarConnections } from "./schema";

export const usersRelations = relations(users, ({ many }) => ({
  eventos: many(eventos),
}));

export const leadsRelations = relations(leads, ({ many }) => ({
  eventos: many(eventos),
}));

export const eventosRelations = relations(eventos, ({ one }) => ({
  lead: one(leads, {
    fields: [eventos.leadId],
    references: [leads.id],
  }),
  actor: one(users, {
    fields: [eventos.actorId],
    references: [users.id],
  }),
}));

export const googleCalendarConnectionsRelations = relations(googleCalendarConnections, ({ one }) => ({
  connectedBy: one(users, {
    fields: [googleCalendarConnections.connectedByUserId],
    references: [users.id],
  }),
}));
