-- Migracion de dominio Instagram -> LinkedIn (campo del lead).
--
-- Escrita a mano, no generada por drizzle-kit: `drizzle-kit generate` pide
-- confirmacion interactiva para distinguir "renombraste la columna" de
-- "borraste una y creaste otra", y este entorno no tiene TTY. Esa distincion
-- es justamente la critica aca -- un DROP + ADD destruiria los 1642 valores
-- existentes. Mismo precedente que 0001_llamadas_pagos_enum.sql, que tambien
-- se escribio a mano por una limitacion del generador.
--
-- RENAME COLUMN preserva el contenido: los leads previos a esta migracion
-- conservan su handle crudo de Instagram ("_aumakua_", "30kcoaching") adentro
-- de la columna ahora llamada `linkedin`. NO se transforma ni se vacia el
-- dato historico -- decision explicita del dueño del producto, mismo criterio
-- de no reescribir el pasado que rige el Event Log. La validacion de URL de
-- LinkedIn vive en la capa de aplicacion (lead.ts) y solo aplica a
-- escrituras nuevas.
--
-- ALGORITHM=INPLACE, LOCK=NONE: renombrar una columna es un cambio de
-- metadata, no una reconstruccion de tabla -- mismo criterio que las
-- migraciones de enum anteriores.
ALTER TABLE `leads`
  RENAME COLUMN `instagram_username` TO `linkedin`,
  ALGORITHM=INPLACE, LOCK=NONE;
--> statement-breakpoint
-- El indice sigue a la columna renombrada (MySQL lo mantiene apuntando al
-- dato correcto automaticamente), pero su NOMBRE queda desactualizado --
-- se renombra para que el schema no mienta sobre que indexa.
ALTER TABLE `leads`
  RENAME INDEX `ig_username_idx` TO `linkedin_idx`;
