# Deuda técnica conocida

## Dependencias

### esbuild (vulnerabilidad moderada)

Origen:
- Dependencia transitiva de drizzle-kit.

Impacto:
- Solo afecta el entorno de desarrollo (dev server).
- No afecta producción.

Decisión:
- No ejecutar `npm audit fix --force`.
- Esperar una actualización compatible de drizzle-kit antes de corregir.

Estado:
Pendiente.

### `/usuarios` sin guard de ruta (frontend)

Origen:
- Investigación de rutas hecha al planificar la Fase 5 del Sprint 4 (pantallas de la fase de llamada). Ninguna ruta del frontend tiene guard propio hoy — `/usuarios` (solo-admin en espíritu) se protege únicamente ocultando el link del nav para `SETTER`; la página en sí (`Usuarios.tsx`) no chequea rol ni redirige.

Impacto:
- Un `SETTER` que tipee `/usuarios` en la barra de direcciones ve la pantalla renderizada (aunque vacía/no funcional, ya que las queries y mutaciones del backend rechazan su rol). No hay fuga de datos — el backend es la barrera real — pero es una superficie que no debería ni mostrarse.

Decisión:
- No se corrige ahora: fuera del alcance del Sprint 4. La Fase 5 de este sprint sí agrega guard de ruta inline (patrón `Dashboard.tsx`) a la pantalla nueva `/llamadas`, pero no se retrofittea `/usuarios` de paso — cambio aislado, a resolver aparte.

Estado:
Pendiente.

## Datos

### Lead de prueba no borrable en la base real (id 1637)

Origen:
- Verificación de la Fase 3 del Sprint 4 (fase de llamada) contra la base real. El lead `"TEST SPRINT4 - Lead1 Cierre"` se llevó deliberadamente hasta `LLAMADA_REGISTRADA` con `cerro=true` para probar el bloqueo terminal post-cierre.

Impacto:
- Al quedar cerrado, el lead no puede descartarse ni recibir eventos comerciales nuevos (regla terminal, mismo principio que `LEAD_DESCARTADO`) — es la prueba en vivo de que esa regla funciona, no un error. Un conteo o dashboard que sume "clientes cerrados" / "cash collected" sobre la base real va a incluir este lead (tiene 2 `PAGO_REGISTRADO` de prueba, USD 2.500 total).
- Tiene una `NOTA_AGREGADA` dejando constancia de que es dato de prueba, visible en su timeline.

Decisión:
- No se borra: el Event Log es inmutable, y hacer una excepción "solo por esta vez" para limpieza de datos de prueba rompe el invariante que se está probando. Se documenta acá en su lugar.

Estado:
Permanente — no hay acción pendiente. Si en el futuro se construye un filtro "excluir datos de prueba" para reportes/dashboards, este es el primer caso real a cubrir (id 1637, `instagram_username = 'test_sprint4_lead1'`).
