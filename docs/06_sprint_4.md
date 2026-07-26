# 06 — Sprint 4 — OPERAL OS — CRM de Llamadas (Fase de Cierre)

> Etapa dentro del roadmap (`00_roadmap_producto.md`). Extiende el ciclo de vida del lead más allá de D (agendó), cubriendo la fase de venta que hasta ahora vivía fuera del sistema (`02_reglas_de_negocio.md` sección 7). Mismo criterio de disciplina: documentos contractuales, no inventar reglas de dominio, preguntar antes de asumir.

---

## Contexto y objetivo

Hasta el Sprint 3, OPERAL OS cubre el trabajo del **setter**: prospectar, conversar, y agendar la llamada (el embudo termina en D = agendó). Lo que pasa después —la llamada de venta— lo maneja otro equipo (los **administradores/closers de OPERAL**) y hoy vive en una planilla separada, fuera del sistema.

**Objetivo del Sprint 4: construir la fase de cierre dentro de OPERAL OS, sobre el mismo lead, para que el ciclo comercial completo —desde el primer mensaje hasta el trato cerrado— viva en un solo lugar.**

El setter entrega la agenda (D); el closer toma esa llamada y la lleva hasta la venta. Es un segundo mini-embudo, con su propio responsable, sus propios estados y sus propias métricas.

---

## Decisiones de dominio (confirmadas)

1. **Mismo lead, no un registro nuevo.** El closer trabaja sobre el lead que ya llegó a D. No se crea una entidad nueva — se le acumulan eventos de la fase de llamada. Es la continuación natural del ciclo de vida del lead en el Event Log.

2. **Responsable: rol ADMIN.** No se crea un rol "closer" nuevo. Los ADMIN de OPERAL manejan las llamadas. El sistema de roles no cambia.

3. **Hasta 3 llamadas por lead.** Un lead puede tener 1ra, 2da y 3ra call (con reagendas entre ellas). Tope de 3, no ilimitado.

4. **Datos sensibles solo para ADMIN.** Los montos de cierre, cash collected y grabaciones los ven únicamente los ADMIN. El SETTER no accede a esta información en este sprint. *(Nota futura: un dashboard del setter podría mostrarle que su lead cerró —el hecho, no el monto— como motivación. Fuera de alcance de este sprint.)*

5. **Métricas separadas del embudo del setter.** El dashboard de llamadas es independiente del dashboard del setter. El resultado de la llamada NO afecta las métricas del setter. Razón: cada rol responde por lo que controla — el setter por agendar (termina en D), el closer por cerrar (empieza en D). El Show Up Rate no es responsabilidad del setter.

---

## El mini-embudo de la llamada (estados nuevos, después de D)

Reconstruido de la planilla de llamadas real. Después de D (agendó), el lead entra a la fase de cierre:

- **Llamada agendada** (= D, la bisagra: el setter la dejó acá).
- **Se presentó / No se presentó** a la llamada.
- Si se presentó: **Calificó / No calificó** (¿el lead era apto para el procedimiento/oferta?).
- Si calificó: **Cerró / No cerró** (¿compró?).
- Si no se presentó o no cerró: posible **reagenda** → 2da call (mismo sub-flujo). Hasta 3 calls en total.

Cada llamada registra: fecha de la call, si se presentó, si calificaba, situación del lead, notas, autoevaluación del closer ("¿cómo te sentiste en la call? ¿qué podrías mejorar?"), y —si cerró— por cuánto cerró. Más la grabación (link).

**Decisión de modelado a resolver con Claude Code:** cómo se representan estos estados en el Event Log respetando el diseño existente (¿nuevos valores de ESTADO_CAMBIADO tras D? ¿un tipo de evento nuevo tipo LLAMADA_REGISTRADA con su payload? ¿una combinación?). Es una extensión del dominio y debe diseñarse con el mismo cuidado que el embudo original — ver "Trabajo de dominio" abajo.

---

## Campos por llamada (de la planilla real)

Por cada una de las hasta 3 llamadas:
- Número de contacto (identificación del lead)
- Día y fecha de la call → campo `fecha_call`, fecha sin hora (`"YYYY-MM-DD"`, hora local de Argentina), **distinta** del `timestamp` del evento (el ADMIN puede cargar el resultado días o meses después de que la llamada ocurrió). Los dashboards period-aware bucketean por `fecha_call`, no por `timestamp`.
- ¿Se presentó?
- ¿Calificaba?
- Situación del lead
- Notas
- Autoevaluación del closer (texto libre)
- Fuente / Setter (heredado del lead, ya existe)
- Por cuánto cerró (monto — solo si cerró) → entero en centavos + `moneda` obligatoria (único valor válido en V1: `"USD"`)
- Grabación (link)

---

## Métricas del dashboard de llamadas (solo ADMIN)

Dashboard propio, separado del embudo del setter:
- **Show Up Rate** (se presentaron / agendados)
- **Close Rate** = cerrados / calificados (Cierre/Califica — el KPI principal)
- **AOV (Call Efectiva)** = cash collected / llamadas efectivas (llamada efectiva = se concretó)
- **AOV (Trato Cerrado)** = cash collected / tratos cerrados
- **Clientes cerrados** (conteo)
- **Cash Collected** (total recaudado)
- **Llamadas totales / Llamadas calificadas**

Period-aware (mismo selector que el dashboard del Sprint 3).

---

## Trabajo de dominio (hacer PRIMERO, antes de la UI)

Agregar la fase de llamada toca la capa más protegida del sistema. Antes de construir UI:
- Definir cómo se modelan los estados/eventos de la fase de cierre en el Event Log.
- Actualizar `02_reglas_de_negocio.md`: la sección 7 ("después de D la gestión sale de OPERAL OS") ya no es cierta — ahora el sistema cubre la fase de cierre. Reescribirla.
- Actualizar `03_catalogo_eventos.md` con los eventos/valores nuevos.
- Actualizar `08_modelo_de_datos.md` si hace falta (montos, grabaciones — campos nuevos).
- Definir las reglas de transición de la fase de llamada (qué puede seguir a qué, tope de 3 calls).

---

## Fuera de alcance

- Rol "closer" separado → lo hace ADMIN, no se crea rol nuevo.
- Acceso del setter a datos de llamada → futuro (solo "cerró sí/no" como motivación, no ahora).
- Integración con herramientas de videollamada / grabación automática → las grabaciones son un link manual por ahora, no integración.
- Automatización de reagenda / recordatorios → posible futuro, no este sprint.
- Cobros / facturación reales (el "cash collected" se registra como dato, el sistema no procesa pagos) → V2.

---

## Datos sensibles — tratamiento

Este sprint introduce datos que el CRM del setter no tenía: **montos de dinero y grabaciones de llamadas.**
- Visibles solo para ADMIN (control de acceso por rol, estricto).
- Los montos son datos de negocio sensibles — no exponerlos en endpoints que un SETTER pueda consultar.
- Las grabaciones se guardan como link externo, no se suben al sistema (evita almacenamiento de contenido sensible).
- Considerar implicancias de privacidad de grabar y almacenar llamadas con clientes (consentimiento) — no es decisión técnica, pero dejar la nota.

---

## Criterio de cierre

El Sprint 4 se cierra cuando **un ADMIN puede gestionar el ciclo completo de una llamada desde OPERAL OS** —registrar si el lead se presentó, calificó, cerró y por cuánto, con hasta 3 reagendas— y **ver las métricas de cierre (Show Up, Close Rate, AOV, Cash Collected) en su propio dashboard**, todo sobre el mismo lead que el setter agendó, sin planillas externas.

---

## Nota sobre datos históricos

Los datos importados de Jorge llegan hasta D (agendó) — 4 leads. No tienen fase de llamada registrada (esa planilla es separada y no se importó). Si existe la planilla de llamadas histórica y se quiere importar, es un trabajo de migración aparte, análogo al del CRM del setter, a evaluar después de construir la fase.

---

## Decisiones de métricas (confirmadas)

- **Close Rate principal = Cierre/Califica** (cerrados / calificados). Mide qué tan bien cierra el closer sobre leads que sí eran aptos.
- **Llamada efectiva = una llamada que se concretó** (el lead se presentó y se hizo la llamada de venta, cerrara o no). NO es lo mismo que "cerrada".
- **Los dos AOV son distintos y ambos van:**
  - AOV (Call Efectiva) = cash collected / cantidad de llamadas efectivas. Valor promedio por llamada concretada (incluye las que no cerraron en el denominador).
  - AOV (Trato Cerrado) = cash collected / cantidad de tratos cerrados. Valor promedio por cierre.
- **Reagendas secuenciales, hasta 3 calls encadenadas.** No hay 2da call sin 1ra, ni 3ra sin 2da. Cada call es un registro propio con su fecha y resultado (una reagenda ocurre porque no se presentó / no cerró la anterior).
- **Monto: dos campos separados.** "Por cuánto cerró" (total del trato, `monto_cierre` en `LLAMADA_REGISTRADA`) y "cash collected" (cobrado hasta ahora) pueden diferir, porque hay planes de pago y pay-in-full. Cash collected **no se guarda como campo**: es la suma de los eventos `PAGO_REGISTRADO` de ese lead (cada uno con su propio `monto` y `fecha_pago`) — puede crecer en el tiempo si es plan de pagos, sin editar ningún evento existente.
- **Todos los montos son enteros en centavos, nunca decimales** (el payload es JSON; los floats rompen la suma de cash collected), y llevan `moneda` obligatoria — único valor válido en V1: `"USD"`. Sin conversión ni multi-moneda en esta versión.
- **Toda fecha de negocio (`fecha_call`, `fecha_pago`) es un string `"YYYY-MM-DD"` sin hora, en hora local de Argentina — nunca el `timestamp` del evento.** El `timestamp` es cuándo el ADMIN cargó el dato; la fecha de negocio es cuándo ocurrió realmente. Los dashboards period-aware de este sprint bucketean por la fecha de negocio.

## Fuera de alcance de este sprint (confirmado)

- **Comisiones del setter.** El setter cobra el 100% de su comisión sin importar el tipo de pago del cliente, pero esto es solo contexto — trackear/calcular comisiones NO es parte de este sprint. Sería un módulo aparte a futuro.

## Preguntas de modelado a resolver con Claude Code (técnicas, no de negocio)

- **Modelado en el Event Log:** ¿nuevos estados post-D, evento nuevo LLAMADA_REGISTRADA, o combinación? Decisión de dominio, resolver primero con Claude Code antes de la UI.
- **Cómo se representan las 3 calls encadenadas** en el Event Log (un evento por call con su número, respetando el tope de 3 y la secuencialidad).
