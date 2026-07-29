import { createRouter, publicQuery } from "./middleware";
import { authRouter } from "./routers/auth";
import { userRouter } from "./routers/user";
import { leadRouter } from "./routers/lead";
import { eventRouter } from "./routers/event";
import { calendarRouter } from "./routers/calendar";
import { anomaliaRouter } from "./routers/anomalia";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  user: userRouter,
  lead: leadRouter,
  event: eventRouter,
  calendar: calendarRouter,
  anomalia: anomaliaRouter,
});

export type AppRouter = typeof appRouter;
