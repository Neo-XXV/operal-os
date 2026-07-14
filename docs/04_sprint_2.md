# 04 — Sprint 2 — OPERAL OS

> **Nota de proceso:** este alcance se construyó sobre una (1) entrevista de setter + el CRM real del equipo. La segunda entrevista prevista no llegó a completarse y se decidió avanzar sin esperarla. Si algo del comportamiento real de los setters no coincide con lo asumido acá, revisar esta decisión antes de invertir más en la misma dirección.

---

## Visión

Cada acción que registra un setter debe transformarse automáticamente en inteligencia comercial para mejorar la estructura de conversación.

Esta frase no habla de tablas, ni de eventos, ni de KPIs. Habla del propósito. Ante cualquier funcionalidad nueva, la pregunta que decide si pertenece al producto es: **¿esta funcionalidad ayuda a convertir acciones del setter en inteligencia comercial?** Si la respuesta es no, probablemente no pertenece a OPERAL OS.

---

## Objetivo

Fusionar en una sola herramienta dos cosas que hoy viven separadas: el **CRM** (donde el setter carga su trabajo) y las **métricas de conversión** (donde se diagnostica qué parte de la estructura de conversación falla).

Hoy el setter carga en un lado (Google Sheets) y el diagnóstico se arma en otro, con trabajo manual en el medio. OPERAL OS los une: **el mismo acto de registro del setter genera la métrica automáticamente.**

El fin concreto: que el dueño pueda *ver* dónde se caen los leads entre etapas —con foco en el cuello de botella actual, que es el agendamiento— con datos reales, no con intuición.

---

## Problema que resolvemos

El mayor cuello de botella del negocio hoy no es conseguir leads ni iniciar conversaciones: es que **los leads no llegan a agendar.** Avanzan hasta cierta etapa y se caen antes de la agenda.

Para arreglar eso hay que saber *en qué transición exacta* se caen. Esa información existe en teoría (el Event Log del Sprint 1 la guarda), pero hoy no es visible ni utilizable, porque:

1. Cargar el trabajo en el CRM es lento y tedioso (el setter dedica ~la mitad de su jornada a cargar/ordenar información, no a conversar). El dolor puntual está en registrar seguimientos y fechas a mano.
2. Aunque los datos estuvieran cargados, no hay ninguna vista que los convierta en diagnóstico de conversión por etapa.

Datos con fricción → carga incompleta o imprecisa → métricas poco confiables. Por eso la carga cómoda no es un lujo: es el prerequisito de que el diagnóstico sirva.

---

## Cómo trabaja hoy un setter

Reconstruido de la entrevista y del CRM real:

- Tiene abiertos en paralelo: Instagram, WhatsApp, Google Sheets (el CRM), Google Docs (SOPs y calificación).
- Recibe una base de contactos. Los califica manualmente (documento de 7 criterios). A los que pasan, los prospecta (primer mensaje en Instagram) y **recién ahí** los registra en el CRM.
- Copia y pega usernames y links de la base al CRM, y estructuras de conversación de los Docs a los chats de Instagram.
- Marca en el CRM, a mano y por colores, la etapa de cada lead, los seguimientos y las fechas.
- Sabe a quién seguir mirando esos colores y etapas.
- Al final del día arma un reporte diario (1–5 min).

Frecuencia de acciones en el día, de mayor a menor:
1. **Iniciar conversación** (lo más frecuente — ~30/día).
2. **Registrar seguimientos** a los que no respondieron.
3. **Descartar** un lead.
4. **Avanzar de etapa** (lo menos frecuente — y es justo lo que acerca a la agenda).

---

## Cómo debería trabajar después de este sprint

El setter deja de mantener el Google Sheet y trabaja sobre una **tabla dentro de OPERAL OS**, donde las columnas de estado, número de seguimientos y fechas **se rellenan solas** desde el Event Log — nunca las tipea. Sigue conversando en Instagram; lo que cambia es que el *registro* pasa a ser casi sin fricción.

El dueño, sin que nadie cargue un KPI a mano, ve una **vista de embudo** que muestra la conversión entre cada etapa (MSR, PRR, CSR, ABR) y dónde está el tapón.

---

## Alcance

**0. Vista principal del setter.**
Al ingresar, el setter ve únicamente sus leads asignados — nunca la base completa de otros setters. La tabla (punto 1) es el centro operativo, no una pantalla secundaria a la que se llega navegando. Debe permitir buscar un lead rápido y filtrar por etapa. *(Filtros como "requiere seguimiento" o "sin actividad hoy" quedan fuera de este sprint hasta definir la regla de negocio que los sustenta — ver Preguntas abiertas.)*

**1. Tabla de carga rápida (el CRM operativo).**
Vista tipo planilla, una fila por lead, columnas derivadas del Event Log. Optimizada por frecuencia de uso:

- **Iniciar conversación (máxima prioridad):** pegar username → Enter → el lead nace en estado A (dispara `LEAD_CREADO` + `LEAD_ASIGNADO` + `ESTADO_CAMBIADO` null→A, como en el Sprint 1). Sin modales, sin formularios, sin elegir estado. Pensado para repetirlo ~30 veces seguidas como quien carga una lista.
- **Registrar seguimiento:** ver de un vistazo quién no respondió y marcar seguimiento, con **selección múltiple / edición en lote** para varios de una. El número de seguimiento se incrementa solo (se cuenta de los eventos).
- **Descartar:** acción por fila que pide motivo de la lista fija y cierra el lead.
- **Avanzar de etapa:** control por fila para mover al siguiente estado, respetando las reglas de transición del Sprint 1 (no saltar, no retroceder). La edición en lote debe respetar estas validaciones.

Columnas de la tabla — cuáles son editables y cuáles derivadas (a confirmar con el CRM real al construir, ver Preguntas abiertas):

| Columna | Fuente |
|---|---|
| Nombre | Editable |
| Instagram | Editable |
| Estado | Event Log (último `ESTADO_CAMBIADO`) |
| Seguimientos | Event Log (conteo de `SEGUIMIENTO_ENVIADO`) |
| Último contacto | Event Log (timestamp del último evento) |
| Responsable | Event Log (último `LEAD_ASIGNADO`) |
| Última nota | Event Log (último `NOTA_AGREGADA`) |

**Ninguna columna derivada puede editarse manualmente.** Es la misma regla del modelo de datos del Sprint 1 (proyecciones nunca son fuente de verdad) aplicada a la UI — evita que se agreguen campos editables donde el dato ya existe calculado.

**2. Vista de embudo con conversión por etapa.**
Cálculo de MSR (A→MS), PRR (MS→B), CSR (B→C), ABR (C→D) desde el Event Log, mostrando en qué transición se caen los leads. Lo mínimo para identificar el cuello de botella de agendamiento con datos reales. No es el dashboard completo con IA — es la lectura de embudo básica.

**Orden de construcción dentro del sprint:** primero la tabla, después el embudo. El embudo necesita datos reales cargados para poder validarse; probarlo con leads de prueba no sirve.

---

## Principios de UX

Criterio para decidir entre dos implementaciones cuando el resto del documento no lo resuelve:

- La interfaz prioriza velocidad de operación sobre riqueza visual.
- Toda acción repetitiva se resuelve con la menor cantidad posible de clics.
- La tabla debe resultar familiar para cualquier setter acostumbrado a Google Sheets — no reinventar la interacción.
- Nunca pedir información que pueda derivarse del Event Log.
- La navegación minimiza la apertura de pantallas o modales secundarios.

---

## Fuera de alcance

- IA (redacción automática de reportes, detección de anomalías, diagnóstico narrado).
- Automatización o integración de mensajería (bandeja unificada tipo Inflowave, API de Instagram/WhatsApp). El setter sigue conversando en Instagram.
- Importación masiva de leads / sincronización con Google Sheets.
- Calificación automática de leads (filtro de los 7 criterios antes de que lleguen al setter).
- Dashboard completo, KPIs avanzados, reportes automáticos.
- Cualquier estado previo a A o entidad de "contacto pendiente" (ver Decisiones de dominio).

---

## Decisiones de dominio (confirmadas, no reabrir en este sprint)

- **No existe estado previo a A ni entidad de contacto pendiente.** Registrar un lead = la gestión ya comenzó. Que el primer mensaje se haya enviado unos segundos antes o después del registro no genera una decisión distinta en el sistema, así que no se modela. Además, un estado previo contaminaría el MSR (A→MS) con leads nunca contactados, ensuciando justo la métrica que el producto existe para leer.
- **Los errores de carga se corrigen descartando, no borrando** (motivo `ERROR_CARGA`, ya existente), porque el Event Log es inmutable. Es la contracara aceptada de la velocidad de carga.
- La conversación vive en Instagram, no en OPERAL OS. El sistema registra el trabajo, no lo aloja.

---

## Criterio de cierre

El Sprint 2 **no se cierra cuando el código compila. Se cierra cuando un setter decide dejar de usar Google Sheets durante su jornada laboral** — es decir, cuando la adopción real ocurre, no cuando la funcionalidad existe.

Concretamente:

1. Un setter usa la tabla en su jornada real durante unos días y registra su trabajo ahí (no vuelve al Sheet).
2. Con esos datos reales, la vista de embudo muestra la conversión por etapa y permite identificar el cuello de botella de agendamiento.

No construir "el CRM definitivo" en este sprint — construir el CRM mínimo que ya permita abandonar Google Sheets. Si eso se logra, el objetivo del producto está cumplido y todo lo demás (integraciones, IA, dashboards avanzados) tiene una base sólida sobre la cual crecer.

---

## Preguntas abiertas (resolver antes o durante el sprint)

- **Segunda entrevista de setter:** confirmar que el dolor (registro de seguimientos) y la disposición a abandonar el Sheet son compartidos, no de una sola persona.
- **Confirmar la tabla de columnas** contra el CRM real al construir. Confirmar que no hay columnas de juicio humano que preservar. *(Según lo relevado, el CRM es todo dato duro orientado a métricas — sin columnas de criterio subjetivo.)*
- **¿Qué significa "requiere seguimiento" o "sin actividad hoy"?** Antes de construir esos filtros hace falta una regla de negocio explícita (¿cuántas horas/días sin contacto, según qué etapa?). No inventar esta regla durante la implementación — definirla acá primero.
- **Adopción:** ¿los setters actuales aceptan dejar el Sheet, o conviene estrenar OPERAL OS con equipo nuevo que no arrastre la costumbre?
- **Nota sobre las entrevistas:** la primera entrevista es de un setter con una semana de antigüedad; Jorge (segunda entrevista) es el Setter Manager con ~2 meses de práctica y el CRM que él mismo diseñó. La disparidad de fricción reportada responde a la diferencia de experiencia, no a que el problema no exista — Jorge no tiene el dolor porque ya pasó la curva de aprendizaje, no porque el CRM en Sheets no la tenga. El objetivo del producto es que un setter nuevo llegue al nivel de organización de Jorge sin necesitar dos meses de rodaje. Considerar una tercera entrevista a un setter de antigüedad intermedia antes de dar el diagnóstico por cerrado del todo.

---

## Deuda técnica arrastrada (no se toca en este sprint salvo que estorbe)

- Listas cerradas (objeciones, motivos de descarte) duplicadas en backend / frontend / doc sin fuente única. Riesgo de drift.
- Regla "primer estado = A" escrita en dos lugares (`validarTransicion` y el insert de creación).
- Ver `99_deuda_tecnica.md` para la deuda de dependencias (esbuild / drizzle-kit).
