# Prompt Maestro — OPERAL OS

Vas a construir OPERAL OS. Antes de escribir una sola línea de código, leé completos los siguientes documentos, que son la única fuente de verdad del proyecto:

- `01_dia_en_la_vida_del_setter.md` — contexto y flujo real de trabajo.
- `02_reglas_de_negocio.md` — restricciones obligatorias del sistema.
- `03_catalogo_eventos.md` — qué eventos existen y su estructura exacta.
- `08_modelo_de_datos.md` — entidades, relaciones y principio de fuente de verdad.

## Reglas de comportamiento durante todo el desarrollo

1. **Los documentos son contractuales.** El código debe adaptarse a los documentos, nunca los documentos al código. Si durante la implementación detectás una limitación técnica, informala y proponé alternativas, pero no modifiques el comportamiento definido sin aprobación.

2. **No agregues comportamiento que no esté especificado en los documentos.** Esto incluye validaciones, automatizaciones, botones, reglas, estados, eventos y procesos — no solo pantallas o funcionalidades obvias. Si tenés una sugerencia, proponela como pregunta, no la implementes por iniciativa propia.

3. **No simplifiques el modelo de dominio para facilitar la implementación.** Si una solución más simple cambia el comportamiento definido, proponela como alternativa, pero no la implementes sin aprobación.

4. **El Event Log es la única fuente de verdad.** Ninguna optimización de rendimiento puede convertir una proyección en la fuente de verdad. Si necesitás crear vistas, cachés o tablas derivadas por rendimiento, deben poder reconstruirse completamente a partir de los eventos.

5. **Las decisiones técnicas son libres** (framework, estructura de carpetas, nombres internos, librerías, patrones de diseño), siempre que no contradigan el comportamiento definido por los documentos funcionales.

6. **Si encontrás una contradicción** entre documentos, o entre lo que te pido y lo que dicen los documentos, preguntá antes de resolver por inferencia. Nunca asumas cuál interpretación es la correcta. Si dos documentos se contradicen entre sí, el orden de precedencia es: `02` (reglas de negocio) > `03` (catálogo de eventos) > `08` (modelo de datos) > `01` (contexto, no autoritativo para reglas). Aun con ese orden, avisame que encontraste la contradicción — no la resuelvas en silencio.

7. **Si falta información** para tomar una decisión (de interfaz, de UX, de nombres), preguntame en vez de decidir por tu cuenta. Documentos de flujos de usuario o componentes de UI todavía no existen — los vamos a construir juntos más adelante, no los inventes ahora.

8. **Trabajamos por sprints.** Podés construir la infraestructura técnica necesaria para el sprint actual (autenticación, migraciones, configuración base del proyecto, layout mínimo), pero no agregues funcionalidades de negocio fuera del alcance definido para ese sprint.

9. **Ante cualquier duda, priorizá preservar la consistencia del modelo de dominio por encima de la velocidad de implementación.** Es preferible detener el desarrollo para hacer una pregunta que introducir un comportamiento no definido.

10. Cualquier decisión que tomemos juntos durante el desarrollo y que no esté en los documentos originales, avisame para que la incorporemos al documento correspondiente — no la dejes solo en el código.

## Sprint 1 (alcance de esta primera etapa)

- Login
- Usuarios
- Crear Lead
- Event Log funcionando (según `03_catalogo_eventos.md` y `08_modelo_de_datos.md`)

No construyas funcionalidades de negocio fuera de este alcance todavía.
