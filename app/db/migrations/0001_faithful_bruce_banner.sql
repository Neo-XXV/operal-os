-- Sprint 5: numerada 0001 por drizzle-kit (el journal solo tenia
-- 0000_baseline_sprint4) -- coincide con el nombre de archivo del historico
-- db/migrations/0001_llamadas_pagos_enum.sql (Sprint 4), que nunca estuvo en
-- el journal (se aplico a mano antes de que existiera historial trackeado).
-- No son el mismo archivo ni se pisan: drizzle-kit solo ejecuta lo listado
-- en meta/_journal.json.
CREATE TABLE `google_calendar_connections` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`calendar_id` varchar(255) NOT NULL DEFAULT 'primary',
	`refresh_token_encrypted` text NOT NULL,
	`connected_by_user_id` bigint unsigned NOT NULL,
	`connected_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `google_calendar_connections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
-- Valores nuevos al FINAL del enum (10 -> 12), mismo motivo que la migracion
-- historica de Sprint 4: MySQL guarda el enum como indice numerico, y
-- ALGORITHM=INPLACE/LOCK=NONE porque es un cambio de metadata de columna
-- (sigue bajo 255 valores, sigue 1 byte), no una reconstruccion de tabla.
ALTER TABLE `eventos` MODIFY COLUMN `tipo` enum('LEAD_CREADO','LEAD_ASIGNADO','ESTADO_CAMBIADO','SEGUIMIENTO_ENVIADO','RESPUESTA_RECIBIDA','OBJECION_REGISTRADA','LEAD_DESCARTADO','NOTA_AGREGADA','LLAMADA_REGISTRADA','PAGO_REGISTRADO','CALENDAR_EVENTO_CREADO','CALENDAR_EVENTO_ACTUALIZADO') NOT NULL, ALGORITHM=INPLACE, LOCK=NONE;--> statement-breakpoint
ALTER TABLE `leads` ADD `email` varchar(320);