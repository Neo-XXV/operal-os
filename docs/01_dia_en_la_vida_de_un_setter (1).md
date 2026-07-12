# Un día en la vida de un setter — OPERAL OS
> **Nota:** Este documento describe el flujo operativo del setter y tiene carácter descriptivo. Ante cualquier diferencia, prevalecen `02_reglas_de_negocio.md` y `03_catalogo_eventos.md`, que constituyen la definición autoritativa del comportamiento del sistema.

**Objetivo de este documento:** mapear el flujo real de trabajo de un setter para que sirva de base al modelo de datos y de eventos de OPERAL OS. No incluye pantallas, modelo de datos ni código — solo el flujo de acciones, decisiones y eventos.

**Nota sobre las fuentes:** los bloques marcados como (✅ confirmado) surgen de datos que el dueño del negocio dio explícitamente. Los marcados como (🔶 inferido) son una reconstrucción razonable a partir de los documentos analizados (reporte diario, dashboard, CRM), pero no fueron confirmados palabra por palabra — deben validarse antes de darlos por definitivos.

---

## Contexto rápido del embudo

A (primer mensaje enviado) → B (pitch/propuesta enviada) → C (agendó en calendario) → D (confirmó calendario)

Métricas derivadas: MSR, PRR, CSR, ABR entre etapas. *(✅ confirmado — aunque el significado exacto de "MS" quedó fijado como "respondió", descartando la interpretación de "vio el mensaje" que aparecía en el Google Sheets analizado.)*

Canal cubierto en este documento: **DM en frío por Instagram**. El "Método RPP" (reactivación de leads viejos) es un canal distinto, con comportamiento propio, que no se mapea acá. *(✅ confirmado)*

---

## Bloque 1 — Inicio de jornada y seguimientos (🔶 inferido como primer bloque del día)

**Qué hace el setter:**
Revisa los leads que ya están en el embudo y les corresponde un seguimiento ese día, priorizando por etapa: primero los que no respondieron el primer mensaje, después los que quedaron en el pitch, después los que quedaron en la oferta/agenda. *(✅ confirmado el orden de prioridad; 🔶 inferido que esto ocurre al inicio del día — no se confirmó explícitamente que sea siempre el primer bloque)*

**Decisión que toma:**
Para cada lead pendiente de seguimiento, decide si:
- Envía el siguiente follow-up de la secuencia de esa etapa, o
- Da el lead por perdido (si superó el límite de intentos o el lead dijo explícitamente que no le interesa). *(✅ confirmado: límite = hasta que el lead diga que no le interesa, o hasta superar 4 seguimientos sin respuesta)*

**Evento(s) que genera:**
- `seguimiento_enviado` (lead_id, etapa, número de follow-up, fecha/hora, setter_id)
- `LEAD_DESCARTADO` (lead_id, motivo: "sin respuesta" | "rechazo explícito", fecha, setter_id) — *si corresponde*

**Dato que se pierde hoy si no se captura ahí mismo:**
- El motivo exacto por el que se da un lead por perdido no queda registrado de forma estructurada hoy (🔶 inferido — no se confirmó si el setter anota esto en algún lado; **esta es una pregunta abierta**, ver abajo).
- El número de follow-up dentro de la secuencia (1B, 2B... hasta 7B, por ejemplo) no queda trazado como evento individual si solo se anota el resultado final del día.

---

## Bloque 2 — Prospección (✅ confirmado como actividad del día, orden relativo 🔶 inferido)

**Qué hace el setter:**
Contacta leads nuevos que le fueron asignados (provenientes del scraping de Instagram hecho por el dueño del negocio con Instant Data Scraper, repartidos y cargados en Google Sheets por setter). Envía el primer mensaje a cada lead nuevo.

**Decisión que toma:**
Ninguna decisión de fondo en este paso — es ejecución del primer contacto según guion. La decisión relevante ya la tomó el dueño del negocio al repartir los leads.

**Evento(s) que genera:**
- `lead_ingresado` (lead_id, fuente: "scraping IG", fecha de scraping, setter_asignado) — *este evento en rigor nace antes, cuando el dueño reparte, no cuando el setter prospecta; conviene separarlos*
- `primer_mensaje_enviado` (lead_id, setter_id, fecha/hora) → esto mueve al lead a etapa A

**Dato que se pierde hoy si no se captura ahí mismo:**
- El momento exacto en que el lead pasó de "asignado" a "contactado" no está separado del momento del scraping. Si se cargan juntos, se pierde el tiempo de espera entre asignación y primer contacto (dato útil para medir carga de trabajo por setter).
- No está claro si hay algún filtro o calificación del lead entre el scraping y la asignación al setter, o si va directo. **Pregunta abierta.**

---

## Bloque 3 — Atención de mensajes entrantes (✅ confirmado como actividad del día, ocurre a lo largo de la jornada)

**Qué hace el setter:**
Responde mensajes entrantes de leads (respuestas a follow-ups, respuestas al primer contacto, dudas, objeciones) siguiendo una estructura de conversación/guion predefinido.

**Decisión que toma:**
- Identifica en qué etapa del embudo está el lead que respondió y qué acción corresponde (avanzar a la siguiente etapa, resolver una objeción y reintentar, etc.)
- Si aparece una objeción no contemplada en el guion, decide cómo manejarla en el momento (con criterio propio) y luego la registra como "objeción nueva" en el reporte diario.

**Evento(s) que genera:**
- `respuesta_recibida` (lead_id, fecha/hora)
- `ESTADO_CAMBIADO` (lead_id, etapa_anterior, etapa_nueva, fecha/hora) — cuando corresponde avanzar el embudo
- `objecion_registrada` (lead_id, texto/contexto de la objeción, cómo la manejó el setter, fecha) — *cuando es una objeción nueva*

**Dato que se pierde hoy si no se captura ahí mismo:**
- El tiempo de respuesta del setter ante un mensaje entrante no se registra (dato útil para medir velocidad de atención, que suele correlacionar con conversión).
- Si la objeción se resuelve en el momento pero no se anota hasta el reporte diario (al final del día), se puede perder precisión sobre el contexto exacto de la conversación.

---

## Bloque 4 — Cierre de jornada: Reporte Diario (✅ confirmado, documento real analizado)

**Qué hace el setter:**
Completa el Reporte Diario, que incluye:
1. KPIs del día (hoy cargados a mano; mayoría son calculables automáticamente a partir de los eventos ya generados en los bloques 1-3).
2. Objeciones nuevas encontradas (contexto del prospecto + cómo la manejó).
3. Reflexión del día (qué funcionó, qué no, qué va a mejorar).
4. Notas / bloqueos.
5. CRM del día (funnel por etapas — tabla de leads).

**Decisión que toma:**
Qué incluir como "reflexión" y qué marcar como bloqueo — esto es juicio humano, no derivable de eventos.

**Evento(s) que genera:**
- `reporte_diario_completado` (setter_id, fecha)
- Los KPIs en sí **no deberían ser un evento nuevo**: son una proyección/cálculo sobre los eventos ya registrados en los bloques anteriores. Si se cargan a mano hoy, es redundante con lo que el sistema ya podría calcular solo.

**Dato que se pierde hoy si no se captura ahí mismo:**
- Nada nuevo debería perderse acá si los bloques 1-3 capturaron bien sus eventos — este bloque es más una oportunidad de **eliminar carga manual redundante** que de capturar datos nuevos.
- Excepción: la reflexión y los bloqueos, que sí son información nueva y solo existen si el setter la escribe.

---

## Resumen del mapa de eventos (borrador, para validar en la siguiente etapa)

| Evento | Dispara desde | Datos clave |
|---|---|---|
| `lead_ingresado` | Reparto del dueño → setter | lead_id, fuente, fecha, setter_asignado |
| `primer_mensaje_enviado` | Bloque 2 (Prospección) | lead_id, setter_id, fecha/hora |
| `seguimiento_enviado` | Bloque 1 (Seguimientos) | lead_id, etapa, n° de follow-up, fecha/hora |
| `respuesta_recibida` | Bloque 3 (Mensajes entrantes) | lead_id, fecha/hora |
| `ESTADO_CAMBIADO` | Bloque 3 | lead_id, etapa_anterior, etapa_nueva, fecha/hora |
| `objecion_registrada` | Bloque 3 o Bloque 4 | lead_id, texto/contexto, manejo, fecha |
| `LEAD_DESCARTADO` | Bloque 1 | lead_id, motivo, fecha |
| `reporte_diario_completado` | Bloque 4 | setter_id, fecha |

---

## Preguntas abiertas (a resolver con el dueño del negocio antes de pasar al modelo de datos)

1. **Objeciones nuevas:** cuando el setter anota una objeción nueva en el reporte diario, ¿alguien la revisa y la suma a una guía central de manejo de objeciones? ¿O queda archivada sin más acción? *(pendiente desde el intercambio anterior, todavía sin responder)*
2. **Motivo de lead perdido:** ¿el setter anota en algún lado el motivo cuando decide abandonar un lead (sin respuesta vs. rechazo explícito), o hoy esa información no queda registrada en ningún lugar?
3. **Filtro entre scraping y asignación:** ¿los leads que salen del scraping van directo al setter, o hay algún paso de calificación/filtro en el medio (por vos o por alguien más) antes de repartirlos?
4. **Orden real del día:** ¿el setter efectivamente arranca el día con seguimientos y después pasa a prospección, o el orden varía según el día / según cada setter? Esto no está confirmado, solo inferido de los documentos.
5. **Mensajes entrantes vs. bloques fijos:** ¿la atención de mensajes entrantes interrumpe los bloques de seguimiento/prospección en tiempo real (el setter contesta apenas le llega un mensaje), o hay momentos específicos del día dedicados a revisar respuestas?
6. **Tiempo entre asignación y contacto:** ¿te interesa medir cuánto tarda un setter en contactar un lead recién asignado, o no es un dato relevante para el negocio hoy?
7. **Cuello de botella del scraping manual:** el origen del lead depende de que vos scrapees y repartas manualmente. ¿Es algo que planeás automatizar o delegar en algún momento, o es intencional mantenerlo así (por ejemplo, para controlar calidad)?

---

*Documento generado como insumo para el diseño del modelo de datos y arquitectura de eventos de OPERAL OS. No define pantallas, tecnología ni estructura de base de datos — su único objetivo es capturar el flujo real de trabajo antes de modelarlo.*
