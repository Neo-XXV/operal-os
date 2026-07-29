import { describe, expect, it } from "vitest";
import { detectarAnomaliaTiempo, detectarTransicionConversion, type EventoConversion } from "./anomalia";

describe("detectarAnomaliaTiempo", () => {
  it("no marca anomalia si todavia no paso el deadline", () => {
    const desde = new Date("2026-01-01T00:00:00Z");
    const ahora = new Date("2026-01-01T20:00:00Z");
    const deadline = new Date(desde.getTime() + 24 * 3_600_000);
    const r = detectarAnomaliaTiempo(desde, ahora, deadline);
    expect(r.esAnomalia).toBe(false);
    expect(r.horasTranscurridas).toBeCloseTo(20);
    expect(r.umbralHoras).toBeCloseTo(24);
  });

  it("marca anomalia si ya paso el deadline", () => {
    const desde = new Date("2026-01-01T00:00:00Z");
    const ahora = new Date("2026-01-04T01:00:00Z"); // 73h despues
    const deadline = new Date(desde.getTime() + 72 * 3_600_000);
    const r = detectarAnomaliaTiempo(desde, ahora, deadline);
    expect(r.esAnomalia).toBe(true);
    expect(r.horasTranscurridas).toBeCloseTo(73);
  });

  it("en el limite exacto (ahora === deadline) no es anomalia todavia", () => {
    const desde = new Date("2026-01-01T00:00:00Z");
    const deadline = new Date(desde.getTime() + 48 * 3_600_000);
    const r = detectarAnomaliaTiempo(desde, deadline, deadline);
    expect(r.esAnomalia).toBe(false);
  });
});

// Helper para construir eventos de conversion en secuencia cronologica --
// id autoincremental, un evento por hora para tener timestamps distintos.
function construirSecuencia(estados: string[]): EventoConversion[] {
  return estados.map((estadoNuevo, i) => ({
    estadoNuevo,
    timestamp: new Date(Date.UTC(2026, 0, 1, i)),
    id: i + 1,
  }));
}

describe("detectarTransicionConversion", () => {
  const CFG = { origen: "A", destino: "MS", umbral: 0.25, piso: 4 };

  it("no evalua (ni bueno ni anomalo) si no se alcanza el piso", () => {
    // 3 "A", 0 "MS" -- piso es 4, no se llega.
    const eventos = construirSecuencia(["A", "A", "A"]);
    const r = detectarTransicionConversion(eventos, CFG);
    expect(r.anomaloAhora).toBe(false);
    expect(r.inicioStreak).toBeNull();
  });

  it("detecta una transicion limpia a anomalo apenas se cumple el piso", () => {
    // 4 "A", 0 "MS" -> tasa 0/4 = 0, peor que 0.25 -> anomalo.
    const eventos = construirSecuencia(["A", "A", "A", "A"]);
    const r = detectarTransicionConversion(eventos, CFG);
    expect(r.anomaloAhora).toBe(true);
    expect(r.inicioStreak).toEqual({ timestamp: eventos[3].timestamp, id: eventos[3].id });
    expect(r.numerador).toBe(0);
    expect(r.denominador).toBe(4);
  });

  it("una racha anomala que sigue vigente no cambia el inicioStreak al agregar mas eventos del mismo signo", () => {
    // 4 "A" (ya anomalo, arranca en el evento 4) + 1 "A" mas (sigue 0/5, sigue anomalo)
    const eventos = construirSecuencia(["A", "A", "A", "A", "A"]);
    const r = detectarTransicionConversion(eventos, CFG);
    expect(r.anomaloAhora).toBe(true);
    // El inicio de la racha sigue siendo el evento que la disparo (el 4to),
    // no el ultimo evento de la lista -- la racha nunca se corto.
    expect(r.inicioStreak?.id).toBe(4);
  });

  it("una racha que se resuelve deja de ser anomala", () => {
    // 4 "A" (anomalo, 0/4) + varios "MS" hasta que la tasa supera el umbral.
    const eventos = construirSecuencia(["A", "A", "A", "A", "MS", "MS"]);
    // tasa final: 2/4 = 0.5, no anomalo (umbral 0.25)
    const r = detectarTransicionConversion(eventos, CFG);
    expect(r.anomaloAhora).toBe(false);
    expect(r.inicioStreak).toBeNull();
  });

  it("una racha que se resuelve y vuelve a aparecer se detecta como una racha NUEVA", () => {
    // 4 "A" (anomalo, streak arranca en el evento 4) + 1 "MS" (se resuelve:
    // 1/4 = 0.25, no es "peor que" 0.25) + 1 "A" mas (vuelve a caer:
    // 1/5 = 0.2 < 0.25 -> anomalo otra vez, streak nuevo en el evento 6).
    const eventos = construirSecuencia(["A", "A", "A", "A", "MS", "A"]);
    const r = detectarTransicionConversion(eventos, CFG);
    expect(r.anomaloAhora).toBe(true);
    // El streak nuevo arranca en el evento que volvio a cruzar el umbral
    // (id 6), no en el primer streak (id 4) -- son rachas distintas.
    expect(r.inicioStreak?.id).toBe(6);
  });

  it("una rafaga de varios eventos entre corridas encuentra el mismo punto de cruce", () => {
    // Simula que el barrido no corrio evento por evento -- se le pasa TODO
    // el historial de una sola vez, como corre en produccion. El resultado
    // no depende de cuantas veces se "hubiera" evaluado en el medio.
    const eventos = construirSecuencia(["A", "A", "A", "MS", "A", "A", "A", "A"]);
    // Tras el "MS" (evento 4, denom=3 aun bajo el piso): al llegar al piso
    // (evento 5, denom=4) la tasa es 1/4=0.25, no es "peor que" -> no
    // anomalo todavia. El siguiente "A" la baja a 1/5=0.2 -> anomalo.
    const r = detectarTransicionConversion(eventos, CFG);
    expect(r.anomaloAhora).toBe(true);
    expect(r.denominador).toBe(7);
    expect(r.numerador).toBe(1);
  });
});
