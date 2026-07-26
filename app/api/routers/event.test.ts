import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { validarTransicion, calcularEmbudo, resolverVentana } from "./event";

describe("validarTransicion", () => {
  it("acepta el primer estado como A", () => {
    expect(() => validarTransicion(null, "A")).not.toThrow();
  });

  it("rechaza que el primer estado sea distinto de A", () => {
    expect(() => validarTransicion(null, "MS")).toThrow("El primer estado debe ser A");
  });

  it.each([
    ["A", "MS"],
    ["MS", "B"],
    ["B", "C"],
    ["C", "D"],
  ])("acepta la transicion secuencial %s -> %s", (anterior, nuevo) => {
    expect(() => validarTransicion(anterior, nuevo)).not.toThrow();
  });

  it("rechaza saltar una etapa (A -> B)", () => {
    expect(() => validarTransicion("A", "B")).toThrow("Transicion invalida: A -> B");
  });

  it("rechaza saltar mas de una etapa (A -> D)", () => {
    expect(() => validarTransicion("A", "D")).toThrow("Transicion invalida: A -> D");
  });

  it("rechaza retroceder una etapa (MS -> A)", () => {
    expect(() => validarTransicion("MS", "A")).toThrow("Transicion invalida: MS -> A");
  });

  it("rechaza permanecer en la misma etapa (B -> B)", () => {
    expect(() => validarTransicion("B", "B")).toThrow("Transicion invalida: B -> B");
  });

  it("rechaza un estado destino invalido", () => {
    expect(() => validarTransicion("A", "Z")).toThrow("Estado invalido: Z");
  });

  it("rechaza avanzar despues de D (no hay estado siguiente)", () => {
    expect(() => validarTransicion("D", "A")).toThrow("Transicion invalida: D -> A");
  });
});

describe("calcularEmbudo", () => {
  const cambio = (leadId: number, estado_nuevo: string) => ({ leadId, payload: { estado_nuevo } });

  it("cuenta leads distintos por etapa, no eventos", () => {
    // Lead 1 pasa por A y despues MS -- debe contar en ambas etapas, una vez cada una.
    const resultado = calcularEmbudo([cambio(1, "A"), cambio(1, "MS"), cambio(2, "A")]);
    expect(resultado.conteos).toEqual({ A: 2, MS: 1, B: 0, C: 0, D: 0 });
  });

  it("no duplica un lead si el mismo evento de etapa aparece dos veces", () => {
    const resultado = calcularEmbudo([cambio(1, "A"), cambio(1, "A")]);
    expect(resultado.conteos.A).toBe(1);
  });

  it("calcula las tasas como etapa siguiente sobre etapa anterior (secuencial, no acumulado)", () => {
    // 10 en A, 4 llegan a MS, 2 llegan a B -- MSR=4/10, PRR=2/4, no B/A.
    const eventos = [
      ...Array.from({ length: 10 }, (_, i) => cambio(i, "A")),
      ...Array.from({ length: 4 }, (_, i) => cambio(i, "MS")),
      ...Array.from({ length: 2 }, (_, i) => cambio(i, "B")),
    ];
    const resultado = calcularEmbudo(eventos);
    expect(resultado.tasas.MSR).toBeCloseTo(0.4);
    expect(resultado.tasas.PRR).toBeCloseTo(0.5);
    expect(resultado.tasas.CSR).toBe(0); // B=2 (>0) pero C=0 -- tasa real 0, no null
    expect(resultado.tasas.ABR).toBeNull(); // C=0 -- denominador inexistente, no calculable
  });

  it("devuelve tasa null (no 0 ni NaN) cuando el denominador es 0", () => {
    const resultado = calcularEmbudo([]);
    expect(resultado.tasas.MSR).toBeNull();
    expect(resultado.tasas.PRR).toBeNull();
    expect(resultado.tasas.CSR).toBeNull();
    expect(resultado.tasas.ABR).toBeNull();
  });

  it("ignora estados_nuevo que no son parte del embudo (defensivo)", () => {
    const resultado = calcularEmbudo([cambio(1, "A"), { leadId: 2, payload: { estado_nuevo: "X" } }]);
    expect(resultado.conteos.A).toBe(1);
  });
});

describe("resolverVentana", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lifetime no tiene ventana ni ventana anterior", () => {
    const v = resolverVentana("lifetime");
    expect(v.desde).toBeNull();
    expect(v.desdeAnterior).toBeNull();
    expect(v.hastaAnterior).toBeNull();
  });

  it("mensual arranca el 1 del mes actual", () => {
    const v = resolverVentana("mensual");
    expect(v.desde?.getFullYear()).toBe(2026);
    expect(v.desde?.getMonth()).toBe(6); // julio, 0-indexado
    expect(v.desde?.getDate()).toBe(1);
  });

  it("la ventana anterior tiene la misma duracion que la actual", () => {
    const v = resolverVentana("mensual");
    const duracionActual = v.hasta.getTime() - v.desde!.getTime();
    const duracionAnterior = v.hastaAnterior!.getTime() - v.desdeAnterior!.getTime();
    // tolerancia de 1ms: hastaAnterior = desde - 1ms, produce un ms menos.
    expect(Math.abs(duracionActual - duracionAnterior)).toBeLessThanOrEqual(1);
  });

  it("la ventana anterior termina justo antes de que empiece la actual, sin superposicion", () => {
    const v = resolverVentana("mensual");
    expect(v.hastaAnterior!.getTime()).toBe(v.desde!.getTime() - 1);
  });

  it("trimestral arranca en el primer mes del trimestre calendario (Q3 = julio)", () => {
    const v = resolverVentana("trimestral");
    expect(v.desde?.getMonth()).toBe(6); // julio inicia Q3 (jul-ago-sep)
  });

  it("semestral arranca en julio para una fecha del segundo semestre", () => {
    const v = resolverVentana("semestral");
    expect(v.desde?.getMonth()).toBe(6);
  });

  it("anual arranca el 1 de enero del año actual", () => {
    const v = resolverVentana("anual");
    expect(v.desde?.getMonth()).toBe(0);
    expect(v.desde?.getDate()).toBe(1);
    expect(v.desde?.getFullYear()).toBe(2026);
  });

  it("rango usa las fechas provistas, normalizando a inicio/fin de dia", () => {
    const v = resolverVentana("rango", new Date("2026-01-10T15:30:00"), new Date("2026-01-20T08:00:00"));
    expect(v.desde?.getHours()).toBe(0);
    expect(v.desde?.getMinutes()).toBe(0);
    expect(v.hasta.getHours()).toBe(23);
    expect(v.hasta.getMinutes()).toBe(59);
  });

  it("rango sin 'desde' lanza error", () => {
    expect(() => resolverVentana("rango")).toThrow("El periodo 'rango' requiere 'desde'");
  });
});
