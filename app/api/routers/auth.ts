import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createRouter, publicQuery, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { users } from "@db/schema";
import { eq } from "drizzle-orm";
import { env } from "../lib/env";

export const authRouter = createRouter({
  login: publicQuery
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const user = await db.query.users.findFirst({
        where: eq(users.email, input.email),
      });

      if (!user) {
        return { success: false, error: "Credenciales invalidas" };
      }

      if (!user.activo) {
        return { success: false, error: "Usuario desactivado" };
      }

      const valid = await bcrypt.compare(input.password, user.passwordHash);
      if (!valid) {
        return { success: false, error: "Credenciales invalidas" };
      }

      const token = jwt.sign({ userId: user.id }, env.jwtSecret, {
        expiresIn: "7d",
      });

      return {
        success: true,
        token,
        user: {
          id: user.id,
          nombre: user.nombre,
          email: user.email,
          rol: user.rol,
        },
      };
    }),

  me: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const user = await db.query.users.findFirst({
      where: eq(users.id, ctx.user.id),
    });
    if (!user) return null;
    return {
      id: user.id,
      nombre: user.nombre,
      email: user.email,
      rol: user.rol,
      activo: user.activo,
    };
  }),
});
