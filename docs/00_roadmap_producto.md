# 00 — Roadmap de Producto — OPERAL OS

Este es el documento maestro del producto. No habla de código ni de tareas: define la visión, el orden en que se construye, y qué queda dentro y fuera de la versión 1.0. Los documentos de cada sprint (`04_sprint_2.md`, `05_sprint_3.md`, etc.) son etapas dentro de este mapa.

---

## Visión

**Cada acción que registra un setter se transforma automáticamente en inteligencia comercial para mejorar la estructura de conversación.**

OPERAL OS no es un CRM que almacena contactos. Es un sistema operativo comercial: convierte el trabajo diario del equipo en información que permite dirigir el negocio y tomar mejores decisiones.

Ante cualquier funcionalidad nueva, la pregunta que decide si pertenece al producto es: **¿ayuda a convertir acciones del setter en inteligencia comercial, o a operar/dirigir mejor la agencia?** Si no, no entra.

---

## Decisión estratégica de la V1 (congelada — no reabrir durante el desarrollo)

**OPERAL OS V1 es un producto interno para OPERAL. Single-tenant.**

El objetivo de la versión 1.0 no es construir un SaaS para múltiples empresas, sino resolver por completo la operación comercial de la agencia y consolidar un sistema estable sobre datos reales. Se priorizan la simplicidad del dominio, la velocidad de desarrollo y la calidad del producto por encima de la escalabilidad multiempresa.

La arquitectura **multi-tenant queda explícitamente fuera de la V1** y será evaluada como el gran cambio arquitectónico de la V2, únicamente cuando el sistema haya demostrado funcionar de manera consistente dentro de OPERAL.

**Criterio para aceptar o rechazar cualquier idea durante la V1:**
- ¿Hace que OPERAL funcione mejor dentro de nuestra agencia? → entra al roadmap de la V1.
- ¿Sirve para venderlo a otras empresas algún día? → es V2.

Esta decisión libera al desarrollo de toda la complejidad de aislamiento entre empresas, permisos entre organizaciones, facturación, onboarding de clientes y organizaciones. Nada de eso existe en la V1: existe una sola organización.

---

## Principio rector del desarrollo

Cada sprint debe dejar el sistema **completamente funcional y coherente**.

No se agregan funcionalidades que dependan de sprints futuros para tener sentido. Cada capa aporta valor por sí misma y sirve de base estable para la siguiente.

---

## Las capas del producto

El producto se construye en capas, cada una habilitada por la anterior:

```
CAPA 1 — Dominio          (el lenguaje del sistema)
   ↓
CAPA 2 — Operación        (el setter trabaja acá)
   ↓
CAPA 3 — Dirección        (el dueño dirige desde acá)
   ↓
CAPA 4 — Ecosistema       (conexión con el mundo externo)
   ↓
CAPA 5 — Inteligencia     (interpretación automática)
   ↓
CAPA 6 — Plataforma       (lo transversal: seguridad, deploy, pulido)
```

---

### ✅ Sprint 1 — Dominio (terminado, tag `sprint-1`)

Construye el modelo del negocio: el lenguaje sobre el que todo lo demás existe.

Usuarios · Leads · Eventos · Reglas de negocio · Event Sourcing · Estados del embudo · Descarte · Roles.

Sin esto nada existe. **Fuente de verdad: el Event Log.**

---

### ✅ Sprint 2 — Operación (terminado, tag `sprint-2`)

**Objetivo: que el setter abandone Google Sheets y que cada acción genere métricas automáticamente.**

Tabla de carga rápida (CRM operativo) · Acciones rápidas (iniciar, seguir, descartar, avanzar) · Columnas derivadas del Event Log · Embudo básico con conversión por etapa (MSR/PRR/CSR/ABR).

Ver `04_sprint_2.md`. *(Pendiente: validación con setter real usándolo en su jornada.)*

---

### 🔜 Sprint 3 — Dirección Comercial (próximo)

**Objetivo: que el dueño pueda dirigir toda la operación comercial únicamente desde OPERAL OS, sin planillas externas.**

Si el Sprint 2 permite *operar* el negocio, el Sprint 3 permite *dirigirlo*.

- Dashboard ejecutivo completo.
- KPIs históricos.
- Comparación por período.
- Comparación por setter.
- Comparación por origen del lead.
- Gestión y reasignación de setters.
- Objetivos individuales y globales.
- Reportes.
- Alertas operativas.
- Analytics.

Depende de: Sprint 2 (necesita datos de operación reales para tener qué mostrar).

---

### Sprint 4 — Ecosistema

**Objetivo: que OPERAL OS deje de depender de herramientas externas para intercambiar información.**

Google Sheets (si se decide) · Calendarios (Calendly) · APIs · Importaciones · Exportaciones · Webhooks · Automatizaciones (n8n / Make).

Depende de: Sprints 2 y 3 (el modelo de datos y las métricas ya estables).

---

### Sprint 5 — Inteligencia Comercial

**Objetivo: que OPERAL OS no solo muestre información, sino que ayude a interpretarla.**

Recién acá aparece la IA — analítica, no conversacional — porque ahora ya existe suficiente información acumulada.

Detección de anomalías · Insights · Diagnósticos automáticos · Comparación automática de estructuras de conversación · Impacto de cambios · Recomendaciones · Reportes narrados.

Depende de: Sprints 3 y 4 (necesita volumen de datos histórico y limpio).

---

### Sprint 6 — Plataforma

**Objetivo: dejar el sistema listo para uso sostenido y confiable.**

Todo lo transversal: Seguridad · Optimización / Performance · Auditoría · Configuración · Backups · Deploy · Observabilidad · Responsive · Pulido general de UX.

---

## Fuera de la V1.0 (explícito)

- **Multi-tenant / multiempresa** → V2, es el gran cambio arquitectónico posterior.
- **Facturación, onboarding de clientes, gestión de organizaciones** → V2 (dependen de multi-tenant).
- **IA conversacional / chatbot** → OPERAL OS usa IA analítica, no conversacional.
- **Automatización de mensajería / bandeja unificada** (envío de mensajes desde el sistema, API de Instagram/WhatsApp) → a evaluar, no forma parte del núcleo de la V1.

---

## Decisión pendiente antes del Sprint 4

Antes de arrancar el Sprint 4 (Ecosistema), confirmar si finalmente se integra Google Sheets o no — quedó como pregunta abierta desde el diseño del Sprint 2. Esa decisión define buena parte del alcance del Sprint 4.
