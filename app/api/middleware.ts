import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const createRouter = t.router;
export const publicQuery = t.procedure;

// ─── Procedimiento autenticado (cualquier usuario logueado) ──────────
export const authedQuery = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "No autenticado" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

// ─── Procedimiento para ADMIN / MANAGER (Sprint 1) ──────────────────
// En Sprint 1, MANAGER tiene los mismos permisos que ADMIN.
export const adminQuery = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "No autenticado" });
  }
  if (ctx.user.rol === "SETTER") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Requiere rol ADMIN o MANAGER",
    });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

// ─── Procedimiento para SETTER (solo setters autenticados) ───────────
export const setterQuery = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "No autenticado" });
  }
  if (ctx.user.rol !== "SETTER") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Requiere rol SETTER" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});
