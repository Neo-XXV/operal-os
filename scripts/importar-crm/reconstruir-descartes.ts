// Extension del import historico del CRM de Jorge: reconstruye LEAD_DESCARTADO
// para los leads que nunca llegaron a D. Jorge es un setter INACTIVO de un
// CRM cerrado -- todo lo que no llego a D quedo muerto por abandono, pero el
// Excel solo lo marcaba con color, no con un dato. Motivo "HISTORICO" (no es
// una regla del producto, ver docs/03_catalogo_eventos.md) porque el motivo
// real no esta registrado en el origen. Fecha = ultimo evento conocido del
// lead, marcada "aproximada" porque no es la fecha real del descarte.
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, and, desc, inArray } from "./drizzle-shared.ts";
import { crearConexion, obtenerOCrearJorge } from "./db.ts";
import { eventos as eventosTabla, leads as leadsTabla } from "../../app/db/schema.ts";

const DIR = path.dirname(fileURLToPath(import.meta.url));

function parsearArgs() {
  const dbArg = process.argv.find((a) => a.startsWith("--db="))?.split("=")[1];
  if (dbArg !== "staging" && dbArg !== "real") {
    console.error("Uso: tsx reconstruir-descartes.ts --db=staging | --db=real");
    process.exit(1);
  }
  return { destino: dbArg as "staging" | "real" };
}

function resolverDatabaseUrl(destino: "staging" | "real"): string {
  loadEnv({ path: path.join(DIR, "../../app/.env"), quiet: true });
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL no encontrada en app/.env");
  if (destino === "real") return base;
  const url = new URL(base);
  url.pathname = "/operal_staging";
  return url.toString();
}

async function main() {
  const { destino } = parsearArgs();
  const databaseUrl = resolverDatabaseUrl(destino);
  console.log(`Destino: ${destino} (${databaseUrl.replace(/:[^:@]*@/, ":***@")})`);
  if (destino === "real") console.log("\n*** Vas a escribir en la base REAL. ***");

  const db = crearConexion(databaseUrl);
  const jorgeId = await obtenerOCrearJorge(db);
  console.log(`Jorge id=${jorgeId}`);

  // Todos los leads de Jorge.
  const leadsDeJorge = await db
    .select({ id: leadsTabla.id })
    .from(leadsTabla)
    .innerJoin(eventosTabla, eq(eventosTabla.leadId, leadsTabla.id))
    .where(and(eq(eventosTabla.tipo, "LEAD_CREADO"), eq(eventosTabla.actorId, jorgeId)));
  const idsJorge = leadsDeJorge.map((l) => l.id);
  console.log(`Leads de Jorge: ${idsJorge.length}`);

  let yaLlegaronAD = 0;
  let yaDescartados = 0;
  let reconstruidos = 0;
  let sinEventos = 0;

  for (const leadId of idsJorge) {
    // Todos los eventos del lead, mismo desempate que el resto de la app:
    // (timestamp DESC, id DESC).
    const eventosLead = await db
      .select()
      .from(eventosTabla)
      .where(eq(eventosTabla.leadId, leadId))
      .orderBy(desc(eventosTabla.timestamp), desc(eventosTabla.id));

    if (eventosLead.length === 0) {
      sinEventos++;
      continue;
    }

    const yaDescartado = eventosLead.some((e) => e.tipo === "LEAD_DESCARTADO");
    if (yaDescartado) {
      yaDescartados++;
      continue;
    }

    const ultimoEstado = eventosLead.find((e) => e.tipo === "ESTADO_CAMBIADO");
    const etapaActual = ultimoEstado ? (ultimoEstado.payload as { estado_nuevo: string }).estado_nuevo : null;

    if (etapaActual === "D") {
      yaLlegaronAD++;
      continue;
    }

    // Fecha = ultimo evento conocido del lead (su ultimo movimiento real).
    const ultimoEventoTimestamp = eventosLead[0].timestamp;

    await db.insert(eventosTabla).values({
      tipo: "LEAD_DESCARTADO",
      leadId,
      actorTipo: "SETTER",
      actorId: jorgeId,
      timestamp: ultimoEventoTimestamp,
      payload: {
        motivo: "HISTORICO",
        detalle: "Reconstruido en la importacion historica: CRM cerrado, setter inactivo, motivo real no registrado en el origen (solo estaba marcado en rojo en el Excel).",
        aproximada: true,
      },
    } as typeof eventosTabla.$inferInsert);
    reconstruidos++;
  }

  console.log(`\nReconstruidos (LEAD_DESCARTADO nuevo): ${reconstruidos}`);
  console.log(`Ya habian llegado a D (sin tocar): ${yaLlegaronAD}`);
  console.log(`Ya tenian LEAD_DESCARTADO (idempotencia, sin tocar): ${yaDescartados}`);
  if (sinEventos > 0) console.log(`ADVERTENCIA: ${sinEventos} leads de Jorge sin ningun evento (no deberia pasar).`);

  // Verificacion.
  const totalDescartados = await db
    .select({ leadId: eventosTabla.leadId })
    .from(eventosTabla)
    .where(and(eq(eventosTabla.tipo, "LEAD_DESCARTADO"), inArray(eventosTabla.leadId, idsJorge)));
  const descartadosUnicos = new Set(totalDescartados.map((r) => r.leadId)).size;

  const conteosEstado: Record<string, number> = { A: 0, MS: 0, B: 0, C: 0, D: 0 };
  const cambiosDeJorge = await db
    .select()
    .from(eventosTabla)
    .where(and(eq(eventosTabla.tipo, "ESTADO_CAMBIADO"), eq(eventosTabla.actorId, jorgeId)));
  for (const ev of cambiosDeJorge) {
    const e = (ev.payload as { estado_nuevo: string }).estado_nuevo;
    if (e in conteosEstado) conteosEstado[e]++;
  }

  console.log(`\n=== Verificacion ===`);
  console.log(`Leads de Jorge descartados: ${descartadosUnicos} de ${idsJorge.length}`);
  console.log(`Leads de Jorge activos (no descartados): ${idsJorge.length - descartadosUnicos}`);
  console.log(`Embudo (ESTADO_CAMBIADO de Jorge, no deberia cambiar): A=${conteosEstado.A} MS=${conteosEstado.MS} B=${conteosEstado.B} C=${conteosEstado.C} D=${conteosEstado.D}`);

  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
