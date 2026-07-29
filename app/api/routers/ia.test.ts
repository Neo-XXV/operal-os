import { describe, expect, it } from "vitest";
import { calcularTiemposEntreEtapas } from "./ia";

function ev(estadoNuevo: string, horasDesdeEpoch: number) {
  return { timestamp: new Date(horasDesdeEpoch * 3_600_000), payload: { estado_nuevo: estadoNuevo } };
}

describe("calcularTiemposEntreEtapas", () => {
  it("devuelve todo null si no hay eventos", () => {
    const r = calcularTiemposEntreEtapas([], new Date());
    expect(r).toEqual({ A_a_MS: null, MS_a_B: null, B_a_C: null, C_a_D: null, en_etapa_actual: null });
  });

  it("calcula el delta entre transiciones consecutivas", () => {
    const cambios = [ev("A", 0), ev("MS", 10), ev("B", 34)];
    const r = calcularTiemposEntreEtapas(cambios, new Date(40 * 3_600_000));
    expect(r.A_a_MS).toBe(10);
    expect(r.MS_a_B).toBe(24);
    expect(r.B_a_C).toBeNull();
    expect(r.en_etapa_actual).toBe(6);
  });

  it("un lead que solo llego a A tiene todas las transiciones null salvo el tramo abierto", () => {
    const cambios = [ev("A", 0)];
    const r = calcularTiemposEntreEtapas(cambios, new Date(46.2 * 3_600_000));
    expect(r.A_a_MS).toBeNull();
    expect(r.en_etapa_actual).toBe(46.2);
  });
});
