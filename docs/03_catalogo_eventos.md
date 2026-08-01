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
  lead_id       (solo para eventos de Lead — ver sección de alcance; nullable — único caso: ANOMALIA_DETECTADA de nivel SETTER/EQUIPO, evento 14)
  actor_tipo    (SETTER | MANAGER | ADMIN | SISTEMA)
  actor_id
  timestamp
  payload       (JSON, forma según el tipo — definida abajo)
```

## Alcance de este documento

Este catálogo cubre **eventos del Lead** — hechos que ocurren sobre un lead individual y llevan `lead_id` — con una única excepción: `ANOMALIA_DETECTADA` (evento 14) cuando es de nivel `SETTER` o `EQUIPO`, que no tiene un lead asociado y por lo tanto no lleva `lead_id` (columna `null` en ese caso). Los eventos administrativos (importaciones, altas/bajas de setters, reportes diarios) siguen sin pertenecer a este historial y se documentan aparte en `09_eventos_administrativos.md` (pendiente).

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

**Quién lo genera:** Admin, Sistema o Setter (auto-asignación al crear un lead).

**Cuándo ocurre:** Al repartir un lead nuevo, o al reasignarlo de un setter a otro.

**Payload:**
```json
{
  "setter_anterior": "id o null si es la primera asignación",
  "setter_nuevo": "id"
}
```

**Reglas:** El setter "actual" de un lead se deriva leyendo el último `LEAD_ASIGNADO`, nunca se guarda como campo separado de estado.

**Atribución histórica por setter (Sprint 3, comparación por setter):** cuando se mide el rendimiento de conversión de cada setter, un `ESTADO_CAMBIADO` no se atribuye al dueño *actual* del lead, sino a quien tenía el lead asignado en el momento exacto en que ocurrió esa transición — reconstruyendo la línea de tiempo de `LEAD_ASIGNADO` del lead (intervalo cerrado-abierto: un cambio de estado con timestamp igual al de una asignación se atribuye al nuevo dueño). Esto es necesario porque los leads se reasignan en cualquier momento (ver `02_reglas_de_negocio.md`); atribuir todo el historial al dueño actual le daría o quitaría crédito por trabajo que no hizo. Un lead que nunca tuvo `LEAD_ASIGNADO` queda excluido de toda atribución por setter.

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

**Payload opcional `aproximada: true`:** presente únicamente en eventos generados por importaciones históricas cuando la fecha real de la transición no está disponible en la fuente y se usa un fallback (ver `scripts/importar-crm/`); ausente en todo evento generado por el flujo normal de la app. Distingue fecha medida de fecha estimada para no tratarlas igual en análisis futuros.

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
  "tipo": "PRECIO | DESCONFIANZA | TIEMPO | EXPERIENCIA_PREVIA_SIMILAR | YA_TIENE_PROVEEDOR | YA_PAGO_MENTOR | OTRA",
  "detalle": "texto libre",
  "es_nueva": true
}
```

Taxonomía cerrada (definida con el dueño del negocio):
- `PRECIO`
- `DESCONFIANZA`
- `TIEMPO`
- `EXPERIENCIA_PREVIA_SIMILAR` — ya intentó algo parecido antes
- `YA_TIENE_PROVEEDOR` — ya está trabajando con alguien
- `YA_PAGO_MENTOR` — ya le pagó a un mentor/coach
- `OTRA` — para lo que no encaje en ninguna de las anteriores

**Reglas:** Ninguna todavía sobre revisión/actualización de guía central — **pregunta abierta pendiente de tu respuesta** (¿alguien revisa las objeciones nuevas y las suma a una guía, o quedan archivadas?). No puede registrarse sobre un lead descartado (ver reglas de `LEAD_DESCARTADO`).

**Dispara:** Objeciones más frecuentes, objeciones por setter, objeciones asociadas a leads perdidos.

---

### 7. `LEAD_DESCARTADO`

**Descripción:** El lead deja de trabajarse dentro del proceso comercial por decisión del setter o por aplicación de una regla del negocio. No implica eliminar el lead ni borrar su historial; únicamente marca el fin de su recorrido en el embudo.

**Quién lo genera:** Setter (fase de embudo, antes de `D`) o Admin (fase de llamada, después de `D` — ver `02_reglas_de_negocio.md` sección 7). El setter no tiene participación en la fase de llamada, así que un descarte ahí solo puede venir del closer.

**Cuándo ocurre:** Cuando el lead dice explícitamente que no le interesa, o cuando se superan 4 seguimientos sin respuesta (fase de embudo). En la fase de llamada, cuando el closer determina que el lead no va a avanzar (mismos motivos de la lista, aplicados a lo que pasó en la llamada en vez de en los mensajes) — no hace falta agotar las 3 llamadas para descartar: si el closer decide antes que el lead está muerto, puede descartarlo en cualquier punto.

**Payload:**
```json
{
  "motivo": "SIN_RESPUESTA | RECHAZO_EXPLICITO | NO_CALIFICA | DUPLICADO | ERROR_CARGA",
  "detalle": "texto libre, opcional"
}
```

**Reglas:** Después de `LEAD_DESCARTADO` no pueden generarse nuevos eventos comerciales — `SEGUIMIENTO_ENVIADO`, `ESTADO_CAMBIADO`, `RESPUESTA_RECIBIDA`, `OBJECION_REGISTRADA`, `LLAMADA_REGISTRADA`, `PAGO_REGISTRADO` — para ese lead, salvo que en una versión futura exista una funcionalidad explícita de reapertura. Tampoco puede reasignarse a otro setter (`LEAD_ASIGNADO`): un lead descartado queda cerrado, no se vuelve a trabajar. **Excepción:** `NOTA_AGREGADA` sí puede registrarse después del descarte — es el mecanismo para que el setter deje cualquier explicación de contexto, incluyendo el motivo real detrás del descarte si quiere ampliarlo más allá del campo `motivo` fijo de este evento. Ver `02_reglas_de_negocio.md` para la lista fija de motivos válidos (no se acepta texto libre en `motivo`).

**Interacción con la fase de llamada (Sprint 4):** un lead puede descartarse en cualquier momento de su vida abierta — antes de `D` (por el setter) o después, durante la fase de llamada (por el `ADMIN`), mientras no haya cerrado. Un lead ya **cerrado** (`LLAMADA_REGISTRADA` con `cerro=true`) no puede descartarse — el cierre es terminal, no hay "descartar una venta". Un lead **descartado** no puede recibir una llamada nueva (ver reglas de `LLAMADA_REGISTRADA`). No se agrega un motivo nuevo para descartes originados en la fase de llamada — la lista fija existente (`SIN_RESPUESTA`, `RECHAZO_EXPLICITO`, `NO_CALIFICA`, `DUPLICADO`, `ERROR_CARGA`) ya es genérica por resultado, no por canal, y alcanza sin ampliarse.

**Motivo `HISTORICO` (solo importación histórica, no es un motivo del producto):** usado exclusivamente por `scripts/importar-crm/reconstruir-descartes.ts` para cerrar leads de un CRM cerrado de un setter ya inactivo, donde el Excel origen marcaba el descarte con color (no con un dato) y no registraba motivo ni fecha real. Todo lead importado que no llegó a `D` se considera muerto por abandono; la fecha usada es la del último evento conocido de ese lead, marcada `aproximada: true` (mismo flag que en `ESTADO_CAMBIADO`, ver arriba) porque no es la fecha real del cierre. **No está en la lista de motivos válidos que el backend acepta para descartes generados en operación normal (`event.ts`)** — un setter real nunca puede elegir `HISTORICO` desde la app.

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

**Reglas:** No reemplaza objeciones, cambios de estado ni seguimientos — si el contenido de la nota encaja en otro tipo de evento, debe registrarse como ese tipo, no como nota. A diferencia del resto de los eventos comerciales, sí puede registrarse sobre un lead con `LEAD_DESCARTADO` (ver reglas de ese evento) — es la única forma de dejar contexto adicional sobre un lead ya cerrado.

**Dispara:** Nada calculable directamente; es información de contexto para lectura humana.

---

### 9. `LLAMADA_REGISTRADA`

**Descripción:** El closer (rol `ADMIN`) registra el resultado de una llamada de venta con un lead que ya llegó a `D`. Es la unidad básica de la fase de cierre (`06_sprint_4.md`) — un segundo mini-embudo, independiente del embudo A→MS→B→C→D del setter, sobre el mismo lead.

**Quién lo genera:** Admin (no existe rol "closer" separado — ver `02_reglas_de_negocio.md` sección 7).

**Cuándo ocurre:** Después de que ocurre (o se intenta) una llamada agendada con el lead.

**Payload:**
```json
{
  "numero": 1,
  "fecha_call": "2026-07-24",
  "se_presento": true,
  "califico": true,
  "cerro": true,
  "monto_cierre": 250000,
  "moneda": "USD",
  "situacion": "texto libre",
  "notas": "texto libre",
  "autoevaluacion": "texto libre",
  "grabacion_url": "https://..."
}
```

- `numero`: 1, 2 o 3. Identifica cuál de las hasta 3 llamadas es.
- `fecha_call`: fecha **sin hora**, string `"YYYY-MM-DD"`, en hora local de Argentina — no un timestamp UTC. Es la fecha en la que ocurrió la llamada, no la fecha en la que el `ADMIN` cargó el evento (`timestamp` del evento); pueden diferir por días o meses si el registro se hace tarde. Los dashboards period-aware de la fase de llamada bucketean por `fecha_call`, **nunca** por `evento.timestamp`. Se guarda como string local (no como fecha con zona horaria) para que una llamada del día 31 a la noche no se bucketee en el mes siguiente por corrimiento de huso horario.
- `califico`: `null` si `se_presento=false` (no aplica).
- `cerro`: `null` si `califico` no es `true` (no aplica).
- `monto_cierre`: entero en **centavos** (`250000` = USD 2.500,00) — nunca decimal, el payload es JSON y los floats rompen la suma de cash collected. Solo tiene valor si `cerro=true`; `null` en caso contrario.
- `moneda`: **obligatoria** si hay `monto_cierre` (no opcional, sin default implícito). En V1 el único valor válido es `"USD"` — OPERAL opera en una sola moneda; el campo existe por trazabilidad y para no tener que reinterpretar montos históricos si en el futuro se abre a otra moneda. No hay conversión ni tipo de cambio en V1.

**Reglas:**
- ❌ **Solo puede registrarse sobre un lead cuya etapa actual (último `ESTADO_CAMBIADO`) sea exactamente `D`.** Un lead en `A`, `MS`, `B` o `C` rechaza el intento — mismo principio que rechazar un salto de etapa en el embudo original (`02_reglas_de_negocio.md` sección 2). No hay excepción: la fase de llamada no puede "adelantarse" a que el setter complete su parte.
- `numero` es secuencial y sin saltos: no puede registrarse `numero=2` sin que exista ya `numero=1` para ese lead, ni `numero=3` sin `numero=2` — mismo principio de "no saltar etapas" del embudo original, aplicado a este mini-embudo. Tope estricto: no se acepta `numero=4` o mayor.
- **Una vez que existe un `LLAMADA_REGISTRADA` con `cerro=true` para un lead, no puede registrarse ninguna llamada nueva para ese lead** — el cierre es terminal, mismo principio que `LEAD_DESCARTADO`. Esto permite que "¿este lead cerró?" sea un lookup directo (existe a lo sumo un evento con `cerro=true` por lead), no una reconstrucción de secuencia.
- **No puede registrarse sobre un lead con `LEAD_DESCARTADO`** — mismo bloqueo que el resto de los eventos comerciales (ver reglas actualizadas de `LEAD_DESCARTADO` más abajo). Un lead descartado durante la fase de llamada no puede recibir una llamada nueva, así como uno descartado antes de D nunca llega a esta fase.
- Puede re-registrarse el mismo `numero` como corrección, **solo si esa llamada sigue siendo la más reciente del lead y no cerró** (no hay corrección de una llamada ya superada por la siguiente, ni de un cierre ya registrado) — la proyección toma el evento más reciente de ese `numero`, mismo criterio que el resto del sistema.
- El resultado de la llamada **no genera ni modifica** eventos `ESTADO_CAMBIADO` — el embudo del setter (A→MS→B→C→D) no se toca.
- Visible únicamente para `ADMIN` — el `SETTER` no tiene acceso a este evento ni a sus datos.

**Dispara:** Show Up Rate, Close Rate (cerrados/calificados), estado de la fase de llamada por lead, lista de "leads a llamar".

---

### 10. `PAGO_REGISTRADO`

**Descripción:** Se registra un cobro sobre un lead cerrado. El monto total cerrado (`monto_cierre`, en `LLAMADA_REGISTRADA`) puede cobrarse en más de una parte si hay plan de pagos — "cash collected" es la suma de estos eventos, nunca un campo que se edita.

**Quién lo genera:** Admin.

**Cuándo ocurre:** Cada vez que se recibe un pago de un lead ya cerrado.

**Payload:**
```json
{
  "monto": 100000,
  "moneda": "USD",
  "fecha_pago": "2026-08-15",
  "nota": "texto libre"
}
```

- `monto`: entero en **centavos** (`100000` = USD 1.000,00) — nunca decimal, mismo motivo que `monto_cierre` en `LLAMADA_REGISTRADA`.
- `moneda`: **obligatoria**, sin default. En V1 el único valor válido es `"USD"` — mismo criterio que `LLAMADA_REGISTRADA`, no hay conversión ni multi-moneda en V1.
- `fecha_pago`: fecha **sin hora**, string `"YYYY-MM-DD"`, en hora local de Argentina — no un timestamp UTC. Los planes de pago hacen que una cuota entre meses después del cierre; los dashboards de cash collected bucketean por `fecha_pago`, **nunca** por `evento.timestamp`. Mismo motivo y mismo formato que `fecha_call` en `LLAMADA_REGISTRADA`.
- `nota`: opcional.

**Reglas:** Solo puede registrarse sobre un lead con un `LLAMADA_REGISTRADA` de `cerro=true`. El sistema no procesa pagos ni valida montos contra el total del trato — es un registro de dato, no un módulo de cobros (fuera de alcance del Sprint 4, ver `06_sprint_4.md`).

**Dispara:** Cash Collected, AOV (Call Efectiva), AOV (Trato Cerrado).

---

### 11. `CALENDAR_EVENTO_CREADO`

**Descripción:** Se agenda la llamada con el lead desde OPERAL OS (Sprint 5). **El evento local es el canónico** — se guarda siempre, exista o no conexión con Google Calendar. Si hay conexión y la API confirma, además queda linkeado a un evento real de Google; si no hay conexión, o la API falla, el evento local se guarda igual, sin ese link (ver `google_event_id` abajo y `02_reglas_de_negocio.md` sección 8, "Google Calendar como espejo opcional").

**Quién lo genera:** Setter o Admin.

**Cuándo ocurre:** Cuando se agenda la llamada desde OPERAL OS. No depende de que la API de Google Calendar responda.

**Payload:**
```json
{
  "google_event_id": "abc123xyz",
  "calendar_id": "primary",
  "fecha_hora_inicio": "2026-08-03T15:00:00-03:00",
  "fecha_hora_fin": "2026-08-03T15:30:00-03:00",
  "titulo": "texto libre",
  "invitados": ["lead@email.com"],
  "enlace": "https://meet.google.com/abc-defg-hij"
}
```

- `google_event_id`: **opcional** (`string | null`). Id del evento devuelto por la API de Google Calendar si la sincronización funcionó en el momento de crear el evento. `null` si no había conexión, o si la conexión existía pero la llamada a Google falló — en ningún caso bloquea que el evento local se guarde. Un evento con `google_event_id: null` puede sincronizarse después (ver `CALENDAR_EVENTO_SINCRONIZADO`, evento 13) o al editarlo con conexión activa (ver evento 12).
- `calendar_id`: **opcional**, solo presente si `google_event_id` también lo está.
- `fecha_hora_inicio`/`fecha_hora_fin`: con hora y zona horaria (a diferencia de `fecha_call`/`fecha_pago`, que son fecha sin hora) — un evento de calendario necesita el horario exacto. Esta es la fecha que alimenta cualquier cálculo que dependa de "cuándo es/fue la llamada" (p. ej. tiempos entre C y D) — se lee directo de acá, nunca de Google.
- `invitados`: opcional, lista de emails a los que se les envía la notificación de Google (solo aplica si hay `google_event_id`).
- `enlace`: **opcional** (`string`). Link de la llamada (ej. Google Meet/Zoom). Debe ser una URL `http://`/`https://` válida — se valida al guardar, nunca se envía a Google (no se escribe en el evento real de Calendar, es una limitación aceptada de esta versión). A diferencia de `titulo`/`invitados`, que solo viven acá, `enlace` se repite en el evento 12 (`CALENDAR_EVENTO_ACTUALIZADO`) — es editable en cada corrección, no fijo desde la creación.

**Reglas:**
- ❌ **Solo puede crearse si la etapa actual del lead es `C` o `D`.** Un lead en `A`, `MS` o `B` rechaza el intento.
- **No puede crearse sobre un lead con `LEAD_DESCARTADO`** — mismo bloqueo que el resto de los eventos comerciales.
- **Un lead tiene a lo sumo un evento de Calendar vigente.** Si ya existe uno (el más reciente `CALENDAR_EVENTO_CREADO`/`CALENDAR_EVENTO_ACTUALIZADO`/`CALENDAR_EVENTO_SINCRONIZADO` de ese lead no fue reemplazado), crear uno nuevo se rechaza — la corrección de un evento vigente es `CALENDAR_EVENTO_ACTUALIZADO`, no un `CREADO` nuevo.
- No genera ni modifica `ESTADO_CAMBIADO` — marcar C o D sigue siendo una acción manual separada.
- Un fallo al sincronizar con Google (conectado pero la API rechaza) **nunca revierte ni bloquea** la creación del evento local — se guarda con `google_event_id: null` y la UI avisa del fallo de sincronización por separado.

**Dispara:** vista de calendario interna (agenda propia de OPERAL, siempre disponible), vista de calendario de Google (solo si está sincronizado), botón "Editar"/"Sincronizar" en el detalle del lead.

---

### 12. `CALENDAR_EVENTO_ACTUALIZADO`

**Descripción:** Se edita (reagenda) el evento de Calendar vigente de ese lead — cambia el horario. Igual que el evento 11, es una escritura local incondicional; si hay conexión y el vigente ya tenía `google_event_id`, además actualiza el evento real en Google. Si el vigente todavía no tenía `google_event_id` y hay conexión activa, este evento lo crea en Google en ese momento (no lo actualiza, porque todavía no existe del lado de Google) y el `google_event_id` resultante queda registrado acá.

**Quién lo genera:** Setter o Admin.

**Cuándo ocurre:** Al editar el horario del evento desde OPERAL OS.

**Payload:**
```json
{
  "google_event_id": "abc123xyz",
  "fecha_hora_inicio": "2026-08-05T16:00:00-03:00",
  "fecha_hora_fin": "2026-08-05T16:30:00-03:00",
  "enlace": "https://meet.google.com/abc-defg-hij"
}
```

- `google_event_id`: **opcional** (`string | null`), mismo criterio que en el evento 11 — puede quedar en `null` si no hay conexión o si Google falla al momento de editar.
- `enlace`: **opcional** (`string`), mismo formato y validación que en el evento 11. Se manda de nuevo en cada edición (como `fecha_hora_inicio`/`fecha_hora_fin`) — el formulario de edición precarga el enlace vigente, así que "no tocarlo" al reagendar lo deja igual.

**Reglas:**
- ❌ Solo puede editarse el evento de Calendar **vigente** de un lead cuya etapa actual sea `C` o `D`.
- **No puede editarse sobre un lead con `LEAD_DESCARTADO`.**
- No genera ni modifica `ESTADO_CAMBIADO`.
- Mismo principio que el evento 11: un fallo de Google nunca bloquea el cambio de horario local.

**Dispara:** vista de calendario interna, vista de calendario de Google (si sincronizado).

---

### 13. `CALENDAR_EVENTO_SINCRONIZADO`

**Descripción:** El evento de Calendar vigente de un lead —creado o editado en algún momento sin conexión a Google, o cuya sincronización falló— se linkea (o re-linkea) a un evento real de Google, **sin cambiar el horario**. Es un hecho distinto de `CALENDAR_EVENTO_ACTUALIZADO`: ahí cambia el horario, acá solo cambia el vínculo con Google — separarlos mantiene la trazabilidad de "¿esto fue una reagenda real o solo una sincronización tardía?" legible directo del tipo de evento, sin tener que inspeccionar el payload para adivinarlo.

**Quién lo genera:** Setter o Admin.

**Cuándo ocurre:** Cuando alguien dispara "Sincronizar con Google" sobre un evento vigente sin `google_event_id`, y la API confirma la creación del evento en Google.

**Payload:**
```json
{
  "google_event_id": "abc123xyz",
  "fecha_hora_inicio": "2026-08-05T16:00:00-03:00",
  "fecha_hora_fin": "2026-08-05T16:30:00-03:00"
}
```

- `google_event_id`: **obligatorio** acá (a diferencia de los eventos 11 y 12) — este evento solo existe si la sincronización funcionó; si falla, no se genera nada (a diferencia de crear/editar, acá no hay "versión local sin Google" porque la única razón de este evento es justamente registrar que el link con Google ya existe).
- `fecha_hora_inicio`/`fecha_hora_fin`: copiadas sin cambios del evento vigente anterior — este evento nunca reagenda, solo sincroniza.

**Reglas:**
- ❌ Solo puede dispararse si existe un evento de Calendar vigente para el lead y ese vigente tiene `google_event_id: null`. Si ya está sincronizado, no hay nada que hacer.
- ❌ Requiere conexión con Google activa — sin conexión, no hay nada que sincronizar (a diferencia de crear/editar, este evento no tiene sentido "sin Google" por definición).
- **No puede dispararse sobre un lead con `LEAD_DESCARTADO`.**
- No genera ni modifica `ESTADO_CAMBIADO`.

**Dispara:** vista de calendario de Google (el evento pasa a aparecer ahí por primera vez), badge de "sincronizado" en la vista de calendario interna y en el detalle del lead.

---

### 14. `ANOMALIA_DETECTADA`

**Descripción:** El sistema detecta, por cálculo de umbrales (sin IA, sin modelo, sin API externa — puro cálculo sobre el Event Log y el calendario interno), que una tasa de conversión o un lead individual está fuera de los parámetros esperados, y registra el hecho de haberlo detectado. La **alerta** (lo que eventualmente se le muestra a un usuario) no es este evento — se calcula y se muestra en el momento de consulta, nunca se guarda. Lo que se guarda acá es el hecho de que el sistema, en tal momento, detectó tal condición: si un umbral cambia más adelante, la alerta de hoy puede cambiar, pero el hecho de que el sistema detectó esto en tal fecha, con tal valor medido, no cambia — mismo principio que distingue "estado actual" (proyección) de "evento" en el resto del sistema (ver `08_modelo_de_datos.md`).

**Quién lo genera:** Sistema (`actor_tipo = SISTEMA`, `actor_id = null`) — el caso de uso que ya anticipaba ese actor en `08_modelo_de_datos.md`.

**Cuándo ocurre:** En cada corrida de la evaluación periódica (ver `02_reglas_de_negocio.md` sección 9), cuando una condición de anomalía pasa de "no cumplida" a "cumplida" para un sujeto dado (lead, setter o equipo) — nunca en cada corrida mientras la condición sigue vigente sin cambios (ver idempotencia abajo).

**Dos familias, dos formas de payload:**

**A. Anomalías de conversión** (`MSR_BAJO`, `PRR_BAJO`, `CSR_BAJO`) — sujeto es un setter o el equipo completo:

```json
{
  "tipo_anomalia": "MSR_BAJO",
  "nivel": "SETTER",
  "setter_id": 5,
  "tasa_medida": 0.18,
  "umbral_anomalia": 0.25,
  "objetivo": 0.33,
  "numerador": 40,
  "denominador": 220
}
```

- `tipo_anomalia`: `MSR_BAJO` (A→MS) | `PRR_BAJO` (MS→B) | `CSR_BAJO` (B→C).
- `nivel`: `SETTER` | `EQUIPO`. `CSR_BAJO` es siempre `EQUIPO` — es la única de las tres que se evalúa a nivel de equipo, no por setter individual (un setter no junta volumen estadístico en B→C; ver `02_reglas_de_negocio.md` sección 9).
- `setter_id`: `null` cuando `nivel = EQUIPO`.
- `tasa_medida`/`numerador`/`denominador`: la tasa observada al momento de detectar y los conteos que la componen — quedan grabados aunque el umbral cambie después.
- `umbral_anomalia`/`objetivo`: el umbral violado y el objetivo de referencia, vigentes al momento de detectar (fuente única: `anomaliaConfig.ts`, ver `02_reglas_de_negocio.md` sección 9).

Este evento **no lleva `lead_id`** — la columna queda `null` (ver excepción de alcance más arriba y `08_modelo_de_datos.md`).

**B. Anomalías de tiempo** (`TIEMPO_A_MS`, `TIEMPO_MS_B`, `TIEMPO_B_C`, `TIEMPO_C_D`) — sujeto es un lead individual:

```json
{
  "tipo_anomalia": "TIEMPO_B_C",
  "atribuible_a": "SETTER",
  "setter_id": 7,
  "horas_transcurridas": 80.5,
  "umbral_horas": 72,
  "desde": "2026-07-25T10:00:00.000Z"
}
```

- `tipo_anomalia`: `TIEMPO_A_MS` | `TIEMPO_MS_B` | `TIEMPO_B_C` | `TIEMPO_C_D`.
- `atribuible_a`: `LEAD` | `SETTER` — fijo por `tipo_anomalia` (no varía instancia a instancia), se guarda igual para no obligar a un lookup en cada consumidor: `TIEMPO_A_MS` → `LEAD`, `TIEMPO_MS_B` → `SETTER`, `TIEMPO_B_C` → `SETTER`, `TIEMPO_C_D` → `LEAD`.
- `setter_id`: dueño del lead (último `LEAD_ASIGNADO`) al momento de detectar — puede ser `null` si el lead nunca se asignó. **Limitación conocida:** no es necesariamente quien causó la demora si hubo una reasignación en el medio — ver `99_deuda_tecnica.md`.
- `horas_transcurridas`/`umbral_horas`: horas reales transcurridas y el umbral violado (fuente: `anomaliaConfig.ts`). Para `TIEMPO_C_D`, `umbral_horas` es el tiempo hasta la fecha de la llamada (evento de Calendar vigente del lead, ver `08_modelo_de_datos.md`) o, si no hay evento con fecha, el default de 48h.
- `desde`: timestamp del evento que arranca el conteo de esa transición (el `ESTADO_CAMBIADO` a la etapa de origen).

Este evento **sí lleva `lead_id`** — el lead afectado, igual que el resto del catálogo.

**Idempotencia (evita duplicar el Event Log en cada corrida mientras la condición sigue vigente):**

- **Anomalías de tiempo:** el embudo es secuencial y sin retroceso (`02_reglas_de_negocio.md` sección 2) — cada lead pasa por cada transición como máximo una vez en su vida. Alcanza con chequear existencia: si ya existe un `ANOMALIA_DETECTADA` con ese `tipo_anomalia` y ese `lead_id`, no se inserta uno nuevo. No puede volver a hacer falta, porque esa espera puntual no puede repetirse para ese lead.
- **Anomalías de conversión:** la tasa fluctúa (sube y baja con cada lead nuevo), así que sí puede resolverse y reaparecer. Se detecta el **borde** (edge-triggered), no el nivel: antes de insertar, se recalcula la tasa **excluyendo el evento `ESTADO_CAMBIADO` más reciente que la afecta**. Si la tasa sin ese último evento ya era anómala (o el piso ya se cumplía y ya estaba mal) → continuación de un episodio ya registrado → no se inserta nada. Si la tasa sin ese último evento no era anómala (o no llegaba al piso) pero con él sí → ese es el instante exacto de la transición a anómalo → se inserta el evento. Esto es correcto sin importar cada cuánto corre la evaluación (ver `02_reglas_de_negocio.md` sección 9) — siempre encuentra el mismo punto de cruce reprocesando el historial, no depende de una ventana de tiempo.

**Cumple el criterio de 4 puntos de este documento:**

1. Es un hecho irreversible: el sistema detectó tal condición en tal momento, con tal valor medido — eso no cambia si el umbral cambia después.
2. No se reconstruye de otros eventos: sin este evento no queda registro de *cuándo* el sistema detectó la anomalía por primera vez (la tasa o el tiempo actual siempre se pueden recalcular, pero no el instante de detección).
3. Aporta trazabilidad real: permite auditar cuándo empezó cada episodio anómalo, y alimenta el módulo de dashboards individuales (siguiente, fuera de este alcance).
4. No es la alerta en sí (que se calcula y se muestra, nunca se guarda), no es una regla ni un KPI — es el registro de que el sistema aplicó la regla y encontró una violación.

**Dispara:** módulo de dashboards de anomalías (siguiente, fuera de este alcance) — este evento solo detecta y registra, no visualiza.

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
| 9 | `LLAMADA_REGISTRADA` | Admin | Sí (número, resultado, montos) |
| 10 | `PAGO_REGISTRADO` | Admin | Sí (monto, nota) |
| 11 | `CALENDAR_EVENTO_CREADO` | Setter / Admin | Sí (google_event_id opcional, horario) |
| 12 | `CALENDAR_EVENTO_ACTUALIZADO` | Setter / Admin | Sí (google_event_id opcional, horario) |
| 13 | `CALENDAR_EVENTO_SINCRONIZADO` | Setter / Admin | Sí (google_event_id obligatorio, horario sin cambios) |
| 14 | `ANOMALIA_DETECTADA` | Sistema | Sí (dos formas: conversión o tiempo) |

## Pendiente fuera de este documento

- Eventos administrativos (`IMPORTACION_REALIZADA`, `SETTER_CREADO`, `SETTER_DESACTIVADO`, `REPORTE_DIARIO_ENVIADO`) → `09_eventos_administrativos.md`.
- Detección de anomalías **basada en IA/modelo** (más allá de `ANOMALIA_DETECTADA`, que ya está en este catálogo como cálculo de umbrales sin IA — ver evento 14) → si en el futuro se agrega, se diseña aparte cuando exista esa funcionalidad.
- Respuesta a: ¿las objeciones nuevas se revisan y suman a una guía central, o quedan archivadas?

---

*Este documento es la base directa de `08_modelo_de_datos.md`. Cualquier evento agregado después debe pasar por el criterio de la sección "Criterio para crear un nuevo evento".*
