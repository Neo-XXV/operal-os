-- Migracion base (baseline), NO ejecutada contra ninguna base real.
--
-- El proyecto nunca tuvo historial de drizzle-kit trackeado -- el schema se
-- aplico siempre con db:push o SQL manual (db/setup.ts, migraciones a mano
-- como 0001_llamadas_pagos_enum.sql). Este archivo es el primer
-- "drizzle-kit generate" real del repo: como no hay journal previo, genera
-- un CREATE TABLE completo que ya refleja el schema.ts actual (incluye el
-- enum de eventos.tipo con los 10 valores, post Sprint 4).
--
-- Se guarda como punto de partida para que futuros "drizzle-kit generate"
-- calculen diffs incrementales de verdad en vez de repetir un CREATE TABLE
-- completo -- no para ser aplicado: las tablas ya existen en toda base real
-- con datos. Si alguna vez se necesita una base 100% nueva desde cero, usar
-- db/setup.ts (mantenido en paralelo, ver nota en ese archivo).
CREATE TABLE `eventos` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tipo` enum('LEAD_CREADO','LEAD_ASIGNADO','ESTADO_CAMBIADO','SEGUIMIENTO_ENVIADO','RESPUESTA_RECIBIDA','OBJECION_REGISTRADA','LEAD_DESCARTADO','NOTA_AGREGADA','LLAMADA_REGISTRADA','PAGO_REGISTRADO') NOT NULL,
	`lead_id` bigint unsigned NOT NULL,
	`actor_tipo` enum('SETTER','MANAGER','ADMIN','SISTEMA') NOT NULL,
	`actor_id` bigint unsigned,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`payload` json NOT NULL,
	CONSTRAINT `eventos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`nombre` varchar(255) NOT NULL,
	`instagram_username` varchar(255) NOT NULL,
	CONSTRAINT `leads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`nombre` varchar(255) NOT NULL,
	`email` varchar(320) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`rol` enum('SETTER','MANAGER','ADMIN') NOT NULL,
	`activo` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE INDEX `event_lead_idx` ON `eventos` (`lead_id`);--> statement-breakpoint
CREATE INDEX `event_tipo_idx` ON `eventos` (`tipo`);--> statement-breakpoint
CREATE INDEX `event_timestamp_idx` ON `eventos` (`timestamp`);--> statement-breakpoint
CREATE INDEX `ig_username_idx` ON `leads` (`instagram_username`);--> statement-breakpoint
CREATE INDEX `email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `rol_idx` ON `users` (`rol`);