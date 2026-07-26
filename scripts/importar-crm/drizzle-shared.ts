// Reexporta drizzle-orm desde la instalacion real de app/node_modules en vez
// de instalar una copia propia. Con dos copias fisicas del paquete (una en
// scripts/importar-crm/node_modules y otra en app/node_modules), TypeScript
// trata los tipos de columna/tabla como incompatibles entre si (los compara
// de forma nominal via campos privados) aunque sea exactamente la misma
// version -- rompe el uso de las tablas reales de @db/schema. Importar
// siempre desde la misma copia fisica evita el problema de raiz, sin agregar
// workspaces ni un package.json en la raiz del repo (no toca la arquitectura).
export { drizzle } from "../../app/node_modules/drizzle-orm/mysql2/index.js";
export { eq, and, sql, inArray, desc } from "../../app/node_modules/drizzle-orm/index.js";
