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
