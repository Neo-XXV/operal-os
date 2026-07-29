# 10 — Arquitectura de la capa de IA — OPERAL OS

Este documento es **diseño conceptual**, no una especificación de implementación. No hay código en este documento y no debe usarse como base para escribir código sin una revisión técnica aparte (mismo criterio que `02_reglas_de_negocio.md`/`03_catalogo_eventos.md`: primero se valida el diseño, después se planifica la implementación).

Alcance: la capa de IA de OPERAL OS — un asistente de **solo lectura** para el ADMIN, que razona sobre datos ya calculados por el sistema (proyecciones, KPIs, eventos `ANOMALIA_DETECTADA`) y devuelve explicaciones/recomendaciones en lenguaje natural. No diseña UI (eso es un documento aparte, cuando corresponda) y no toca el motor de reglas (`docs/02_reglas_de_negocio (1).md` sección 9, `docs/03_catalogo_eventos.md` evento 14), que es un insumo de este diseño, no parte de él.

---

## 1. La decisión que hay que encarar primero: prototipo, no infraestructura

Dos objetivos posibles, incompatibles entre sí en el corto plazo:

- **Prototipo liviano**: validar si la IA aporta valor real, con la menor inversión posible. Un proveedor, sin memoria de conversación, sin versionado de prompts, cero tablas nuevas.
- **Infraestructura de producción**: multi-proveedor con failover, prompts versionados y A/B-testeados, memoria de conversación persistida, cacheo, observabilidad dedicada.

**Corresponde el prototipo liviano ahora.** Tres razones concretas, no genéricas:

1. **El motor de reglas —la fuente de datos principal de la IA— todavía se está implementando.** Los payloads de `ANOMALIA_DETECTADA`, los umbrales de `anomaliaConfig.ts` y hasta la cadencia del barrido pueden cambiar mientras se usa en producción por primera vez. Construir infraestructura de IA pesada sobre un contrato de datos que todavía se está asentando es invertir en durabilidad antes de tener algo estable que durar.
2. **Los datos reales de setters recién empiezan a fluir esta semana.** Nadie usó ni una sola vez ninguna función de IA todavía. No hay señal de qué preguntas importan, qué formato de respuesta sirve, ni si el admin va a usar esto a diario o una vez por semana. Construir versionado de prompts o memoria de conversación antes de la primera consulta real es optimizar una demanda que todavía no existe — YAGNI puro.
3. **Un solo usuario (el ADMIN), sin concurrencia, sin necesidad de historial entre sesiones.** Cada consulta es autocontenida: se arma contexto, se pregunta, se muestra la respuesta. No hay una conversación de varios turnos que mantener viva entre pantallas ni entre días.

Esto **no** significa código descartable sin cuidado — significa **la abstracción mínima que permite reemplazar piezas después sin reescribir todo**, no la abstracción máxima que anticipa escenarios sin evidencia de que vayan a ocurrir. La sección 7 es la interfaz concreta de ese mínimo. La sección 11 lista, explícitamente, todo lo que se decide NO construir ahora.

---

## 2. Frontera de responsabilidades: motor de reglas vs. IA

**Principio:** el motor de reglas detecta **QUÉ** pasó (barato, determinista, auditable). La IA razona sobre el **POR QUÉ** y qué hacer al respecto, únicamente donde no existe — ni puede existir— una regla determinista.

Test simétrico (mismo espíritu que el criterio de 4 puntos de `03_catalogo_eventos.md` para admitir un evento nuevo):

**Va al motor de reglas si TODAS son ciertas:**
1. Tiene una fórmula matemática única y reproducible (una tasa, un conteo, una comparación contra un umbral).
2. El mismo input siempre da el mismo output — determinismo total.
3. Se puede auditar re-ejecutando el cálculo a mano, sin ambigüedad.
4. No requiere juicio, ponderación relativa entre señales dispares, ni lenguaje natural.

**Va a la IA si CUALQUIERA es cierta:**
1. Requiere combinar varias señales heterogéneas sin una fórmula fija (ej.: "¿por qué cayó el CSR?" combina tasa, timing, objeciones y contexto — no hay una sola fórmula que devuelva "la causa").
2. El resultado es una explicación, un resumen o una recomendación en lenguaje natural, no un número.
3. Implica priorizar subjetivamente entre varias opciones válidas (ej.: "¿cuáles son las 3 acciones más importantes hoy?" no tiene una única respuesta correcta).
4. Involucra sintetizar texto libre ya existente (notas, `detalle` de objeciones), no calcularlo.

**Consecuencia directa:** la IA nunca sabe sumar, contar ni dividir por su cuenta dentro de este sistema. Todo número que use ya vino calculado por `calcularEmbudo`, `dashboardEjecutivo`, `embudoPorSetter`, `embudoPorOrigen` o por un evento `ANOMALIA_DETECTADA` ya insertado. Si una pregunta requiere un número que hoy no existe como proyección, la respuesta correcta es "hace falta agregar esa proyección al motor de reglas", no "que la IA lo calcule mejor" — la aritmética no es una tarea de razonamiento abierto, es exactamente lo que ya hace bien (y barato, y auditable) el motor de reglas.

---

## 3. Privacidad y minimización de datos (restricción de diseño, no nota al pie)

Regla dura, aplicada en la capa que arma el contexto (nunca como criterio caso por caso):

> **El contexto que se le manda al modelo nunca incluye `nombre`, `instagram_username` ni `email` de un lead, ni el `nombre` de un setter. Solo IDs numéricos (`lead_id`, `setter_id`) y datos agregados/estructurados.**

Por qué alcanza con IDs:

- El **ADMIN** es el único consumidor de las respuestas, y ya tiene la UI de OPERAL OS abierta — puede resolver `lead_id: 1653` o `setter_id: 7` a un nombre real con un click, en su propia pantalla, sin que ese nombre haya viajado nunca a un proveedor externo.
- La resolución ID → nombre queda **del lado del cliente/servidor de OPERAL, nunca del lado del modelo** — es una tabla de lookup local (`users`, `leads`), no algo que el LLM necesite para razonar. El texto de la respuesta de la IA puede decir "el lead #1653 lleva 80h en B"; la UI (fuera de alcance de este documento) puede, si quiere, sustituir ese ID por el nombre al renderizar — un paso que ocurre después de que el modelo ya respondió, no antes.
- Para métricas de **setter**, el mismo criterio aplica con más razón: `MSR_BAJO`/`PRR_BAJO`/`CSR_BAJO` son señales de desempeño potencialmente sensibles (equivalen a datos de evaluación de un empleado). Enviar `setter_id: 7` en vez de un nombre real a un proveedor externo es la diferencia entre "un identificador operativo" y "un dato de RR.HH. de un tercero" — no es una decisión de estilo, es la que determina si esto es aceptable enviarlo a un LLM externo en absoluto.

**Consecuencia de diseño:** el `ContextBuilder` (sección 5) directamente **no selecciona** esas columnas al armar el JSON para el modelo. No es un filtro que se pueda olvidar aplicar — es una capa que estructuralmente nunca tuvo esos campos disponibles para incluir.

**Excepción documentada — texto libre de objeciones:** el resumen de objeciones (sección 8) es la única funcionalidad que manda texto libre (`detalle` de `OBJECION_REGISTRADA`, evento 6) al modelo, porque la tarea es justamente resumir ese texto — no hay forma de resumir contenido sin mandar el contenido. Ese `detalle` lo escribe el setter a mano y **puede mencionar incidentalmente un nombre** (del lead, o de un tercero) si así lo redactó. No se sanitiza con regex — un filtro de nombres propios sobre texto libre en español es frágil (falsos negativos constantes, falsos positivos sobre palabras comunes) y da una falsa sensación de seguridad peor que no filtrar. Es una limitación aceptada, acotada a este único campo de este único feature — no debilita la regla general de la sección 3 para el resto del sistema (IDs y agregados en todo lo demás).

**Sobre proveedores:** ningún dato del negocio va a un tier que entrena con los prompts (tiers gratuitos "de consumidor", ej. Mistral "Experiment" mencionado como ejemplo explícito a evitar). Los tiers de **API de pago** de los proveedores mayores (Gemini API, Anthropic API) contractualmente excluyen los datos de la API del entrenamiento — pero esto hay que **verificarlo en la política vigente al momento de integrar**, no asumirlo como un hecho fijo para siempre. La sección 8 muestra que, al volumen real de este sistema, el costo de un tier de pago es irrelevante — así que no hay ningún argumento económico para arriesgar un tier gratuito de entrenamiento. Se paga, y con eso el problema de privacidad respecto del proveedor queda resuelto por contrato, no por confianza.

---

## 4. Flujo de información

La IA **nunca** lee la tabla `eventos` directamente, y **nunca** recibe el Event Log completo. Se sienta encima de dos capas que ya existen (o se están terminando de implementar) y no agrega ningún acceso nuevo a la base:

```
eventos (Event Log, inmutable — MySQL)
   │
   ├──► Proyecciones (app/api/routers/event.ts)
   │    calcularEmbudo · dashboardEjecutivo · dashboardHistorico
   │    embudoPorSetter · embudoPorOrigen · obtenerEstadoLlamada · ...
   │
   └──► Motor de reglas (app/api/routers/anomalia.ts)
        evaluarAnomalias → eventos ANOMALIA_DETECTADA (conversión y tiempo)
                │
                ▼
        ContextBuilder (nuevo, capa fina — una función por funcionalidad)
        arma un JSON acotado: SOLO los campos que esa consulta necesita,
        sin nombre/instagram/email (sección 3), con cada número etiquetado
                │
                ▼
        AIProvider (interfaz única, sección 7)
        prompt de sistema + contexto JSON + pregunta → texto
                │
                ▼
        Validador anti-alucinación (sección 6) — determinista, sin IA
        chequea que los números citados en la respuesta existan en el contexto
                │
                ▼
        Procedure tRPC (adminQuery — mismo patrón que el resto del sistema)
                │
                ▼
        Admin (lee, decide, actúa manualmente — la IA no ejecuta nada)
```

Punto de diseño clave: el `ContextBuilder` **reutiliza las mismas funciones que ya exponen los dashboards** (`calcularEmbudo`, `dashboardEjecutivo`, `embudoPorSetter`, `embudoPorOrigen`, la lectura de `ANOMALIA_DETECTADA`) — no se escribe ninguna consulta nueva a la base para la IA. Si mañana se optimiza una proyección con una vista materializada (`08_modelo_de_datos.md`, "proyecciones típicas"), la IA se beneficia automáticamente sin cambiar una línea de su propio código.

---

## 5. Contexto mínimo por consulta

Regla general: **el contexto es específico de la pregunta, nunca "todo lo que hay"**. Cada funcionalidad tiene su propio `ContextBuilder`, no hay un "contexto general de la empresa" que se arma una vez y se reutiliza para todo — eso desperdiciaría tokens en datos irrelevantes para la pregunta puntual y aumentaría la superficie de qué datos viajan afuera sin necesidad.

Ejemplo concreto, con datos reales del sistema (verificados en esta sesión, `setter_id` sin nombre): contexto para "explicar la caída de conversión de un setter" —

```json
{
  "tipo_anomalia": "PRR_BAJO",
  "setter_id": 7,
  "tasa_medida": 0.4013,
  "umbral_anomalia": 0.5,
  "objetivo": null,
  "numerador": 179,
  "denominador": 446,
  "periodo": "lifetime"
}
```

Esto son ~60 tokens. Ni el nombre del setter, ni de ningún lead, ni el Event Log crudo — solo el hecho ya calculado.

### Estimación de tokens/costo por funcionalidad

Cifras de **orden de magnitud**, no cotización — sirven para decidir "esto es trivial en cualquier tier" vs. "esto hay que acotarlo", no para presupuestar con precisión. Asume prompt de sistema (~350-450 tokens fijos: instrucciones + regla anti-alucinación) + contexto variable + respuesta.

| Funcionalidad | Contexto (fuente) | Tokens entrada (aprox.) | Tokens salida (aprox.) | Total/consulta |
|---|---|---|---|---|
| Explicar caída de CSR/MSR/PRR | 1-3 `ANOMALIA_DETECTADA` de conversión + `embudoPorSetter` | ~900-1.400 | ~300-500 | **~1.500-2.000** |
| Patrón de leads perdidos | `LEAD_DESCARTADO` agregado por `motivo`/origen/setter (ya agregable con lo existente) | ~700-1.200 | ~300-400 | **~1.000-1.800** |
| Top-3 acciones del día | `ANOMALIA_DETECTADA` de tiempo abiertas (acotado a las N más severas, ver nota) | ~1.000-4.000 | ~200-300 | **~1.500-4.500** |
| Análisis de N leads (proyección, no timeline crudo) | Proyección por lead (etapa, tiempo en etapa, seguimientos, objeciones) × N, **no** el timeline completo de eventos | ~120-180/lead | ~50-80/lead | **~1.900-2.700 para N=10** |
| Resumen de objeciones | Conteo por `tipo` (taxonomía cerrada, `03_catalogo_eventos.md` evento 6) + muestra acotada de `detalle` | ~1.000-1.200 | ~300-500 | **~1.500** |
| Riesgo de no-show (V1, checklist — ver sección 9) | Señales estructuradas de un lead (respuestas, tiempo en C, seguimientos) | ~500-600/lead | ~150/lead | **~700-800/lead** |

Notas importantes sobre estas filas:

- **"Análisis de N leads" se arma con proyecciones por lead, nunca con el timeline crudo de eventos.** Un lead con historial completo (seguimientos, notas, cambios de estado) puede tener 15-30 eventos — mandar eso tal cual son ~800-2.000 tokens **por lead**, contra ~150 tokens si se manda la proyección ya resumida. Esto es una decisión de diseño, no un detalle de implementación: reduce el costo ~10x y reduce cuánto texto libre (notas) viaja afuera. `N` debe tener un tope explícito en el procedure (ej. 20-30) — si el admin pide más, se pagina, no se manda todo en una sola consulta.
- **"Top-3 acciones del día" se acota a las anomalías más severas**, no a todas las abiertas — con el volumen actual (~1.600 leads) el número de anomalías de tiempo abiertas en un momento dado debería ser chico (decenas, no cientos), pero el procedure igual debe tener un tope duro (ej. las 40 más severas por `horas_transcurridas - umbral_horas`) para no volver el costo dependiente de un pico inesperado de leads atascados.

### Costo mensual estimado

Con un solo usuario (el ADMIN) y un uso activo — digamos 20-30 consultas/día combinando las seis funcionalidades, ~2.000 tokens promedio por consulta — el volumen mensual ronda **1-2 millones de tokens/mes**. A cualquier tarifa de un tier de pago estándar de un proveedor mayor (no gratuito, no de consumidor), esto cae en el orden de **unos pocos dólares por mes**, incluso con un margen generoso de error en la estimación. **La conclusión relevante no es el número exacto — es que a esta escala el costo nunca es el factor decisivo.** La decisión de proveedor se toma por privacidad (sección 3) y calidad de respuesta, no por precio — verificar la tarifa vigente al momento de integrar, pero no vale la pena optimizar around it de antemano.

---

## 6. Estrategia anti-alucinación

Cuatro mecanismos, cada uno barato y ninguno es "otro modelo de IA revisando al primero" (eso agregaría costo y otra fuente de error, no lo resolvería):

1. **El modelo nunca calcula, solo interpreta.** Ya establecido en la sección 2 — es la defensa estructural más fuerte: si el modelo no tiene margen para hacer aritmética (todo ya viene sumado/dividido/comparado por el motor de reglas), no puede "alucinar" un cálculo, solo puede interpretar mal uno que ya es correcto — un error de un tipo completamente distinto y mucho más fácil de auditar leyendo la respuesta.

2. **Prompt de sistema explícito y no negociable**, aproximadamente: *"Solo podés usar los números que aparecen en el JSON de contexto. Nunca inventes una tasa, un conteo o un umbral que no esté ahí. Si falta un dato para responder con precisión, decilo explícitamente en vez de estimarlo."* Cada número en el contexto va **siempre** etiquetado con su significado (`"umbral_anomalia": 0.5`, nunca un `0.5` suelto) — reduce que el modelo reinterprete un número sin su unidad/semántica.

3. **Validador determinista, no otro LLM.** Una función simple (regex/parseo numérico) que extrae los números que la respuesta del modelo afirma y verifica que cada uno aparezca en el contexto que se le mandó. Si la respuesta cita un número que no está en el contexto, se marca como sospechosa (log + aviso visible al admin: "esta respuesta menciona un valor que no pudimos verificar contra los datos") — no se bloquea silenciosamente (el admin sigue siendo quien decide qué confiar), pero queda visible. Esto es código determinista de unas pocas líneas, no una segunda llamada a un modelo — coherente con "prototipo liviano" y con alto valor por bajo costo de construcción.

4. **Temperatura baja (cercana a 0) para las funcionalidades que citan números** (explicar caída de KPI, resumen de objeciones con conteos) — reduce variabilidad creativa donde no corresponde. Las funcionalidades más abiertas (top-3 acciones, priorización) pueden tener temperatura moderada porque ahí la variabilidad es en el *orden/fraseo* de una recomendación, no en los números subyacentes (que siguen viniendo del contexto, no del modelo).

---

## 7. Desacople de proveedor: el mínimo útil, no el máximo posible

Precedente directo ya en el código: `GoogleCalendarService` (`app/api/lib/googleCalendarService.ts`) — una clase, un factory estático, `fetch` nativo (sin SDK pesado), 3 métodos concretos porque la API de Google tiene 3 operaciones reales. Mismo criterio acá: **la interfaz refleja lo que las seis funcionalidades realmente necesitan, no lo máximo que un proveedor podría ofrecer.**

Las seis funcionalidades, miradas de cerca, son la misma operación repetida: *dado un prompt de sistema, un contexto y una pregunta, devolver texto.* Ninguna necesita streaming, ninguna necesita function-calling/tool-use del proveedor (la IA no ejecuta nada — restricción de dominio, sección 0), ninguna necesita gestión de sesión del lado del proveedor. Eso reduce la interfaz a **un solo método**:

```
interface AIProvider {
  completar(promptSistema: string, contexto: string, pregunta: string): Promise<string>
}
```

Una implementación concreta en V1 (`GeminiProvider` o `AnthropicProvider` — la elección puntual es secundaria frente a la decisión de "un tier de pago, sin entrenamiento", sección 3). El resto del sistema (los `ContextBuilder`, los procedures tRPC) depende de la interfaz `AIProvider`, nunca de la clase concreta — inversión de dependencia real, pero minúscula: cambiar de proveedor implica escribir una clase nueva de ~30-40 líneas que implementa el mismo método, no tocar ningún consumidor.

**Lo que esto deliberadamente NO incluye en V1** (evaluado y descartado, no simplemente omitido):
- Un *registry* de proveedores o selección dinámica en runtime — no hay una razón operativa para elegir proveedor por request con un solo proveedor contratado.
- *Routing* por costo/latencia entre proveedores — no hay un segundo proveedor activo que rutear entre sí.
- Reintentos/fallback automático a un proveedor secundario — con un admin, uso no crítico y bajo volumen, un error transitorio se resuelve con "reintentá la consulta", no con infraestructura de alta disponibilidad.

Este es exactamente el nivel de abstracción que la sección 1 pide: **suficiente para no reescribir todo si cambia el proveedor, insuficiente a propósito para todo lo que todavía no tiene un segundo caso real que lo justifique.**

---

## 8. Roadmap V1 / V2 / V3

| # | Funcionalidad | Versión | Por qué ahí |
|---|---|---|---|
| 1 | Explicar caída de CSR/MSR/PRR | **V1** | Dato ya existe completo hoy: `ANOMALIA_DETECTADA` de conversión + `embudoPorSetter`/`dashboardEjecutivo`. Cero proyecciones nuevas. |
| 2 | Top-3 acciones del día | **V1** | Dato ya existe completo hoy: `ANOMALIA_DETECTADA` de tiempo. Es priorización + fraseo, el caso de uso más directo de "razonamiento abierto sobre hechos ya calculados". |
| 3 | Resumen de objeciones | **V1** | Taxonomía cerrada ya trackeada (`OBJECION_REGISTRADA`, evento 6) desde el día 1. Es resumen de contenido existente, no inferencia. |
| 4 | Análisis de N leads | **V1** | Proyección por lead ya existe (`obtenerProyeccionesLote` y equivalentes en `lead.ts`/`event.ts`). Riesgo controlado si se acota `N` (sección 5). |
| 5 | Patrón de leads perdidos | **V2** | El dato existe HOY (`LEAD_DESCARTADO` con `motivo`), pero **detectar patrones no obvios necesita volumen** que recién se está empezando a generar (los datos reales de setters arrancan esta semana). No es una limitación técnica — es esperar a tener suficiente base para que "patrón" signifique algo y no ruido de N chico. Construir V1 primero también da señal de qué formato de respuesta le sirve al admin antes de invertir en esta, más ambiciosa. |
| 6 | Riesgo de no-show | **V1 (checklist) / V3 condicional (predicción real)** | Ver sección 9 — split explícito porque son dos features distintas disfrazadas de una. |

**V2**, además del punto 5: iterar prompts/formato de las cuatro de V1 con uso real, y recién ahí evaluar si vale versionar prompts (sección 11) — con evidencia, no de antemano.

**V3**: predicción real de no-show con un modelo entrenado (no un LLM — ver sección 9), y cualquier funcionalidad que dependa de tener **muchos meses de `LLAMADA_REGISTRADA`** con resultado real (`se_presento`), no solo de tener el evento definido.

### Nota aparte: por qué "no-show" es dos features, no una

Lo que el enunciado original pide ("predicción de no-show") es, tomado literalmente, un problema de **clasificación con features estructurados y una etiqueta histórica (`se_presento`)** — un problema clásico de ML supervisado, no un problema de LLM. Pedirle a un LLM que "prediga una probabilidad" sin un modelo entrenado detrás no es razonamiento, es fabricar una cifra con apariencia de precisión sin base estadística real — exactamente el tipo de alucinación que la sección 6 existe para evitar. Y a esta escala (Sprint 4 recién incorporó `LLAMADA_REGISTRADA` este trimestre; el volumen de llamadas con resultado registrado hoy es de decenas, no de cientos) **no hay ni remotamente los datos necesarios para entrenar nada**, y es una pregunta abierta si alguna vez los va a haber en una agencia de este tamaño.

Por eso se separa en dos:

- **V1 — checklist de riesgo explicado en lenguaje natural (esto SÍ es IA legítima ahora):** el motor de reglas ya sabe hechos objetivos ("este lead no respondió al último seguimiento antes de agendar", "confirmó el calendario recién a último momento", "tiene una objeción de tipo PRECIO sin resolver"). La IA toma esos hechos —ya calculados, no inventados— y los explica priorizados, sin emitir un número de probabilidad. Es la misma frontera de la sección 2: reglas calculan los hechos, IA los prioriza y los explica.
- **V3 — predicción real, condicional a volumen, posiblemente nunca:** si algún día hay suficiente `LLAMADA_REGISTRADA` con resultado como para entrenar algo confiable, ese "algo" probablemente sea un modelo estadístico liviano (regresión logística sobre pocos features), **no un LLM** — y el rol del LLM ahí pasaría a ser explicar el score en lenguaje natural, no generarlo. Vale nombrarlo en el roadmap para que quede explícito que se evaluó, no para comprometerse a construirlo.

---

## 9. Patrones de SaaS reales: qué aplica y qué es enterprise

| Producto | Patrón | ¿Aplica acá? |
|---|---|---|
| **HubSpot** | El pipeline (deals/stages) es la fuente de verdad determinista; la IA es una capa asistiva encima (resumir emails, sugerir respuestas) que nunca reemplaza el estado del pipeline. | **Sí, es literalmente la misma frontera de la sección 2** — el Event Log y las proyecciones son el equivalente del pipeline de HubSpot; la IA nunca toca el estado del embudo. |
| **Notion AI** | Resumen y Q&A sobre contenido existente (mayormente texto libre/no estructurado), sin inventar hechos que no estén en el documento. | **Parcialmente.** El principio de "resumir, no inventar" aplica directo (resumen de objeciones, sección 8 #3). Pero Notion AI opera sobre un corpus grande y no estructurado — necesita *retrieval* (embeddings/búsqueda semántica) porque el contenido no entra en un contexto. **OPERAL no tiene ese problema**: ~1.600 leads y ~11.000 eventos, ya estructurados, entran cómodos en un contexto acotado por consulta (sección 5). RAG/vector DB **no está justificado** — es la solución a un problema de escala que este sistema no tiene. |
| **Linear** | Triage/priorización asistida sobre issues, con el humano aprobando cada sugerencia — la IA nunca reasigna ni cierra un issue por su cuenta. | **Sí, mapea directo a "top-3 acciones del día"** (sección 8 #2) — mismo patrón de "sugerir prioridad, humano decide y ejecuta". |
| **Salesforce Einstein** | Modelos de ML **entrenados por tenant** (lead scoring, forecasting) sobre un *feature store* dedicado, con reentrenamiento continuo y una plataforma de MLOps completa detrás. | **No. Este es exactamente el ejemplo de lo que NO construir acá.** Einstein existe para clientes con volumen de datos y equipos de datos dedicados que este sistema no tiene ni va a tener a esta escala (single-tenant, ~1.600 leads, un ADMIN). Es la referencia negativa de la sección 11: nada de *feature store*, nada de modelos por tenant, nada de reentrenamiento automático. |

Conclusión general: los cuatro separan un **estado determinista y versionado** de una **capa generativa desacoplada** — validando que la frontera de la sección 2 no es una idea propia de este documento, es el patrón estándar de la industria. Lo que varía entre ellos es la escala de la infraestructura *alrededor* de esa frontera — y ahí es donde este documento elige deliberadamente el extremo liviano (HubSpot/Linear a escala pequeña), no el extremo Einstein.

---

## 10. SOLID/Clean/DDD: dónde aporta, dónde sería over-engineering

**Dónde aporta (y ya está reflejado en las secciones anteriores):**
- **Single Responsibility**: `ContextBuilder` (arma datos) / `AIProvider` (llama al modelo) / Validador (chequea la respuesta) / procedure tRPC (orquesta) son cuatro responsabilidades separadas y chicas — mismo patrón que ya usa `anomalia.ts` (funciones puras de detección separadas de la orquestación con DB, separadas del router).
- **Dependency Inversion**: los procedures dependen de la interfaz `AIProvider`, nunca de `GeminiProvider`/`AnthropicProvider` directamente — mismo patrón que `GoogleCalendarService.forConnection()` ya establece en este código.
- **Open/Closed en el sentido correcto**: agregar una séptima funcionalidad de IA es agregar un `ContextBuilder` nuevo, no modificar los existentes ni la interfaz `AIProvider`.

**Dónde sería over-engineering (evaluado y descartado explícitamente):**
- Un "dominio de IA" con value objects propios (`PromptContext`, `AIResponse` como clases con lógica) — acá son JSON planos y un string de respuesta; envolverlos en objetos de dominio no agrega ninguna regla de negocio real que proteger.
- *Repository pattern* para prompts — los prompts son constantes de código (mismo criterio que `anomaliaConfig.ts`), no entidades persistidas con ciclo de vida propio.
- Arquitectura hexagonal con múltiples adaptadores pre-construidos — un puerto (`AIProvider`) con un solo adaptador real es la inversión de dependencia sin la ceremonia; construir adaptadores para proveedores que no se van a usar todavía es diseñar para un requisito hipotético, exactamente lo que `CLAUDE.md` pide no hacer.
- CQRS o separación command/query más allá de lo que tRPC ya da gratis (`query` vs `mutation`) — no hay ninguna escritura en este módulo (es 100% lectura), así que no hay nada que separar.

---

## 11. Diferido a futuro (explícito, con motivo)

| Qué se difiere | Por qué no ahora |
|---|---|
| Selección dinámica de proveedor / *routing* multi-proveedor | No hay un segundo proveedor contratado — nada que rutear (sección 7). |
| Reintentos con fallback automático a proveedor secundario | Un solo admin, uso no crítico, bajo volumen — "reintentá la consulta" alcanza. |
| Versionado/A-B testing de prompts | Nadie usó ninguna funcionalidad de IA todavía — no hay evidencia de qué prompt funciona mejor para justificar la infraestructura de compararlos (sección 1). |
| Memoria de conversación / chat persistido entre sesiones | Cada consulta es autocontenida hoy; no hay un caso de uso de "seguir una conversación de ayer" identificado. |
| RAG / *embeddings* / base de datos vectorial | El volumen total (~1.600 leads, ~11.000 eventos) entra cómodo en un contexto acotado por consulta — RAG resuelve un problema de escala que este sistema no tiene (sección 9). |
| *Feature store* / modelo de ML entrenado para no-show | No hay volumen de `LLAMADA_REGISTRADA` con resultado para entrenar nada confiable, y es dudoso que algún día lo haya a esta escala (sección 8, nota de no-show). |
| Configuración de IA multi-tenant (API keys/prompts por cliente) | Sistema single-tenant por diseño (`08_modelo_de_datos.md`) — no aplica, no solo "todavía no". |
| *Caching* de respuestas | A la escala real (sección 5), el costo ya es marginal — cachear optimiza un problema que no existe. |
| Framework de agentes / *tool-use* autónomo (el modelo ejecutando acciones por su cuenta) | **No es un "todavía no" — es una exclusión permanente.** La restricción de que la IA es solo lectura y nunca actúa (sección 0) hace que un framework de agentes no tenga ningún caso de uso legítimo en este sistema, en ninguna versión futura, salvo que esa restricción de dominio cambie explícitamente — lo cual sería una decisión de negocio, no una decisión técnica de esta capa. |

---

*Este documento es la base de diseño para la capa de IA. Antes de escribir cualquier código: validar este documento con el dueño del producto, después (recién ahí) un plan técnico de implementación por commit, mismo flujo que se usó para el motor de reglas (`02_reglas_de_negocio (1).md` sección 9 → `03_catalogo_eventos.md` evento 14 → implementación).*
