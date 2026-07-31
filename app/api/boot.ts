import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { registerGoogleAuthRoutes } from "./lib/googleAuth";
import { iniciarSchedulerAnomalias } from "./lib/anomaliaScheduler";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
registerGoogleAuthRoutes(app);
iniciarSchedulerAnomalias();
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  // Sin host explicito: @hono/node-server escucha en todas las interfaces
  // por defecto (verificado: bindea "::", no solo loopback), que es lo que
  // necesita un host como Railway para rutear trafico al contenedor. El
  // puerto SIEMPRE viene de PORT -- Railway lo asigna dinamicamente, nunca
  // es un valor fijo que el codigo pueda asumir.
  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server listening on port ${port}`);
  });
}
