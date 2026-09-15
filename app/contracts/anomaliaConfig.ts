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
  // PAUSADO tras la migracion de dominio Instagram -> LinkedIn.
  //
  // Los umbrales de abajo (24h / 24h / 72h / 48h) se calibraron con el ritmo
  // de conversacion de Instagram DM. LinkedIn tiene una cadencia distinta y
  // todavia no hay datos propios para recalibrarlos -- dejarlos activos
  // generaria una avalancha de falsos positivos que enseñaria al equipo a
  // ignorar las alertas, que es peor que no tenerlas.
  //
  // Se pausa la DETECCION de anomalias de tiempo, no la de conversion (esa
  // sigue activa: sus umbrales son tasas, no dependen del ritmo del canal).
  // El codigo de deteccion queda intacto -- evaluarAnomaliasDeTiempo() sigue
  // existiendo y testeada; solo no se la invoca. Reactivar es poner esto en
  // true, sin revertir nada.
  //
  // Las anomalias de tiempo YA registradas siguen visibles en los dashboards
  // y en la IA: son hechos historicos del Event Log, no se ocultan.
  // Ver docs/02_reglas_de_negocio (1).md seccion 9.
  tiempoActivo: false,
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
