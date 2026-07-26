import xlsxPkg from "xlsx";
const XLSX = xlsxPkg;
import type * as XLSXTypes from "xlsx";
import { config as loadEnv } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, and } from "./drizzle-shared.ts";
import { parsearHoja, ORDEN_ETAPAS, type Problema, type EstadoConocido } from "./parse.ts";
import { crearConexion, obtenerOCrearJorge, obtenerEstadoConocido, importarLead } from "./db.ts";
import { eventos as eventosTabla } from "../../app/db/schema.ts";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const EXCEL_PATH = process.env.CRM_EXCEL_PATH ?? "C:/Users/jeron/Downloads/CRM de Jorge.xlsx";
// Orden cronologico real -- importa para que "conocidos" reconozca
// continuaciones entre meses. El import es idempotente: incluir Julio de
// nuevo (ya importado en una corrida anterior) no duplica nada, solo
// simplifica tener una unica lista en vez de mantener dos sincronizadas.
const HOJAS_A_IMPORTAR = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Nov",
  "Dec",
];
const ANIO = 2026;

function parsearArgs() {
  const dbArg = process.argv.find((a) => a.startsWith("--db="))?.split("=")[1];
  if (dbArg !== "staging" && dbArg !== "real") {
    console.error('Uso: tsx importar.ts --db=staging | --db=real');
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

// Lee los conteos ya calculados por el propio Excel (formulas D6:D10 de cada
// hoja mensual) -- no se hardcodea nada, se lee en vivo de cada hoja
// procesada, para poder sumar el total real del año sin transcribir a mano.
function leerResumenExcel(ws: XLSXTypes.WorkSheet): { A: number; MS: number; B: number; C: number; D: number } {
  const val = (fila: number) => {
    const cell = ws[XLSX.utils.encode_cell({ r: fila - 1, c: XLSX.utils.decode_col("D") })];
    return typeof cell?.v === "number" ? cell.v : 0;
  };
  return { A: val(6), MS: val(7), B: val(8), C: val(9), D: val(10) };
}

async function main() {
  const { destino } = parsearArgs();
  const databaseUrl = resolverDatabaseUrl(destino);
  console.log(`Destino: ${destino} (${databaseUrl.replace(/:[^:@]*@/, ":***@")})`);

  if (destino === "real") {
    console.log("\n*** Vas a escribir en la base REAL. ***");
  }

  const wb = XLSX.readFile(EXCEL_PATH, { cellDates: true });
  const db = crearConexion(databaseUrl);
  const jorgeId = await obtenerOCrearJorge(db);
  console.log(`Usuario Jorge (historico): id=${jorgeId}`);

  // Precarga el estado conocido de leads ya importados en corridas
  // anteriores (ej: Julio) para reconocer continuaciones entre meses.
  const conocidos: Map<string, EstadoConocido> = await obtenerEstadoConocido(db, jorgeId);
  console.log(`Leads ya conocidos antes de esta corrida (de meses ya importados): ${conocidos.size}`);

  const todosLosProblemas: Problema[] = [];
  const resumenPorLead: { enlace: string; nombre: string; insertados: number; yaExistian: number }[] = [];

  for (const hoja of HOJAS_A_IMPORTAR) {
    const ws = wb.Sheets[hoja];
    if (!ws) throw new Error(`Hoja "${hoja}" no encontrada en el Excel`);

    const { leads, problemas } = parsearHoja(ws, hoja, ANIO, conocidos);
    todosLosProblemas.push(...problemas);

    console.log(`\nHoja "${hoja}": ${leads.length} leads con eventos nuevos/actualizados, ${problemas.length} problemas detectados.`);

    for (const lead of leads) {
      const r = await importarLead(db, jorgeId, lead);
      resumenPorLead.push({
        enlace: lead.enlace,
        nombre: lead.nombre,
        insertados: r.eventosInsertados,
        yaExistian: r.eventosYaExistentes,
      });
    }
  }

  // Reporte de problemas -> CSV consolidado de las 11 hojas de esta corrida.
  if (todosLosProblemas.length > 0) {
    const dirSalida = path.join(DIR, "output");
    mkdirSync(dirSalida, { recursive: true });
    const archivo = path.join(dirSalida, `problemas_${destino}_${Date.now()}.csv`);
    const csv = [
      "hoja,fila,tipo,detalle",
      ...todosLosProblemas.map(
        (p) => `${p.hoja},${p.fila},${p.tipo},"${p.detalle.replace(/"/g, '""')}"`,
      ),
    ].join("\n");
    writeFileSync(archivo, csv, "utf-8");
    console.log(`\n${todosLosProblemas.length} problemas detectados -> ${archivo}`);

    const porTipo = new Map<string, number>();
    for (const p of todosLosProblemas) porTipo.set(p.tipo, (porTipo.get(p.tipo) ?? 0) + 1);
    console.log("\nResumen por tipo de problema:");
    for (const [tipo, n] of [...porTipo.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${tipo}: ${n}`);
    }
  } else {
    console.log("\nSin problemas detectados.");
  }

  const totalInsertados = resumenPorLead.reduce((a, r) => a + r.insertados, 0);
  const totalYaExistian = resumenPorLead.reduce((a, r) => a + r.yaExistian, 0);
  console.log(`\nEventos insertados: ${totalInsertados}. Ya existian (idempotencia): ${totalYaExistian}.`);

  // Verificacion: embudo A/MS/B/C/D contando SOLO los ESTADO_CAMBIADO
  // generados por esta importacion (actor_id = Jorge), GLOBAL (incluye
  // Julio, ya importado antes) -- comparable contra la suma de D6:D10 de
  // TODAS las hojas del año, no solo las de esta corrida.
  const eventosImport = await db
    .select()
    .from(eventosTabla)
    .where(and(eq(eventosTabla.tipo, "ESTADO_CAMBIADO"), eq(eventosTabla.actorId, jorgeId)));
  const conteos: Record<string, number> = { A: 0, MS: 0, B: 0, C: 0, D: 0 };
  for (const ev of eventosImport) {
    const nuevo = (ev.payload as { estado_nuevo: string }).estado_nuevo;
    if (nuevo in conteos) conteos[nuevo]++;
  }
  const leadsImportados = await db
    .select()
    .from(eventosTabla)
    .where(and(eq(eventosTabla.tipo, "LEAD_CREADO"), eq(eventosTabla.actorId, jorgeId)));

  console.log("\n=== Embudo GLOBAL importado hasta ahora (todos los meses ya corridos, actor_id=Jorge) ===");
  console.log(`Leads importados (LEAD_CREADO de Jorge): ${leadsImportados.length}`);
  ORDEN_ETAPAS.forEach((e) => console.log(`  (${e}): ${conteos[e]}`));
  const msr = conteos.A > 0 ? conteos.MS / conteos.A : 0;
  const prr = conteos.MS > 0 ? conteos.B / conteos.MS : 0;
  const csr = conteos.B > 0 ? conteos.C / conteos.B : 0;
  const abr = conteos.C > 0 ? conteos.D / conteos.C : NaN;
  console.log(`  MSR (A>MS): ${(msr * 100).toFixed(2)}%`);
  console.log(`  PRR (MS>B): ${(prr * 100).toFixed(2)}%`);
  console.log(`  CSR (B>C):  ${(csr * 100).toFixed(2)}%`);
  console.log(`  ABR (C>D):  ${Number.isNaN(abr) ? "N/A" : (abr * 100).toFixed(2) + "%"}`);

  // Suma en vivo de las formulas D6:D10 de TODAS las hojas del año (incluida
  // Julio, aunque no se reprocese) -- sin hardcodear ningun numero.
  const excelTotal = { A: 0, MS: 0, B: 0, C: 0, D: 0 };
  for (const hoja of HOJAS_A_IMPORTAR) {
    const ws = wb.Sheets[hoja];
    if (!ws) continue;
    const r = leerResumenExcel(ws);
    excelTotal.A += r.A;
    excelTotal.MS += r.MS;
    excelTotal.B += r.B;
    excelTotal.C += r.C;
    excelTotal.D += r.D;
  }
  const excelMsr = excelTotal.A > 0 ? excelTotal.MS / excelTotal.A : 0;
  const excelPrr = excelTotal.MS > 0 ? excelTotal.B / excelTotal.MS : 0;
  const excelCsr = excelTotal.B > 0 ? excelTotal.C / excelTotal.B : 0;
  const excelAbr = excelTotal.C > 0 ? excelTotal.D / excelTotal.C : NaN;
  console.log("\nComparar contra la SUMA de D6:D10 de las 12 hojas del Excel (tasas secuenciales):");
  console.log(`  (A)=${excelTotal.A}  (MS)=${excelTotal.MS}  (B)=${excelTotal.B}  (C)=${excelTotal.C}  (D)=${excelTotal.D}`);
  console.log(
    `  MSR=${(excelMsr * 100).toFixed(2)}%  PRR=${(excelPrr * 100).toFixed(2)}%  CSR=${(excelCsr * 100).toFixed(2)}%  ABR=${Number.isNaN(excelAbr) ? "N/A" : (excelAbr * 100).toFixed(2) + "%"}`,
  );
  console.log(
    "\n(Nota: con continuaciones entre meses, un lead que arranca en un mes y avanza en otro puede hacer que el total importado no matchee 1:1 la suma cruda de D6:D10 -- cada bloque B/C/D vive en la hoja del mes en que ocurrio, asi que la suma deberia seguir siendo comparable, pero revisar los problemas de tipo REINICIO_BLOQUE_A si los numeros no cierran.)",
  );

  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
