import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import jwt from "jsonwebtoken";
import { env } from "./env";
import { resolveUser } from "../context";
import { encrypt } from "./crypto";
import { exchangeCodeForTokens } from "./googleCalendarService";
import { getDb } from "../queries/connection";
import { googleCalendarConnections } from "@db/schema";
import { eq } from "drizzle-orm";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

// Flujo OAuth de Google -- navegacion de pagina completa, no puede ir por
// tRPC (no hay forma de mandar un Authorization: Bearer en un redirect del
// navegador). El token de sesion viaja como query param en /connect, y el
// "state" firmado con el mismo jwtSecret hace de proteccion CSRF + recupera
// que admin inicio el flujo, sin infraestructura de sesion nueva.
//
// Ambas rutas quedan bajo /api/* a proposito: en dev, vite.config.ts excluye
// de Hono todo lo que no empiece con /api/ (devServer exclude regex), asi
// que una ruta como /auth/google nunca llegaria al handler en npm run dev.
export function registerGoogleAuthRoutes(app: Hono<{ Bindings: HttpBindings }>) {
  app.get("/api/auth/google", async (c) => {
    const token = c.req.query("token");
    const user = token ? await resolveUser(token) : undefined;
    if (!user) {
      return c.redirect("/calendario?error=unauthorized");
    }
    if (user.rol === "SETTER") {
      return c.redirect("/calendario?error=forbidden");
    }

    const state = jwt.sign({ userId: user.id, purpose: "google_oauth_connect" }, env.jwtSecret, {
      expiresIn: "10m",
    });

    const params = new URLSearchParams({
      client_id: env.googleClientId,
      redirect_uri: env.googleRedirectUri,
      response_type: "code",
      scope: CALENDAR_SCOPE,
      access_type: "offline",
      prompt: "consent",
      state,
    });
    return c.redirect(`${GOOGLE_AUTH_URL}?${params}`);
  });

  app.get("/api/auth/google/callback", async (c) => {
    const errorParam = c.req.query("error");
    if (errorParam) {
      return c.redirect(`/calendario?error=${errorParam}`);
    }

    const state = c.req.query("state");
    const code = c.req.query("code");
    if (!state || !code) {
      return c.redirect("/calendario?error=missing_params");
    }

    let userId: number;
    try {
      const decoded = jwt.verify(state, env.jwtSecret) as { userId: number; purpose: string };
      if (decoded.purpose !== "google_oauth_connect") throw new Error("purpose invalido");
      userId = decoded.userId;
    } catch {
      return c.redirect("/calendario?error=invalid_state");
    }

    try {
      const tokens = await exchangeCodeForTokens(code);
      if (!tokens.refresh_token) {
        // Pasa si Google ya habia emitido un refresh_token antes y el
        // usuario no ve el consent screen de nuevo pese a prompt=consent
        // (caso raro, pero sin refresh_token no hay nada que guardar).
        return c.redirect("/calendario?error=no_refresh_token");
      }
      if (!tokens.scope.includes("calendar")) {
        return c.redirect("/calendario?error=scope_incompleto");
      }

      const db = getDb();
      const refreshTokenEncrypted = encrypt(tokens.refresh_token);
      const existente = await db.query.googleCalendarConnections.findFirst();
      if (existente) {
        await db
          .update(googleCalendarConnections)
          .set({ refreshTokenEncrypted, connectedByUserId: userId })
          .where(eq(googleCalendarConnections.id, existente.id));
      } else {
        await db.insert(googleCalendarConnections).values({
          refreshTokenEncrypted,
          connectedByUserId: userId,
        });
      }

      return c.redirect("/calendario?connected=1");
    } catch (err) {
      console.error("Error en callback de Google OAuth:", err);
      return c.redirect("/calendario?error=token_exchange_failed");
    }
  });
}
