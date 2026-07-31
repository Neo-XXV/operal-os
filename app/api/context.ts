import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import jwt from "jsonwebtoken";
import { env } from "./lib/env";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";
import { eq } from "drizzle-orm";

export type UserContext = {
  id: number;
  nombre: string;
  email: string;
  rol: "SETTER" | "MANAGER" | "ADMIN";
  activo: boolean;
};

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user?: UserContext;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const token = extractToken(opts.req);
  const user = token ? await resolveUser(token) : undefined;

  return {
    req: opts.req,
    resHeaders: opts.resHeaders,
    user,
  };
}

function extractToken(req: Request): string | undefined {
  const auth = req.headers.get("authorization");
  if (!auth) return undefined;
  const parts = auth.split(" ");
  if (parts.length === 2 && parts[0] === "Bearer") return parts[1];
  return undefined;
}

export async function resolveUser(token: string): Promise<UserContext | undefined> {
  try {
    const decoded = jwt.verify(token, env.jwtSecret) as {
      userId: number;
      purpose?: string;
    };
    // Allowlist, no denylist: exige purpose === "session" en vez de rechazar
    // los purpose conocidos (ej. "google_oauth_connect"). Cualquier JWT que
    // el sistema firme en el futuro para un uso mas acotado queda afuera de
    // esta funcion por default, sin depender de que alguien se acuerde de
    // agregarlo a una lista de exclusion (docs/11_auditoria_seguridad.md,
    // S2-A-1 -- el token "state" del OAuth de Google, de solo 10 min y
    // pensado unicamente para el callback, autenticaba requests a toda la
    // API porque esta funcion nunca revisaba el proposito del token).
    if (decoded.purpose !== "session") return undefined;
    const db = getDb();
    const row = await db.query.users.findFirst({
      where: eq(users.id, decoded.userId),
    });
    if (!row || !row.activo) return undefined;
    return {
      id: row.id,
      nombre: row.nombre,
      email: row.email,
      rol: row.rol as "SETTER" | "MANAGER" | "ADMIN",
      activo: row.activo,
    };
  } catch {
    return undefined;
  }
}
