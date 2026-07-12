# 03 — Catálogo de Eventos — OPERAL OS

Este documento es la referencia definitiva de qué eventos existen en el sistema, qué representa cada uno y qué datos guarda. Es la base directa del modelo de datos (`08_modelo_de_datos.md`). Cualquier evento nuevo que se quiera agregar en el futuro debe pasar primero por el criterio de esta página.

---

## Principios del Event Log

1. Un evento es un hecho irreversible que ocurrió en el negocio.
2. Una regla nunca es un evento.
3. Una métrica nunca es un evento.
4. Una alerta nunca es un evento.
5. Todo KPI se calcula leyendo eventos, nunca se guarda como fuente de verdad.

## Criterio para crear un nuevo evento

Un nuevo tipo de evento solo se incorpora si cumple **simultáneamente**:

1. Representa un hecho irreversible ocurrido en el negocio.
2. No puede reconstruirse únicamente a partir de otros eventos ya existentes.
3. Aporta información nueva para auditoría, métricas o trazabilidad.
4. No es una regla de negocio, una alerta, un KPI ni una inferencia del sistema.

Si un evento propuesto no cumple los 4 puntos, no entra al catálogo — se resuelve como regla derivada, calculada al momento de consultar.

## Estructura de la tabla `Evento`

```
Evento
  id
  tipo          (ej: ESTADO_CAMBIADO)
  lead_id       (solo para eventos de Lead — ver sección de alcance)
  actor_tipo    (SETTER | MANAGER | SISTEMA)
  actor_id
  timestamp
  payload       (JSON, forma según el tipo — definida abajo)
```

## Alcance de este documento

Este catálogo cubre exclusivamente **eventos del Lead** — hechos que ocurren sobre un lead individual y llevan `lead_id`. Los eventos administrativos (importaciones, altas/bajas de setters, reportes diarios) no pertenecen a este historial y se documentan aparte en `09_eventos_administrativos.md` (pendiente).

---

## Eventos del Lead — V1

### 1. `LEAD_CREADO`

**Descripción:** Un lead nuevo ingresa al sistema.

**Quién lo genera:** Setter (al cargarlo) o Sistema (si en el futuro hay carga automática desde el scraping).

**Cuándo ocurre:** En el momento en que el lead se registra por primera vez en OPERAL, no en el momento del scraping en sí (el scraping y reparto son un proceso administrativo previo).

**Payload:**
```json
{
  "origen": "SCRAPING | MANUAL | RPP",
  "importacion_id": "opcional — referencia a la Importación si vino de un lote"
}
```

**Reglas:** Un lead solo puede tener un `LEAD_CREADO` en toda su vida.

**Dispara (cálculos que habilita):** Antigüedad del lead, origen del lead como variable de análisis (¿qué fuente convierte mejor?).

---

### 2. `LEAD_ASIGNADO`

**Descripción:** Un lead queda bajo la responsabilidad de un setter. Incluye tanto la primera asignación como reasignaciones posteriores.

**Quién lo genera:** Admin o Sistema.

**Cuándo ocurre:** Al repartir un lead nuevo, o al reasignarlo de un setter a otro.

**Payload:**
```json
{
  "setter_anterior": "id o null si es la primera asignación",
  "setter_nuevo": "id"
}
```

**Reglas:** El setter "actual" de un lead se deriva leyendo el último `LEAD_ASIGNADO`, nunca se guarda como campo separado de estado.

**Dispara:** Tiempo entre asignación y primer contacto (`primer_mensaje`), carga de trabajo por setter, historial de reasignaciones.

---

### 3. `ESTADO_CAMBIADO`

**Descripción:** El lead avanza (o retrocede) una etapa del embudo comercial.

**Quién lo genera:** Setter.

**Cuándo ocurre:** Cada vez que cambia la etapa: A → MS → B → C → D.

**Payload:**
```json
{
  "estado_anterior": "A | MS | B | C | D",
  "estado_nuevo": "A | MS | B | C | D"
}
```

**Reglas:** D (agenda confirmada) es el estado final exitoso del ciclo dentro de OPERAL — el lead permanece en el sistema, no migra a otra herramienta.

**Dispara:** MSR, PRR, CSR, ABR, tiempo entre etapas, embudo por setter, embudo general.

---

### 4. `SEGUIMIENTO_ENVIADO`

**Descripción:** El setter envía un follow-up dentro de la secuencia predefinida de una etapa.

**Quién lo genera:** Setter.

**Cuándo ocurre:** Cada vez que se envía un follow-up (hasta 7 por etapa, según la secuencia real relevada).

**Payload:**
```json
{
  "etapa": "A | MS | B | C",
  "numero": 1
}
```

**Reglas:** El número de intentos totales para un lead se deriva contando estos eventos, no se guarda como contador aparte.

**Dispara:** Cantidad de intentos hasta conversión o descarte, efectividad por número de follow-up, tiempos entre seguimientos.

---

### 5. `RESPUESTA_RECIBIDA`

**Descripción:** El lead responde un mensaje, sin que eso implique necesariamente un cambio de etapa (ej: responde una objeción, pide tiempo, confirma que vio el calendario).

**Quién lo genera:** Sistema (al detectar la respuesta) o Setter (al registrarla manualmente).

**Cuándo ocurre:** Cada vez que el lead escribe algo, independientemente de si mueve el embudo.

**Payload:**
```json
{
  "contexto": "texto libre breve, opcional"
}
```

**Reglas:** No reemplaza a `ESTADO_CAMBIADO` — la primera respuesta que mueve A→MS genera ambos eventos (uno registra el hecho de que respondió, el otro el cambio de etapa).

**Dispara:** Cantidad de mensajes por conversación, tiempo de respuesta del lead, correlación entre nivel de interacción y conversión.

---

### 6. `OBJECION_REGISTRADA`

**Descripción:** El setter identifica y registra una objeción del lead.

**Quién lo genera:** Setter.

**Cuándo ocurre:** Durante una conversación, cuando aparece una objeción (contemplada en el guion o nueva).

**Payload:**
```json
{
  "tipo": "PRECIO | TIEMPO | CONFIANZA | OTRA — taxonomía a definir",
  "detalle": "texto libre",
  "es_nueva": true
}
```

**Reglas:** Ninguna todavía sobre revisión/actualización de guía central — **pregunta abierta pendiente de tu respuesta** (¿alguien revisa las objeciones nuevas y las suma a una guía, o quedan archivadas?).

**Dispara:** Objeciones más frecuentes, objeciones por setter, objeciones asociadas a leads perdidos.

---

### 7. `LEAD_DESCARTADO`

**Descripción:** El lead deja de trabajarse dentro del proceso comercial por decisión del setter o por aplicación de una regla del negocio. No implica eliminar el lead ni borrar su historial; únicamente marca el fin de su recorrido en el embudo.

**Quién lo genera:** Setter.

**Cuándo ocurre:** Cuando el lead dice explícitamente que no le interesa, o cuando se superan 4 seguimientos sin respuesta.

**Payload:**
```json
{
  "motivo": "SIN_RESPUESTA | RECHAZO_EXPLICITO | NO_CALIFICA | DUPLICADO | ERROR_CARGA",
  "detalle": "texto libre, opcional"
}
```

**Reglas:** Después de `LEAD_DESCARTADO` no pueden generarse nuevos eventos comerciales (`SEGUIMIENTO_ENVIADO`, `ESTADO_CAMBIADO`, `RESPUESTA_RECIBIDA`) para ese lead, salvo que en una versión futura exista una funcionalidad explícita de reapertura. Ver `02_reglas_de_negocio.md` para la lista fija de motivos válidos (no se acepta texto libre en `motivo`).

**Dispara:** Tasa de descarte por motivo, tasa de descarte por setter, punto del embudo donde más se pierden leads.

---

### 8. `NOTA_AGREGADA`

**Descripción:** Comentario libre sobre el lead que no modifica su estado.

**Quién lo genera:** Setter.

**Cuándo ocurre:** Cuando el setter quiere dejar constancia de algo que no encaja en otro tipo de evento (ej: "pidió que le escriba el viernes", "está de viaje", "prefiere audio").

**Payload:**
```json
{
  "texto": "libre"
}
```

**Reglas:** No reemplaza objeciones, cambios de estado ni seguimientos — si el contenido de la nota encaja en otro tipo de evento, debe registrarse como ese tipo, no como nota.

**Dispara:** Nada calculable directamente; es información de contexto para lectura humana.

---

## Resumen

| # | Evento | Actor típico | ¿Tiene payload variable? |
|---|---|---|---|
| 1 | `LEAD_CREADO` | Setter / Sistema | Sí (origen) |
| 2 | `LEAD_ASIGNADO` | Manager / Sistema | Sí (setter anterior/nuevo) |
| 3 | `ESTADO_CAMBIADO` | Setter | Sí (estado anterior/nuevo) |
| 4 | `SEGUIMIENTO_ENVIADO` | Setter | Sí (etapa, número) |
| 5 | `RESPUESTA_RECIBIDA` | Sistema / Setter | Opcional (contexto) |
| 6 | `OBJECION_REGISTRADA` | Setter | Sí (tipo, detalle) |
| 7 | `LEAD_DESCARTADO` | Setter | Sí (motivo) |
| 8 | `NOTA_AGREGADA` | Setter | Sí (texto) |

## Pendiente fuera de este documento

- Eventos administrativos (`IMPORTACION_REALIZADA`, `SETTER_CREADO`, `SETTER_DESACTIVADO`, `REPORTE_DIARIO_ENVIADO`) → `09_eventos_administrativos.md`.
- Eventos generados por IA (`ANOMALIA_DETECTADA` y similares) → pospuestos a V2, se diseñan recién cuando exista la funcionalidad de IA.
- Taxonomía cerrada de tipos de objeción → a definir con el negocio.
- Respuesta a: ¿las objeciones nuevas se revisan y suman a una guía central, o quedan archivadas?

---

*Este documento es la base directa de `08_modelo_de_datos.md`. Cualquier evento agregado después debe pasar por el criterio de la sección "Criterio para crear un nuevo evento".*
