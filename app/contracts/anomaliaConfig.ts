// Umbrales de deteccion de anomalias -- unica fuente (docs/02_reglas_de_negocio
// (1).md seccion 9). Las funciones de evaluacion reciben estos valores como
// parametro, nunca hardcodeados inline -- el dia que se vuelvan configurables
// (tabla/panel de admin), solo cambia de donde sale este objeto.

export const ANOMALIA_CONFIG = {
  pisoLeadsContactados: 300,
  conversion: {
    MSR_BAJO: { origen: "A", destino: "MS", umbral: 1 / 4, objetivo: 1 / 3 as number | null, nivel: "SETTER" as const },
    PRR_BAJO: { origen: "MS", destino: "B", umbral: 1 / 2, objetivo: null as number | null, nivel: "SETTER" as const },
    CSR_BAJO: { origen: "B", destino: "C", umbral: 1 / 35, objetivo: 1 / 20 as number | null, nivel: "EQUIPO" as const },
  },
  tiempo: {
    TIEMPO_A_MS: { etapaOrigen: "A", etapaDestino: "MS", horas: 24, atribuibleA: "LEAD" as const },
    TIEMPO_MS_B: { etapaOrigen: "MS", etapaDestino: "B", horas: 24, atribuibleA: "SETTER" as const },
    TIEMPO_B_C: { etapaOrigen: "B", etapaDestino: "C", horas: 72, atribuibleA: "SETTER" as const },
    TIEMPO_C_D: { etapaOrigen: "C", etapaDestino: "D", horasDefault: 48, atribuibleA: "LEAD" as const },
  },
  // Cadencia del barrido periodico -- ver docs/99_deuda_tecnica.md
  // (setInterval en proceso unico, limitacion aceptada).
  intervaloEvaluacionMs: 60 * 60 * 1000,
} as const;

export type TipoAnomaliaConversion = keyof typeof ANOMALIA_CONFIG.conversion;
export type TipoAnomaliaTiempo = keyof typeof ANOMALIA_CONFIG.tiempo;
