-- Sprint 5b: agrega CALENDAR_EVENTO_SINCRONIZADO al final del enum (12 -> 13
-- valores) -- mismo motivo que las migraciones anteriores de este enum
-- (0001_llamadas_pagos_enum.sql, 0001_faithful_bruce_banner.sql): MySQL
-- guarda el enum como indice numerico, nunca se reordena ni renombra un
-- valor existente. ALGORITHM=INPLACE/LOCK=NONE porque sigue siendo un
-- cambio de metadata de columna (sigue bajo 255 valores, sigue 1 byte).
ALTER TABLE `eventos` MODIFY COLUMN `tipo` enum('LEAD_CREADO','LEAD_ASIGNADO','ESTADO_CAMBIADO','SEGUIMIENTO_ENVIADO','RESPUESTA_RECIBIDA','OBJECION_REGISTRADA','LEAD_DESCARTADO','NOTA_AGREGADA','LLAMADA_REGISTRADA','PAGO_REGISTRADO','CALENDAR_EVENTO_CREADO','CALENDAR_EVENTO_ACTUALIZADO','CALENDAR_EVENTO_SINCRONIZADO') NOT NULL, ALGORITHM=INPLACE, LOCK=NONE;