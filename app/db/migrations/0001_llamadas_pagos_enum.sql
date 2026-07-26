-- NOTA (post-hoc): esta migracion ya se aplico contra la base real ANTES de
-- que existiera 0000_baseline_sprint4.sql -- ese baseline se genero despues
-- y ya incluye este cambio (el schema.ts vigente al generarlo ya tenia el
-- enum de 10 valores). Numericamente 0001 queda "antes" del 0000 en el
-- journal de drizzle-kit por como se creo el baseline con el repo ya
-- actualizado, pero cronologicamente 0001 se aplico primero, a mano. Se deja
-- como registro historico exacto de que SQL se corrio y por que -- no hace
-- falta volver a aplicarla en ninguna base que ya tenga el baseline.
--
-- Sprint 4: agrega LLAMADA_REGISTRADA y PAGO_REGISTRADO al enum eventos.tipo.
-- Escrita a mano (no generada por drizzle-kit): el proyecto no tenia historial
-- de migraciones trackeado (se uso db:push / db/setup.ts hasta ahora), asi que
-- "drizzle-kit generate" produce un CREATE TABLE completo en vez de un ALTER
-- incremental -- inaplicable contra la base real con datos.
--
-- Valores nuevos al FINAL de la lista (no se reordenan ni renombran los 8
-- existentes: MySQL guarda el enum como indice numerico, reordenar remapea
-- los eventos ya cargados a otro tipo). ALGORITHM=INPLACE, LOCK=NONE porque
-- es un cambio de metadata de columna (8 -> 10 valores, sigue bajo 255,
-- sigue ocupando 1 byte), no una reconstruccion de tabla.
ALTER TABLE eventos
  MODIFY COLUMN tipo ENUM(
    'LEAD_CREADO','LEAD_ASIGNADO','ESTADO_CAMBIADO','SEGUIMIENTO_ENVIADO',
    'RESPUESTA_RECIBIDA','OBJECION_REGISTRADA','LEAD_DESCARTADO','NOTA_AGREGADA',
    'LLAMADA_REGISTRADA','PAGO_REGISTRADO'
  ) NOT NULL,
  ALGORITHM=INPLACE, LOCK=NONE;
