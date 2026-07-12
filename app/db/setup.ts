import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import "dotenv/config";

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  await conn.execute("SET FOREIGN_KEY_CHECKS = 0");
  await conn.execute("DROP TABLE IF EXISTS eventos");
  await conn.execute("DROP TABLE IF EXISTS leads");
  await conn.execute("DROP TABLE IF EXISTS users");
  await conn.execute("SET FOREIGN_KEY_CHECKS = 1");

  await conn.execute(`
    CREATE TABLE users (
      id bigint unsigned auto_increment PRIMARY KEY,
      nombre varchar(255) NOT NULL,
      email varchar(320) NOT NULL UNIQUE,
      password_hash varchar(255) NOT NULL,
      rol enum('SETTER', 'MANAGER', 'ADMIN') NOT NULL,
      activo boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await conn.execute(`
    CREATE TABLE leads (
      id bigint unsigned auto_increment PRIMARY KEY,
      nombre varchar(255) NOT NULL,
      instagram_username varchar(255) NOT NULL
    )
  `);

  await conn.execute(`
    CREATE TABLE eventos (
      id bigint unsigned auto_increment PRIMARY KEY,
      tipo enum('LEAD_CREADO', 'LEAD_ASIGNADO', 'ESTADO_CAMBIADO', 'SEGUIMIENTO_ENVIADO', 'RESPUESTA_RECIBIDA', 'OBJECION_REGISTRADA', 'LEAD_DESCARTADO', 'NOTA_AGREGADA') NOT NULL,
      lead_id bigint unsigned NOT NULL,
      actor_tipo enum('SETTER', 'MANAGER', 'ADMIN', 'SISTEMA') NOT NULL,
      actor_id bigint unsigned,
      \`timestamp\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      payload json NOT NULL
    )
  `);

  await conn.execute("CREATE INDEX email_idx ON users(email)");
  await conn.execute("CREATE INDEX rol_idx ON users(rol)");
  await conn.execute("CREATE INDEX ig_username_idx ON leads(instagram_username)");
  await conn.execute("CREATE INDEX event_lead_idx ON eventos(lead_id)");
  await conn.execute("CREATE INDEX event_tipo_idx ON eventos(tipo)");
  await conn.execute("CREATE INDEX event_timestamp_idx ON eventos(\`timestamp\`)");

  const hash = await bcrypt.hash("admin123", 12);
  await conn.execute(
    "INSERT INTO users (nombre, email, password_hash, rol, activo) VALUES (?, ?, ?, 'ADMIN', true)",
    ["Administrador", "admin@operal.com", hash]
  );

  await conn.end();
  console.log("Schema creado exitosamente. Admin: admin@operal.com / admin123");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
