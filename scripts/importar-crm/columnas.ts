// Layout real del Excel "CRM de Jorge.xlsx", verificado celda por celda
// (headers fila 15, comentarios de celda F15/K15, formulas del resumen D6:D10)
// contra la hoja "Julio". Mismo layout para las otras hojas mensuales.

export const FILA_HEADERS = 15;
export const FILA_DATOS_DESDE = 16;

export const BLOQUE_A = {
  nombre: "B",
  enlace: "C",
  fechaInicio: "D",
  fup1: "F", // "Iniciado Prospecto FUP1 (enviar 24h despues del mensaje inicial)"
  notas: "G", // notas de seguimiento en texto libre, formato "DD/MM - DD/MM - "
  respondio: "K", // "Respondio (S)" -- "Si" | vacio
} as const;

export const BLOQUE_B = {
  nombre: "M",
  enlace: "N",
  fecha: "O",
  trackeado: "P",
  seguimientos: ["Q", "R", "S", "T", "U", "V", "W"] as const, // 1B..7B
} as const;

export const BLOQUE_C = {
  nombre: "Z",
  enlace: "AA",
  fecha: "AB",
  trackeado: "AC",
  seguimientos: ["AD", "AE", "AF", "AG", "AH", "AI", "AJ"] as const, // 1C..7C
} as const;

export const BLOQUE_D = {
  nombre: "AM",
  enlace: "AN",
  fecha: "AO",
  trackeado: "AP",
} as const;

export const ORIGEN_IMPORT = "SCRAPING" as const;
