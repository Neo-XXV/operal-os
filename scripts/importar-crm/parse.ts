import xlsxPkg from "xlsx";
const XLSX = xlsxPkg;
import type * as XLSXTypes from "xlsx";
import {
  FILA_HEADERS,
  FILA_DATOS_DESDE,
  BLOQUE_A,
  BLOQUE_B,
  BLOQUE_C,
  BLOQUE_D,
  ORIGEN_IMPORT,
} from "./columnas.ts";

export type Problema = {
  hoja: string;
  fila: number;
  tipo: string;
  detalle: string;
};

export type EventoCandidato =
  | { tipo: "LEAD_CREADO"; timestamp: Date; payload: { origen: string } }
  | {
      tipo: "LEAD_ASIGNADO";
      timestamp: Date;
      payload: { setter_anterior: null; setter_nuevo: "JORGE" };
    }
  | {
      tipo: "ESTADO_CAMBIADO";
      timestamp: Date;
      // "aproximada" solo se setea (true) cuando la fecha no sale de un dato
      // real de la fila (ej: MS sin FUP1/notas, se usa fecha de inicio como
      // fallback) -- se omite en el resto de los eventos, no forma parte del
      // contrato documentado de ESTADO_CAMBIADO en 03_catalogo_eventos.md.
      payload: { estado_anterior: string | null; estado_nuevo: string; aproximada?: true };
    }
  | {
      tipo: "SEGUIMIENTO_ENVIADO";
      timestamp: Date;
      payload: { etapa: "A" | "MS" | "B" | "C"; numero: number };
    };

export type LeadImportado = {
  enlace: string; // username extraido, tal como se guarda en instagramUsername
  nombre: string;
  eventos: EventoCandidato[];
};

export type ResultadoParseo = {
  leads: LeadImportado[];
  problemas: Problema[];
};

export const ORDEN_ETAPAS = ["A", "MS", "B", "C", "D"] as const;
export type Etapa = (typeof ORDEN_ETAPAS)[number];

// Estado de un lead ya conocido de un mes anterior (de esta misma corrida o
// de la base) -- permite reconocer continuaciones entre meses ("el mismo
// lead aparece repetido entre bloques y entre meses") en vez de marcarlas
// como huerfanas cuando el bloque A esta en la hoja de OTRO mes.
export type EstadoConocido = { etapa: Etapa; nombre: string };

function col(ws: XLSXTypes.WorkSheet, letra: string, filaHumana: number): unknown {
  const c = XLSX.utils.decode_col(letra);
  const cell = ws[XLSX.utils.encode_cell({ r: filaHumana - 1, c })];
  return cell?.v;
}

function ultimaFila(ws: XLSXTypes.WorkSheet): number {
  const rango = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  return rango.e.r + 1; // 1-indexado
}

function esVacio(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

// Lee una columna que deberia ser texto (nombre, enlace, flag "Si"/"Trackeado").
// En 11 meses de carga manual aparecen celdas con numeros, booleanos u otros
// tipos donde se esperaba texto -- se coacciona a string en vez de asumir,
// para no crashear todo el import por una celda mal tipeada en un mes.
function colTexto(ws: XLSXTypes.WorkSheet, letra: string, filaHumana: number): string | undefined {
  const v = col(ws, letra, filaHumana);
  if (esVacio(v)) return undefined;
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

// Lee una columna que deberia ser fecha. Si hay un valor pero no es una
// fecha real (ej: alguien tipeo texto en una columna de fecha), se loguea
// como inconsistencia y se trata como si no hubiera fecha -- nunca se
// inventa ni se intenta "adivinar" un parseo de fecha ambiguo.
function colFecha(
  ws: XLSXTypes.WorkSheet,
  letra: string,
  filaHumana: number,
  hoja: string,
  contexto: string,
  problemas: Problema[],
): Date | undefined {
  const v = col(ws, letra, filaHumana);
  if (esVacio(v)) return undefined;
  if (v instanceof Date) return v;
  problemas.push({
    hoja,
    fila: filaHumana,
    tipo: "FECHA_NO_RECONOCIDA",
    detalle: `${contexto}: valor "${v}" no es una fecha reconocible -- se trata como si no hubiera fecha en esa celda.`,
  });
  return undefined;
}

// El campo "instagramUsername" del resto de la app guarda el @usuario, no la
// URL completa (ver Leads.tsx: `@{lead.instagramUsername}`) -- se extrae acá
// para ser consistente con como ya se guardan los leads cargados a mano.
function extraerUsername(enlaceCrudo: string): { username: string; reconocido: boolean } {
  const texto = enlaceCrudo.trim();
  const match = texto.match(/instagram\.com\/([a-zA-Z0-9._]+)/i);
  if (match) return { username: match[1], reconocido: true };
  // No es una URL de instagram reconocible -- se usa tal cual, pero se marca
  // para loguearlo (no se descarta: puede ser igual un @usuario suelto).
  return { username: texto.replace(/^@/, ""), reconocido: false };
}

function normalizarClave(username: string): string {
  return username.trim().toLowerCase();
}

function fechaAMediodia(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
}

function sumarDias(d: Date, dias: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + dias);
  return r;
}

// Notas de seguimiento en texto libre, formato relevado: "DD/MM - DD/MM - " o
// con un parentesis extra tipo "(72hrs, DD/MM)". Se extraen TODAS las fechas
// DD/MM presentes (regla confirmada por el dueno de los datos), año = el de
// la hoja. Guiones sin fecha despues se ignoran. Si no matchea ninguna fecha
// y no es solo guiones/espacios, se reporta como no parseable.
function parsearFechasNotasA(valorCelda: unknown, anio: number): { fechas: Date[]; noParseable: boolean } {
  // La celda de notas es texto libre tipeado a mano -- en 11 meses reales
  // aparecen valores que Excel/el usuario cargaron como numero, fecha u
  // otro tipo en vez de texto. Se coacciona a string en vez de asumir.
  if (valorCelda instanceof Date) return { fechas: [], noParseable: false }; // ya cubierto por otras columnas
  const texto = typeof valorCelda === "string" ? valorCelda : String(valorCelda);
  const matches = [...texto.matchAll(/(\d{1,2})\/(\d{1,2})/g)];
  const fechas = matches.map(([, dd, mm]) => {
    const d = parseInt(dd, 10);
    const m = parseInt(mm, 10);
    return new Date(anio, m - 1, d, 12, 0, 0);
  });
  const soloGuionesOVacio = /^[\s\-]*$/.test(texto.replace(/\(.*?\)/g, ""));
  return { fechas, noParseable: fechas.length === 0 && !soloGuionesOVacio };
}

type FilaA = {
  fila: number;
  enlace: string;
  nombre: string;
  fechaInicio: Date;
  seguimientos: Date[]; // ya dedupeadas y ordenadas
  respondio: boolean;
};

type FilaBC = {
  fila: number;
  enlace: string;
  nombre: string;
  fecha: Date | null;
  trackeado: boolean;
  seguimientos: Date[]; // indexadas 1..7, con huecos si faltan
};

type FilaD = {
  fila: number;
  enlace: string;
  nombre: string;
  fecha: Date | null;
  trackeado: boolean;
};

function leerBloqueA(ws: XLSXTypes.WorkSheet, hoja: string, anio: number, problemas: Problema[]): FilaA[] {
  const filas: FilaA[] = [];
  const ultima = ultimaFila(ws);
  for (let fila = FILA_DATOS_DESDE; fila <= ultima; fila++) {
    const nombre = colTexto(ws, BLOQUE_A.nombre, fila);
    if (esVacio(nombre)) continue;

    const enlaceCrudo = colTexto(ws, BLOQUE_A.enlace, fila);
    const fechaInicio = colFecha(ws, BLOQUE_A.fechaInicio, fila, hoja, `Bloque A fecha de inicio (nombre "${nombre}")`, problemas);
    if (esVacio(enlaceCrudo) || esVacio(fechaInicio)) {
      problemas.push({
        hoja,
        fila,
        tipo: "BLOQUE_A_INCOMPLETO",
        detalle: `Nombre "${nombre}" sin enlace y/o fecha de inicio -- no se puede identificar ni fechar el lead.`,
      });
      continue;
    }

    const { username, reconocido } = extraerUsername(enlaceCrudo!);
    if (!reconocido) {
      problemas.push({
        hoja,
        fila,
        tipo: "ENLACE_NO_RECONOCIDO",
        detalle: `"${enlaceCrudo}" no matchea el patron de URL de instagram -- se uso "${username}" tal cual.`,
      });
    }

    const seguimientosSet = new Map<string, Date>(); // dedup por dia
    const fup1 = colFecha(ws, BLOQUE_A.fup1, fila, hoja, `Bloque A FUP1 (nombre "${nombre}")`, problemas);
    if (!esVacio(fup1)) {
      const f = fechaAMediodia(fup1!);
      seguimientosSet.set(f.toISOString().slice(0, 10), f);
    }
    const notas = col(ws, BLOQUE_A.notas, fila);
    if (!esVacio(notas)) {
      const { fechas, noParseable } = parsearFechasNotasA(notas, anio);
      if (noParseable) {
        problemas.push({
          hoja,
          fila,
          tipo: "NOTAS_A_NO_PARSEABLES",
          detalle: `Celda de notas de seguimiento "${notas}" no matchea ninguna fecha DD/MM ni es solo guiones.`,
        });
      }
      for (const f of fechas) {
        const key = f.toISOString().slice(0, 10);
        if (!seguimientosSet.has(key)) seguimientosSet.set(key, f);
      }
    }

    const respondio = colTexto(ws, BLOQUE_A.respondio, fila) === "Si";

    filas.push({
      fila,
      enlace: username,
      nombre: nombre!,
      fechaInicio: fechaAMediodia(fechaInicio!),
      seguimientos: [...seguimientosSet.values()].sort((a, b) => a.getTime() - b.getTime()),
      respondio,
    });
  }
  return filas;
}

function leerBloqueBoC(
  ws: XLSXTypes.WorkSheet,
  hoja: string,
  cols: typeof BLOQUE_B | typeof BLOQUE_C,
  etiqueta: string,
  problemas: Problema[],
): FilaBC[] {
  const filas: FilaBC[] = [];
  const ultima = ultimaFila(ws);
  for (let fila = FILA_DATOS_DESDE; fila <= ultima; fila++) {
    const nombre = colTexto(ws, cols.nombre, fila);
    const enlaceCrudo = colTexto(ws, cols.enlace, fila);
    const fecha = colFecha(ws, cols.fecha, fila, hoja, `Bloque ${etiqueta} fecha (nombre "${nombre ?? ""}")`, problemas);
    const trackeadoRaw = colTexto(ws, cols.trackeado, fila);
    const haySeguimientos = cols.seguimientos.some((L) => !esVacio(col(ws, L, fila)));

    const hayAlgo = !esVacio(nombre) || !esVacio(enlaceCrudo) || !esVacio(fecha) || !esVacio(trackeadoRaw) || haySeguimientos;
    if (!hayAlgo) continue;

    if (esVacio(enlaceCrudo)) {
      problemas.push({
        hoja,
        fila,
        tipo: `BLOQUE_${etiqueta}_SIN_ENLACE`,
        detalle: `Fila con datos en bloque ${etiqueta} (nombre="${nombre ?? ""}", trackeado="${trackeadoRaw ?? ""}") pero sin enlace -- no se puede identificar el lead. Se descarta esta fila.`,
      });
      continue;
    }

    const { username, reconocido } = extraerUsername(enlaceCrudo!);
    if (!reconocido) {
      problemas.push({
        hoja,
        fila,
        tipo: "ENLACE_NO_RECONOCIDO",
        detalle: `"${enlaceCrudo}" (bloque ${etiqueta}) no matchea el patron de URL de instagram -- se uso "${username}" tal cual.`,
      });
    }

    const trackeado = trackeadoRaw === "Si";
    if (!esVacio(fecha) && !trackeado) {
      problemas.push({
        hoja,
        fila,
        tipo: `BLOQUE_${etiqueta}_FECHA_SIN_TRACKEAR`,
        detalle: `Fila tiene fecha cargada pero "Trackeado" no esta en "Si" -- se ignora esta etapa para este lead hasta revisar.`,
      });
    }
    if (trackeado && esVacio(fecha)) {
      problemas.push({
        hoja,
        fila,
        tipo: `BLOQUE_${etiqueta}_SIN_FECHA`,
        detalle: `"Trackeado"="Si" pero no hay fecha -- no se puede fechar el evento de esta etapa. Se omite.`,
      });
    }

    const seguimientos: Date[] = [];
    cols.seguimientos.forEach((L, i) => {
      const v = colFecha(ws, L, fila, hoja, `Bloque ${etiqueta} seguimiento ${i + 1} (nombre "${nombre ?? ""}")`, problemas);
      if (!esVacio(v)) seguimientos[i] = fechaAMediodia(v!);
    });

    filas.push({
      fila,
      enlace: username,
      nombre: nombre ?? "",
      fecha: !esVacio(fecha) && trackeado ? fechaAMediodia(fecha!) : null,
      trackeado: trackeado && !esVacio(fecha),
      seguimientos,
    });
  }
  return filas;
}

function leerBloqueD(ws: XLSXTypes.WorkSheet, hoja: string, problemas: Problema[]): FilaD[] {
  const filas: FilaD[] = [];
  const ultima = ultimaFila(ws);
  for (let fila = FILA_DATOS_DESDE; fila <= ultima; fila++) {
    const nombre = colTexto(ws, BLOQUE_D.nombre, fila);
    const enlaceCrudo = colTexto(ws, BLOQUE_D.enlace, fila);
    const fecha = colFecha(ws, BLOQUE_D.fecha, fila, hoja, `Bloque D fecha (nombre "${nombre ?? ""}")`, problemas);
    const trackeadoRaw = colTexto(ws, BLOQUE_D.trackeado, fila);

    const hayAlgo = !esVacio(nombre) || !esVacio(enlaceCrudo) || !esVacio(fecha) || !esVacio(trackeadoRaw);
    if (!hayAlgo) continue;

    if (esVacio(enlaceCrudo)) {
      problemas.push({
        hoja,
        fila,
        tipo: "BLOQUE_D_SIN_ENLACE",
        detalle: `Fila con datos en bloque D (nombre="${nombre ?? ""}") pero sin enlace -- se descarta esta fila.`,
      });
      continue;
    }

    const { username, reconocido } = extraerUsername(enlaceCrudo!);
    if (!reconocido) {
      problemas.push({
        hoja,
        fila,
        tipo: "ENLACE_NO_RECONOCIDO",
        detalle: `"${enlaceCrudo}" (bloque D) no matchea el patron de URL de instagram -- se uso "${username}" tal cual.`,
      });
    }

    const trackeado = trackeadoRaw === "Si";
    if (trackeado && esVacio(fecha)) {
      problemas.push({
        hoja,
        fila,
        tipo: "BLOQUE_D_SIN_FECHA",
        detalle: `"Trackeado"="Si" pero no hay fecha agendada -- se omite el evento.`,
      });
    }

    filas.push({
      fila,
      enlace: username,
      nombre: nombre ?? "",
      fecha: !esVacio(fecha) && trackeado ? fechaAMediodia(fecha!) : null,
      trackeado: trackeado && !esVacio(fecha),
    });
  }
  return filas;
}

type PasoEtapa = {
  etapa: Exclude<Etapa, "A">;
  disponible: boolean; // hay datos que indican que se llego a esta etapa
  fecha: Date | null;
  aproximada?: true;
  seguimientos?: Date[]; // D no tiene seguimientos propios
};

// Avanza la maquina de estados desde `etapaActual` usando los pasos
// disponibles (en orden MS/B/C/D, ya recortado a lo que sigue de
// `etapaActual`). Se detiene -- y loguea -- en el primer paso sin datos
// (si hay datos de una etapa MAS ADELANTE, es un salto real) o sin fecha
// utilizable. Nunca inventa una transicion. Devuelve la etapa final alcanzada.
function avanzarEtapas(
  eventos: EventoCandidato[],
  hoja: string,
  fila: number,
  nombre: string,
  enlace: string,
  etapaActual: Etapa,
  pasos: PasoEtapa[],
  problemas: Problema[],
): Etapa {
  let actual = etapaActual;
  for (let i = 0; i < pasos.length; i++) {
    const paso = pasos[i];
    if (!paso.disponible) {
      const hayMasAdelante = pasos.slice(i + 1).some((p) => p.disponible);
      if (hayMasAdelante) {
        problemas.push({
          hoja,
          fila,
          tipo: "SALTO_DE_ETAPA",
          detalle: `Lead "${nombre}" (${enlace}) tiene datos de una etapa posterior a ${paso.etapa} pero no llego (o no esta trackeado) a ${paso.etapa}. Se importa solo hasta ${actual}.`,
        });
      }
      break;
    }
    if (!paso.fecha) {
      problemas.push({
        hoja,
        fila,
        tipo: `${paso.etapa}_SIN_FECHA_UTIL`,
        detalle: `Lead "${nombre}" (${enlace}) llego a ${paso.etapa} pero sin fecha utilizable -- se omite este paso y los siguientes.`,
      });
      break;
    }
    eventos.push({
      tipo: "ESTADO_CAMBIADO",
      timestamp: paso.fecha,
      payload: { estado_anterior: actual, estado_nuevo: paso.etapa, ...(paso.aproximada ? { aproximada: true as const } : {}) },
    });
    paso.seguimientos?.forEach((fecha, j) => {
      if (fecha) {
        eventos.push({
          tipo: "SEGUIMIENTO_ENVIADO",
          timestamp: fecha,
          payload: { etapa: paso.etapa as "MS" | "B" | "C", numero: j + 1 },
        });
      }
    });
    actual = paso.etapa;
  }
  return actual;
}

// La primera fecha real de una etapa siguiente que efectivamente se va a
// insertar como evento -- se corta en el primer paso no disponible, igual
// que avanzarEtapas, porque si B no esta disponible, C y D tampoco se llegan
// a insertar en esta hoja (quedan como SALTO_DE_ETAPA), asi que su fecha
// cruda no cuenta para el clamp.
function primeraFechaSiguienteDisponible(siguientes: PasoEtapa[]): Date | null {
  for (const p of siguientes) {
    if (!p.disponible) return null;
    if (p.fecha) return p.fecha;
  }
  return null;
}

function pasoMS(hoja: string, a: FilaA, siguientes: PasoEtapa[], problemas: Problema[]): PasoEtapa {
  if (!a.respondio) return { etapa: "MS", disponible: false, fecha: null };

  const fup1 = a.seguimientos[0]; // el primero cronologicamente
  const tieneFup1Real = a.seguimientos.length > 0;

  let fecha: Date;
  let aproximada: true | undefined;
  if (tieneFup1Real) {
    fecha = sumarDias(fup1, 1);
  } else {
    // K="Si" pero sin FUP1/notas -> no hay de donde derivar la fecha exacta.
    // El hecho de que respondio es real y confirmado -- se usa la fecha de
    // inicio (col D) como fallback en vez de perder la conversion, marcado
    // "aproximada" para distinguir despues fecha exacta de estimada.
    fecha = a.fechaInicio;
    aproximada = true;
    problemas.push({
      hoja,
      fila: a.fila,
      tipo: "MS_FECHA_APROXIMADA",
      detalle: `Lead "${a.nombre}" (${a.enlace}) tiene "Respondio"="Si" pero no hay fecha de FUP1 ni notas de seguimiento -- se uso la fecha de inicio (${a.fechaInicio.toISOString().slice(0, 10)}) como fallback para el ESTADO_CAMBIADO a MS. Marcado payload.aproximada=true.`,
    });
  }

  // La fecha de MS (derivada, no exacta) nunca puede ser posterior a la
  // primera fecha real conocida de una etapa siguiente (B, C o D) de este
  // mismo lead -- si lo es, se ajusta a esa misma fecha (pueden coincidir
  // varias etapas en el mismo dia, ya pasa con A/B en datos reales). El
  // desempate por id de insercion (MS se inserta antes que B/C/D en la misma
  // transaccion del lead) preserva el orden cronologico correcto -- por eso
  // cualquier correccion posterior sobre datos ya importados debe reinsertar
  // la cadena completa en orden, no un evento suelto (ver
  // reconstruir-descartes.ts / notas de operacion).
  const limite = primeraFechaSiguienteDisponible(siguientes);
  if (limite && fecha.getTime() > limite.getTime()) {
    problemas.push({
      hoja,
      fila: a.fila,
      tipo: "MS_FECHA_AJUSTADA_POR_ORDEN",
      detalle: `Lead "${a.nombre}" (${a.enlace}) tiene MS calculado (${fecha.toISOString().slice(0, 10)}) posterior a la primera fecha real conocida de una etapa siguiente (${limite.toISOString().slice(0, 10)}) -- se ajusta MS a esa fecha para preservar el orden cronologico (el desempate por id de insercion la deja antes).`,
    });
    fecha = limite;
    aproximada = true;
  }

  return { etapa: "MS", disponible: true, fecha, aproximada };
}

function pasoBoC(b: FilaBC | undefined, etapa: "B" | "C"): PasoEtapa {
  return { etapa, disponible: !!b?.trackeado, fecha: b?.fecha ?? null, seguimientos: b?.seguimientos };
}

function pasoD(d: FilaD | undefined): PasoEtapa {
  return { etapa: "D", disponible: !!d?.trackeado, fecha: d?.fecha ?? null };
}

// Construye los eventos de un lead que arranca de cero en esta hoja (tiene
// su propia fila de bloque A, nunca visto antes).
function construirEventosNuevoLead(
  hoja: string,
  a: FilaA,
  b: FilaBC | undefined,
  c: FilaBC | undefined,
  d: FilaD | undefined,
  problemas: Problema[],
): { eventos: EventoCandidato[]; etapaFinal: Etapa } {
  const eventos: EventoCandidato[] = [];

  eventos.push({ tipo: "LEAD_CREADO", timestamp: a.fechaInicio, payload: { origen: ORIGEN_IMPORT } });
  eventos.push({
    tipo: "LEAD_ASIGNADO",
    timestamp: a.fechaInicio,
    payload: { setter_anterior: null, setter_nuevo: "JORGE" },
  });
  eventos.push({
    tipo: "ESTADO_CAMBIADO",
    timestamp: a.fechaInicio,
    payload: { estado_anterior: null, estado_nuevo: "A" },
  });
  a.seguimientos.forEach((fecha, i) => {
    eventos.push({ tipo: "SEGUIMIENTO_ENVIADO", timestamp: fecha, payload: { etapa: "A", numero: i + 1 } });
  });

  const pB = pasoBoC(b, "B");
  const pC = pasoBoC(c, "C");
  const pD = pasoD(d);
  const etapaFinal = avanzarEtapas(
    eventos,
    hoja,
    a.fila,
    a.nombre,
    a.enlace,
    "A",
    [pasoMS(hoja, a, [pB, pC, pD], problemas), pB, pC, pD],
    problemas,
  );
  return { eventos, etapaFinal };
}

// Continua un lead ya conocido (de un mes anterior de esta corrida, o de la
// base) que no tiene fila de bloque A en esta hoja. No vuelve a emitir
// LEAD_CREADO/LEAD_ASIGNADO/ESTADO_CAMBIADO(->A) -- ya existen.
function construirEventosContinuacion(
  hoja: string,
  fila: number,
  nombre: string,
  enlace: string,
  etapaConocida: Etapa,
  b: FilaBC | undefined,
  c: FilaBC | undefined,
  d: FilaD | undefined,
  problemas: Problema[],
): { eventos: EventoCandidato[]; etapaFinal: Etapa } {
  const eventos: EventoCandidato[] = [];
  const idx = ORDEN_ETAPAS.indexOf(etapaConocida);
  const todosLosPasos: PasoEtapa[] = [pasoBoC(b, "B"), pasoBoC(c, "C"), pasoD(d)];
  // Solo los pasos estrictamente posteriores a la etapa ya conocida.
  const pasosRestantes = todosLosPasos.filter((p) => ORDEN_ETAPAS.indexOf(p.etapa) > idx);
  const etapaFinal = avanzarEtapas(eventos, hoja, fila, nombre, enlace, etapaConocida, pasosRestantes, problemas);
  return { eventos, etapaFinal };
}

// `conocidos` se lee Y se actualiza en el lugar: al terminar de procesar
// esta hoja, incluye tambien los leads recien vistos aca -- para que la
// PROXIMA hoja de la misma corrida (mes siguiente) los reconozca como
// continuacion en vez de huerfanos. Se debe pre-poblar con lo que ya haya en
// la base antes de la primera llamada (ver obtenerEstadoConocido en db.ts),
// para que un mes ya importado en una corrida anterior tambien se reconozca.
export function parsearHoja(
  ws: XLSXTypes.WorkSheet,
  hoja: string,
  anio: number,
  conocidos: Map<string, EstadoConocido>,
): ResultadoParseo {
  const problemas: Problema[] = [];

  const filasA = leerBloqueA(ws, hoja, anio, problemas);
  const filasB = leerBloqueBoC(ws, hoja, BLOQUE_B, "B", problemas);
  const filasC = leerBloqueBoC(ws, hoja, BLOQUE_C, "C", problemas);
  const filasD = leerBloqueD(ws, hoja, problemas);

  const porEnlaceA = new Map(filasA.map((f) => [normalizarClave(f.enlace), f]));
  const porEnlaceB = new Map(filasB.map((f) => [normalizarClave(f.enlace), f]));
  const porEnlaceC = new Map(filasC.map((f) => [normalizarClave(f.enlace), f]));
  const porEnlaceD = new Map(filasD.map((f) => [normalizarClave(f.enlace), f]));

  const todosLosEnlaces = new Set([...porEnlaceA.keys(), ...porEnlaceB.keys(), ...porEnlaceC.keys(), ...porEnlaceD.keys()]);

  const leads: LeadImportado[] = [];

  for (const clave of todosLosEnlaces) {
    const a = porEnlaceA.get(clave);
    const b = porEnlaceB.get(clave);
    const c = porEnlaceC.get(clave);
    const d = porEnlaceD.get(clave);
    const conocido = conocidos.get(clave);

    if (a && !conocido) {
      // Lead nuevo, arranca de cero en esta hoja.
      const { eventos, etapaFinal } = construirEventosNuevoLead(hoja, a, b, c, d, problemas);
      leads.push({ enlace: a.enlace, nombre: a.nombre, eventos });
      conocidos.set(clave, { etapa: etapaFinal, nombre: a.nombre });
      continue;
    }

    if (a && conocido) {
      // Reaparece en bloque A pero ya lo conociamos de un mes anterior --
      // no se reinicia el lead (LEAD_CREADO ya existe). Si todavia estaba
      // en A (nunca respondio), esta fila trae una oportunidad real de
      // avanzar con su propio "Respondio"/seguimientos; si ya habia
      // avanzado mas, se ignoran los datos de bloque A de esta fila (el
      // lead ya tiene una fecha de inicio real de antes) y solo se
      // evaluan B/C/D de esta hoja.
      problemas.push({
        hoja,
        fila: a.fila,
        tipo: "REINICIO_BLOQUE_A",
        detalle: `Enlace "${a.enlace}" aparece de nuevo en bloque A de "${hoja}" pero ya era conocido (etapa previa: ${conocido.etapa}). No se recrea el lead; se usa la etapa ya conocida como base.`,
      });
      const pasos: PasoEtapa[] =
        conocido.etapa === "A" ? [pasoMS(hoja, a, [pasoBoC(b, "B"), pasoBoC(c, "C"), pasoD(d)], problemas)] : [];
      const eventos: EventoCandidato[] = [];
      const etapaTrasA = avanzarEtapas(eventos, hoja, a.fila, conocido.nombre, a.enlace, conocido.etapa, pasos, problemas);
      const { eventos: eventosResto, etapaFinal } = construirEventosContinuacion(
        hoja,
        a.fila,
        conocido.nombre,
        a.enlace,
        etapaTrasA,
        b,
        c,
        d,
        problemas,
      );
      leads.push({ enlace: a.enlace, nombre: conocido.nombre, eventos: [...eventos, ...eventosResto] });
      conocidos.set(clave, { etapa: etapaFinal, nombre: conocido.nombre });
      continue;
    }

    if (!a && conocido) {
      // Continuacion real de un mes anterior: sigue avanzando en esta hoja.
      const filaRef = b?.fila ?? c?.fila ?? d?.fila ?? 0;
      const enlaceReal = b?.enlace ?? c?.enlace ?? d?.enlace ?? clave;
      const { eventos, etapaFinal } = construirEventosContinuacion(
        hoja,
        filaRef,
        conocido.nombre,
        enlaceReal,
        conocido.etapa,
        b,
        c,
        d,
        problemas,
      );
      leads.push({ enlace: enlaceReal, nombre: conocido.nombre, eventos });
      conocidos.set(clave, { etapa: etapaFinal, nombre: conocido.nombre });
      continue;
    }

    // !a && !conocido: huerfano real, nunca visto en ningun mes anterior ni en esta hoja.
    const filaRef = b?.fila ?? c?.fila ?? d?.fila ?? 0;
    const bloque = b ? "B" : c ? "C" : "D";
    problemas.push({
      hoja,
      fila: filaRef,
      tipo: "SIN_BLOQUE_A",
      detalle: `Enlace "${b?.enlace ?? c?.enlace ?? d?.enlace ?? clave}" aparece en bloque ${bloque} pero nunca se vio en bloque A (ni en esta hoja ni en meses ya procesados). Se omite.`,
    });
  }

  return { leads, problemas };
}
