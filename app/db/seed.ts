import { drizzle } from "drizzle-orm/mysql2";
import bcrypt from "bcryptjs";
import * as schema from "./schema";
import "dotenv/config";

const db = drizzle(process.env.DATABASE_URL!, {
  mode: "planetscale",
  schema,
});

async function seed() {
  const existing = await db.query.users.findFirst({
    where: (users, { eq }) => eq(users.email, "admin@operal.com"),
  });

  if (existing) {
    console.log("Usuario admin ya existe. Saltando seed.");
    process.exit(0);
  }

  const hash = await bcrypt.hash("admin123", 12);

  await db.insert(schema.users).values({
    nombre: "Administrador",
    email: "admin@operal.com",
    passwordHash: hash,
    rol: "ADMIN",
    activo: true,
  });

  console.log("Usuario admin creado: admin@operal.com / admin123");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
