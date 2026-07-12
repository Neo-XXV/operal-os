# Reglas de Negocio — OPERAL OS (V1)

Este documento define el comportamiento obligatorio del sistema. No son sugerencias: son restricciones que el sistema debe cumplir siempre. Si una implementación no puede cumplir una regla tal como está escrita, debe señalarse como contradicción en lugar de resolverse por inferencia.

## 1. Leads

- Un lead puede existir sin estar asignado a ningún setter.
- Un lead solo puede estar asignado a un setter a la vez.
- Un lead puede reasignarse a otro setter en cualquier momento (la agencia rota setters constantemente).
- Toda reasignación genera un evento `LEAD_ASIGNADO` (mismo evento que la primera asignación, con `setter_anterior` y `setter_nuevo` en el payload). Nunca se sobrescribe el setter anterior sin dejar registro.
- Un lead descartado no puede cambiar de estado ni reabrirse en la V1. (La reapertura queda fuera de alcance por ahora; si se necesita en el futuro, será una función explícita, no un efecto colateral de otra acción.)

## 2. Estados del embudo

Los estados válidos son, en este orden estricto:

```
A → MS → B → C → D
```

- **A**: primer mensaje enviado.
- **MS**: el lead respondió.
- **B**: se envió el pitch/propuesta.
- **C**: el setter agendó en el calendario.
- **D**: el lead confirmó el calendario.

### Reglas de transición

- ❌ No se puede saltar etapas. Todo lead que llegue a D debe haber pasado, en orden, por A, MS, B y C — incluso si las transiciones ocurren en un lapso muy corto de tiempo (por ejemplo, minutos).
- ❌ No se puede retroceder de etapa. Un lead nunca vuelve a un estado anterior. Si un lead deja de estar interesado o no responde, se cierra (ver sección 3) — no retrocede a un estado previo del embudo.
- ❌ Ningún evento histórico puede modificarse una vez creado (ver sección 4).

## 3. Cierre de leads

- Un lead se descarta cuando deja de avanzar en el embudo por cualquier motivo (sin respuesta tras el límite de seguimientos, no le interesa, no califica, duplicado, error de carga).
- El descarte es un evento (`LEAD_DESCARTADO`) con un campo `motivo` obligatorio, de una lista fija de opciones (no texto libre), para que sea analizable:
  - `SIN_RESPUESTA` (superó 4 seguimientos sin respuesta)
  - `RECHAZO_EXPLICITO` (el lead dijo que no le interesa)
  - `NO_CALIFICA`
  - `DUPLICADO`
  - `ERROR_CARGA`
- El límite de seguimientos antes de descartar por falta de respuesta es: el lead dice explícitamente que no le interesa, **o** se superan 4 seguimientos sin respuesta — lo que ocurra primero.

## 4. Eventos

- Todo evento es inmutable: una vez creado, no se edita ni se elimina.
- Todo evento tiene: timestamp, el lead al que pertenece, el usuario que lo generó, y los datos propios de ese tipo de evento.
- El estado actual visible de un lead nunca es un campo que se sobreescribe: es siempre la proyección/lectura del último evento relevante en el historial.
- Ningún KPI ni porcentaje se guarda como dato — todos se calculan a partir de los eventos, en el momento de consulta.

## 5. Seguimientos y respuestas

- Todo seguimiento enviado registra el número de intento (1º, 2º, 3º, 4º).
- Enviar un seguimiento no cambia automáticamente el estado del lead. El cambio de estado ocurre únicamente cuando corresponde según el flujo comercial real (ej: el lead respondió, se le mandó el pitch), nunca como efecto secundario de un seguimiento.
- El evento `RESPUESTA_RECIBIDA` registra que el lead escribió (una objeción, un "mañana te confirmo", una pregunta), sin implicar por sí mismo ningún cambio de estado. Igual que con los seguimientos, el cambio de etapa solo ocurre cuando corresponde según el flujo comercial real, nunca como efecto automático de este evento.

## 6. Principio de mínima carga para el setter

Toda acción manual que se le pida cargar a un setter debe responder que sí a al menos una de estas dos preguntas:

1. ¿Es imprescindible para que el lead avance en el embudo?
2. ¿Es un dato que el sistema no puede inferir automáticamente a partir de otros eventos?

Si la respuesta es no a ambas, esa acción no debe existir en la V1.

## 7. Fuera de alcance en V1

- No existe integración con el CRM de llamadas posterior a D. Después de que un lead llega a D, su gestión sale de OPERAL OS y la maneja el dueño del negocio manualmente. No hay evento de traspaso en esta versión.
- No existe el escenario de múltiples setters trabajando el mismo lead reciclado — el nicho actual es nuevo y la base de datos todavía no se recicla. Esta regla debe revisarse cuando eso empiece a ocurrir.
### Decisiones de arquitectura para versiones futuras
- OPERAL OS V1 es **single-tenant**. Toda la aplicación opera para una única clínica. El soporte para múltiples clínicas (multi-tenant) queda fuera del alcance de esta versión y se evaluará en una versión futura cuando exista esa necesidad.