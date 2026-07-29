# 08 — Modelo de Datos — OPERAL OS (V1)

Este documento traduce el `03_catalogo_eventos.md` en entidades y relaciones. Es la última pieza de diseño antes de generar código: a partir de acá, cualquier decisión nueva que surja durante el desarrollo se resuelve actualizando el documento correspondiente (este o el catálogo de eventos), no creando documentos nuevos.

---

## Fuente de verdad y proyecciones

El **Event Log es la única fuente de verdad del sistema.**

Cualquier representación del estado actual (lead asignado, etapa actual, embudos, dashboards, KPIs o listas de trabajo) es una **proyección derivada**, construida a partir de los eventos.

Las proyecciones pueden optimizarse mediante consultas, vistas o vistas materializadas, pero nunca deben convertirse en la fuente de verdad del sistema.

**Aclaración:** esto aplica a todo estado que sea *derivable* de eventos ya existentes (por ejemplo, "etapa actual de un lead" siempre se calcula, nunca se guarda aparte). No aplica de la misma forma a un evento nuevo que el sistema decide registrar como hecho — por ejemplo, cuando la detección de anomalías por reglas (sin IA, cálculo puro de umbrales — ver `02_reglas_de_negocio.md` sección 9) encuentra una condición y la guarda como `ANOMALIA_DETECTADA`, eso es un evento legítimo (algo que el sistema detectó, con actor `SISTEMA`), no una proyección — aunque la tasa o el tiempo transcurrido que lo originó siempre se puedan recalcular desde los eventos. La regla no es "nunca guardar nada calculado por el sistema", es "el estado actual nunca vive fuera del Event Log como si fuera él mismo la verdad".

Si Kimi entiende esta sección, la mayoría de las decisiones de implementación durante el desarrollo deberían resolverse solas, sin necesidad de consultar cada caso puntual.

---

## Entidades — V1

### `Usuario`
Representa a cualquier persona con acceso al sistema (setter, manager, dueño).

```
Usuario
  id
  nombre
  email
  rol          (SETTER | MANAGER | ADMIN)
  activo
```

**Nota sobre Setter:** no existe como entidad independiente. Un Usuario con `rol = SETTER` puede recibir asignaciones de leads — nada más. *(Se evaluó modelar el ciclo de vida completo de reclutamiento del setter — formulario → entrevista → prueba → activo → baja — y se decidió posponerlo a una versión futura. En V1 el setter ya existe como usuario activo.)*

### `Lead`
Representa a un prospecto dentro del embudo comercial.

```
Lead
  id
  nombre
  instagram_username
```

**Importante:** `Lead` no guarda `etapa_actual`, `setter_asignado` ni `creado_en` como campos propios — todos son proyecciones derivadas del Event Log (último `ESTADO_CAMBIADO`, último `LEAD_ASIGNADO`, y `LEAD_CREADO.timestamp` respectivamente). Guardarlos aparte contradice el principio de Fuente de verdad y proyecciones. Si el rendimiento lo justifica más adelante, se resuelve con índices o vistas materializadas — nunca duplicando el dato como campo de la tabla.

*(Nota: `instagram_username` asume que todos los leads, incluidos los del canal RPP, se contactan por Instagram. A confirmar — si RPP usa otro canal, este campo debe generalizarse.)*

### `Evento`
La entidad central del sistema. Ver `03_catalogo_eventos.md` para el detalle de cada tipo y su payload.

```
Evento
  id
  tipo          (LEAD_CREADO | LEAD_ASIGNADO | ESTADO_CAMBIADO | SEGUIMIENTO_ENVIADO |
                 RESPUESTA_RECIBIDA | OBJECION_REGISTRADA | LEAD_DESCARTADO | NOTA_AGREGADA |
                 LLAMADA_REGISTRADA | PAGO_REGISTRADO | CALENDAR_EVENTO_CREADO |
                 CALENDAR_EVENTO_ACTUALIZADO | CALENDAR_EVENTO_SINCRONIZADO | ANOMALIA_DETECTADA)
  lead_id       (FK a Lead, nullable — único caso: ANOMALIA_DETECTADA de nivel SETTER/EQUIPO, ver 03_catalogo_eventos.md evento 14)
  actor_tipo    (SETTER | MANAGER | ADMIN | SISTEMA)
  actor_id      (FK a Usuario, nulo si actor_tipo = SISTEMA)
  timestamp
  payload       (JSON cuyo esquema depende del tipo de evento — definido en 03_catalogo_eventos.md)
```

---

## Entidades explícitamente NO creadas en V1 (y por qué)

| Entidad candidata | Por qué no en V1 | Cuándo sí tendría sentido |
|---|---|---|
| `Objecion` | La objeción no tiene ciclo de vida propio, ni relaciones, ni permisos, ni pantalla propia — es solo un dato dentro del payload de `OBJECION_REGISTRADA` | Cuando exista una base de conocimiento de objeciones con respuesta sugerida (entonces el evento pasaría a referenciar `objecion_id` en vez de texto libre) |
| `Importacion` | No hay necesidad hoy de ver historial de importaciones, deshacerlas o auditar lotes de scraping por separado | Cuando se necesite reimportar, deshacer una importación, o rastrear qué lote generó qué leads |
| `Llamada` | La llamada (Sprint 4) no tiene ciclo de vida propio más allá de los campos de su payload — es un dato dentro de `LLAMADA_REGISTRADA`, igual que `Objecion`. El "estado de la fase de llamada" de un lead es una proyección calculada, no una fila guardada | Si en el futuro se necesita programar llamadas con anticipación (recordatorios, calendario propio) en vez de solo registrar el resultado post-hoc |
| `CalendarEvento` | La integración con Google Calendar (Sprint 5) tampoco crea una entidad propia — el horario y (si está sincronizado) el `google_event_id` viven en el payload de `CALENDAR_EVENTO_CREADO`/`CALENDAR_EVENTO_ACTUALIZADO`/`CALENDAR_EVENTO_SINCRONIZADO`, igual que `Llamada` y `Objecion`. El evento local es el canónico — no depende de Google para existir; `google_event_id` es opcional en el payload y puede quedar `null` si nunca se sincronizó | Si se necesita administrar más de un evento vigente por lead, o metadata de Calendar que no quepa en un payload de evento |

`LEAD_CREADO` guarda un `importacion_id` en su payload como referencia de trazabilidad, pero **no es una foreign key real** en V1 — es solo un dato de contexto, no una relación con una tabla `Importacion` (que no existe todavía).

---

## Relaciones

```
Usuario
   │
   └── tiene muchos ───────► Evento (como actor)

Lead
   │
   └── tiene muchos ───────► Evento
```

La asignación actual entre un Usuario (rol `SETTER`) y un Lead se obtiene leyendo el último evento `LEAD_ASIGNADO` de ese lead — no existe como relación directa ni como campo guardado.

---

## Identidad

Cada entidad posee un ID único e inmutable. Ese ID nunca cambia durante toda la vida del registro y es la única forma válida de identificarlo. Los datos descriptivos (nombre, email, username) pueden modificarse; los IDs no.

## Proyecciones típicas que se van a necesitar (no son tablas, son consultas)

Estas son ejemplos de vistas derivadas que el sistema va a necesitar calcular frecuentemente. Se documentan acá para que quede explícito que son consultas sobre el Event Log, no estado guardado aparte:

- **Etapa actual de un lead:** último `ESTADO_CAMBIADO` de ese lead.
- **Setter actual de un lead:** último `LEAD_ASIGNADO` de ese lead.
- **Leads activos de un setter:** leads cuyo último evento de asignación corresponde al setter consultado y que no poseen un evento `LEAD_DESCARTADO`. *(Nota: esta condición es absoluta — si en el futuro se implementa reapertura de leads descartados, hay que revisar esta consulta, porque tal como está excluiría para siempre a cualquier lead reabierto.)*
- **KPIs (MSR, PRR, CSR, ABR):** calculados contando transiciones de `ESTADO_CAMBIADO` en un rango de fechas.
- **Timeline completo de un lead:** todos los eventos de ese `lead_id`, ordenados por `timestamp`.
- **¿Un lead cerró? (Sprint 4):** existe un `LLAMADA_REGISTRADA` con `cerro=true` para ese lead. Gracias a la regla de que el cierre es terminal (ver `03_catalogo_eventos.md`), es un lookup directo — a lo sumo un evento así por lead, no hay que reconstruir la secuencia de llamadas.
- **Estado de la fase de llamada de un lead (Sprint 4):** `PENDIENTE_LLAMAR` (llegó a D, cero llamadas) / `PENDIENTE_REAGENDA` (la última llamada no cerró y quedan intentos) / `CERRADO` / `PERDIDO` (se usaron las 3 llamadas sin cerrar) — derivado del conjunto de `LLAMADA_REGISTRADA` de ese lead, análogo a "etapa actual" pero para el mini-embudo del closer.
- **Cash collected de un lead (Sprint 4):** suma de los montos de todos los `PAGO_REGISTRADO` de ese lead.
- **Evento de Calendar vigente de un lead (Sprint 5):** el más reciente entre todos los `CALENDAR_EVENTO_CREADO`/`CALENDAR_EVENTO_ACTUALIZADO`/`CALENDAR_EVENTO_SINCRONIZADO` de ese `lead_id`, ordenados por `timestamp` — mismo criterio de "último evento gana" que ya usa "etapa actual" o "setter actual". Ese evento trae el horario a mostrar en la vista de calendario interna (siempre disponible, no depende de Google) y, si tiene `google_event_id`, el id a usar para el botón "Editar"/vista de Google; si no lo tiene, habilita el botón "Sincronizar con Google".
- **Agenda local de un rango de fechas (Sprint 5b):** todos los eventos vigentes (mismo criterio que el punto anterior, aplicado por lead) cuyo `fecha_hora_inicio` cae dentro del rango pedido — es la proyección que alimenta la vista de calendario interna de OPERAL OS, calculada leyendo `eventos` directo, sin llamar a la API de Google en ningún punto.
- **¿Ya hay una anomalía vigente para un sujeto? (módulo de detección de anomalías):** para anomalías de tiempo, un lookup directo — existe un `ANOMALIA_DETECTADA` con ese `tipo_anomalia` y ese `lead_id` (ver `03_catalogo_eventos.md` evento 14). Para anomalías de conversión (setter/equipo) no es un lookup directo: se recalcula la tasa excluyendo el `ESTADO_CAMBIADO` más reciente que la afecta, para determinar si el episodio actual ya estaba registrado o es una transición nueva — mismo evento 14, idempotencia por borde (edge-triggered), no por ventana de tiempo.
- **Dashboard individual de un setter (módulo de dashboards por setter, `02_reglas_de_negocio.md` sección 10):** combina tres proyecciones que ya existen, filtradas a un `setter_id` puntual — su embudo (mismo cálculo que la comparación por setter del dashboard ejecutivo), su lista de leads activos (ver "Leads activos de un setter" arriba), y sus `ANOMALIA_DETECTADA` (de tiempo por `setter_id`, de conversión de nivel `SETTER` con ese `setter_id`; nunca las de nivel `EQUIPO`). No es una entidad ni agrega ningún dato guardado — existe apenas el usuario tiene `rol=SETTER`, con resultado vacío si todavía no tiene eventos.

Si el volumen de datos lo justifica más adelante, estas consultas pueden optimizarse con vistas materializadas — pero siguen siendo proyecciones, nunca la fuente de verdad.

---

*Con este documento, el catálogo de eventos (`03_catalogo_eventos.md`) y el documento del setter (`01_dia_en_la_vida_del_setter.md`), Kimi tiene la base necesaria para empezar a generar el proyecto. Decisiones nuevas que surjan durante el desarrollo se incorporan actualizando estos documentos, no creando documentos nuevos.*
