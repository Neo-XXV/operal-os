import { z } from "zod";
import bcrypt from "bcryptjs";
import { createRouter, adminQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { users } from "@db/schema";
import { eq } from "drizzle-orm";

export const userRouter = createRouter({
  list: adminQuery.query(async () => {
    const db = getDb();
    return db.query.users.findMany({
      orderBy: (users, { desc }) => [desc(users.createdAt)],
    });
  }),

  create: adminQuery
    .input(
      z.object({
        nombre: z.string().min(1, "Nombre requerido"),
        email: z.string().email("Email invalido"),
        password: z.string().min(6, "Minimo 6 caracteres"),
        rol: z.enum(["SETTER", "MANAGER", "ADMIN"]),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db.query.users.findFirst({
        where: eq(users.email, input.email),
      });
      if (existing) {
        throw new Error("Ya existe un usuario con ese email");
      }
      const hash = await bcrypt.hash(input.password, 12);
      const [{ id }] = await db
        .insert(users)
        .values({
          nombre: input.nombre,
          email: input.email,
          passwordHash: hash,
          rol: input.rol,
        })
        .$returningId();
      const user = await db.query.users.findFirst({ where: eq(users.id, id) });
      return user;
    }),

  update: adminQuery
    .input(
      z.object({
        id: z.number(),
        nombre: z.string().min(1).optional(),
        email: z.string().email().optional(),
        rol: z.enum(["SETTER", "MANAGER", "ADMIN"]).optional(),
        activo: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      await db.update(users).set(data).where(eq(users.id, id));
      return db.query.users.findFirst({ where: eq(users.id, id) });
    }),

  toggleActive: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const user = await db.query.users.findFirst({
        where: eq(users.id, input.id),
      });
      if (!user) throw new Error("Usuario no encontrado");
      await db
        .update(users)
        .set({ activo: !user.activo })
        .where(eq(users.id, input.id));
      return db.query.users.findFirst({ where: eq(users.id, input.id) });
    }),

  // Lista de setters activos (para asignar leads)
  setters: adminQuery.query(async () => {
    const db = getDb();
    return db.query.users.findMany({
      where: eq(users.rol, "SETTER"),
    });
  }),
});
