import { createRouter, authedQuery, adminQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { googleCalendarConnections } from "@db/schema";

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
});
