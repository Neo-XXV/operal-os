# 05 — Sprint 3 — OPERAL OS

> Etapa dentro del roadmap (`00_roadmap_producto.md`), Capa 3 — Dirección. Si el Sprint 2 permite **operar** el negocio, el Sprint 3 permite **dirigirlo**. Mismo criterio de disciplina que los sprints anteriores: los documentos son contractuales (precedencia 02 > 03 > 08 > 01 > 05), no inventar reglas, preguntar antes de inferir.

---

## Visión (heredada del roadmap)

Cada acción que registra un setter se transforma automáticamente en inteligencia comercial. El Sprint 2 capturó esas acciones; el Sprint 3 las convierte en las herramientas que el dueño necesita para dirigir la operación.

---

## Objetivo

**Que el dueño pueda dirigir toda la operación comercial únicamente desde OPERAL OS, sin depender de planillas externas.**

El Sprint 2 le dio al setter una tabla para operar. El Sprint 3 le da al dueño una capa de dirección: ver el rendimiento histórico, comparar, gestionar el equipo, y detectar dónde intervenir — todo derivado del Event Log, sin carga manual de KPIs.

---

## Problema que resolvemos

Hoy, con el Sprint 2, el dueño puede ver el embudo básico (conversión por etapa, agregado, sobre todo el historial). Eso responde "¿dónde se caen los leads?" en general, pero no responde las preguntas que un dueño necesita para dirigir:

- ¿Mejoró o empeoró esta semana respecto a la anterior?
- ¿El problema de agendamiento es de todo el equipo o de un setter en particular?
- ¿Qué origen de lead convierte mejor?
- ¿Quién necesita ayuda y quién está rindiendo?
- ¿Estamos cerca o lejos de los objetivos?

Sin esto, el dueño sigue necesitando armar comparativas a mano fuera del sistema — exactamente la dependencia de planillas externas que el producto busca eliminar, ahora en la capa de dirección en vez de la de operación.

---

## Alcance

**1. Dashboard ejecutivo.**
La vista principal del dueño (rol ADMIN) al ingresar. Reúne, derivado del Event Log:
- Embudo con conversión por etapa (ya existe del Sprint 2 — se integra acá, no se rehace).
- KPIs clave del período seleccionado (leads nuevos, activos, descartados, agendados, tasas MSR/PRR/CSR/ABR).
- Indicadores de tendencia respecto al período anterior.
- **Resaltado de la transición más débil y su tendencia.** No todas las tasas se muestran igual: el dashboard destaca la conversión más floja (hoy, con datos reales, es B→C, cayendo hacia 0%) y muestra si mejora o empeora en el tiempo. Un 3% estable y un 10%→0% en caída son problemas distintos; la tendencia importa tanto como el número. Este es el corazón del valor del dashboard: hacer imposible ignorar dónde se pierde la plata.

**2. KPIs históricos y comparación por período.**
Ver la evolución de las métricas en el tiempo y comparar períodos. **El dashboard tiene un selector de período flexible** — lifetime, mensual, trimestral, semestral, anual (o rango elegido). El cálculo se actualiza día a día: cada evento del Event Log tiene su timestamp, así que cualquier ventana temporal se calcula filtrando y agregando eventos. Responde "¿estamos mejorando?".

**3. Comparación por setter.**
Desglose de las métricas de conversión por cada setter, para identificar quién convierte mejor en cada etapa y dónde cada uno se traba. El evento `LEAD_ASIGNADO` ya habilita esto (está previsto en `03_catalogo_eventos.md`).

**4. Comparación por origen del lead.**
Desglose por `origen` (SCRAPING / MANUAL / RPP, ya en el payload de `LEAD_CREADO`). Responde "¿qué fuente convierte mejor?".

**5. Gestión y reasignación de setters.**
Interfaz para que el ADMIN vea el equipo, y reasigne leads entre setters. El endpoint `lead.assign` ya existe desde el Sprint 1 (con la regla de no reasignar descartados) pero no tiene UI — acá se expone. Incluye alta/gestión de usuarios setter si hace falta consolidarla.

**6. Objetivos (individuales y globales).**
Metas de rendimiento (ej: X agendas por semana, por setter o para el equipo) con avance visible en el dashboard. **Los objetivos se derivan del promedio histórico** — el sistema calcula la meta a partir del rendimiento pasado, no se cargan a mano. (Evaluar si el dueño puede ajustarlos manualmente sobre el valor sugerido.)

**7. Reportes.**
Generar un resumen del período (métricas + comparativas) que el dueño pueda revisar o exportar. *(La redacción narrada automática por IA es Sprint 5 — acá es un reporte de datos, no interpretado.)*

**8. Alertas operativas.**
Señales visibles cuando una métrica cae respecto al período anterior o un setter queda por debajo de su objetivo. *(Detección de anomalías por IA es Sprint 5 — acá son reglas simples y explícitas, ej: "CSR cayó más de X% vs. semana pasada".)*

---

## Fuera de alcance

- IA / diagnóstico narrado / detección de anomalías inteligente → Sprint 5. Las alertas de este sprint son reglas simples, no IA.
- Integraciones externas (Google Sheets, Calendly, exportación a formatos externos vía API) → Sprint 4.
- Multi-tenant / comparación entre organizaciones → V2.
- Automatización de acciones (que el sistema reasigne o alerte solo sin intervención) → a evaluar en sprints posteriores.

---

## Decisiones ya resueltas

- **Período:** selector flexible (lifetime / mensual / trimestral / semestral / anual / rango). Cálculo día a día sobre el Event Log.
- **Objetivos:** derivados del promedio histórico, no cargados a mano.
- **Foco del dashboard:** resaltar la transición más débil y su tendencia en el tiempo (hoy, B→C).

## Decisiones a resolver durante el sprint

- **Reglas de alerta (punto 8):** ¿qué umbral dispara una alerta? (ej: caída de X% en una tasa vs. período anterior, setter por debajo de Y% del objetivo). Definir explícitamente — no inventar durante la implementación.
- **Objetivos ajustables:** ¿el dueño puede editar manualmente el objetivo sugerido por el promedio histórico, o es fijo?
- **Diseño visual del dashboard:** referencia visual disponible (imágenes de estilo). Evaluar usar un modelo con capacidad de visión para ajustar el diseño contra la referencia.

## Nota técnica (tener en el radar desde el diseño, no es bloqueo)

Un selector de período que recalcula el embudo completo sobre todo el Event Log en cada consulta puede volverse lento con mucho histórico (especialmente la vista "lifetime"). No es problema con el volumen actual, pero conviene diseñarlo previendo proyecciones pre-calculadas o vistas materializadas —ya contempladas en `08_modelo_de_datos.md`— antes de que el volumen lo exija. La fuente de verdad sigue siendo el Event Log; las proyecciones son solo optimización.

---

## Principio rector (heredado del roadmap)

Este sprint debe dejar el sistema completamente funcional y coherente. El dashboard y las herramientas de dirección deben aportar valor por sí mismos, sin depender de la IA del Sprint 5 ni de las integraciones del Sprint 4 para tener sentido.

---

## Criterio de cierre

El Sprint 3 se cierra cuando **el dueño puede responder, únicamente desde OPERAL OS y sin planillas externas:** dónde está el cuello de botella, si el equipo mejora o empeora, qué setter y qué origen rinden mejor, y cuán cerca está de sus objetivos. Validado con datos reales de operación acumulados (idealmente los del Sprint 2 ya en uso).

---

## Orden de construcción sugerido

1. Dashboard ejecutivo + KPIs del período (base sobre la que todo se apoya).
2. Histórico y comparación por período.
3. Desgloses (por setter, por origen).
4. Gestión/reasignación de setters (expone endpoint ya existente).
5. Objetivos.
6. Reportes y alertas (dependen de que los puntos anteriores existan).
