import { describe, expect, it } from "vitest";
import { calcularTiemposEntreEtapas, construirContextoObjeciones } from "./ia";

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

// YA_PAGO_MENTOR se discontinuo con la migracion de dominio a LinkedIn, pero
// el Event Log es inmutable: pueden existir eventos historicos con ese valor.
// Lo importante es que NO se caigan del agregado -- si se ignoraran, no
// entrarian en conteo_por_tipo pero si en `total`, y los porcentajes dejarian
// de cerrar.
describe("construirContextoObjeciones con tipos discontinuados", () => {
  const objeciones = [
    { payload: { tipo: "PRECIO", detalle: "caro" } },
    { payload: { tipo: "PRECIO" } },
    { payload: { tipo: "YA_PAGO_MENTOR", detalle: "evento historico" } },
    { payload: { tipo: "OTRA" } },
  ];

  it("no expone el tipo discontinuado en la taxonomia vigente", () => {
    const ctx = construirContextoObjeciones(objeciones, "lifetime");
    expect(ctx.conteo_por_tipo).not.toHaveProperty("YA_PAGO_MENTOR");
  });

  it("cuenta el evento historico bajo OTRA en vez de descartarlo", () => {
    const ctx = construirContextoObjeciones(objeciones, "lifetime");
    expect(ctx.conteo_por_tipo.OTRA).toBe(2);
    expect(ctx.conteo_por_tipo.PRECIO).toBe(2);
  });

  it("los conteos siguen cerrando contra el total", () => {
    const ctx = construirContextoObjeciones(objeciones, "lifetime");
    const suma = Object.values(ctx.conteo_por_tipo).reduce((a, b) => a + b, 0);
    expect(suma).toBe(ctx.total);
    expect(ctx.total).toBe(4);
  });

  it("los porcentajes suman 1", () => {
    const ctx = construirContextoObjeciones(objeciones, "lifetime");
    const suma = Object.values(ctx.porcentaje_por_tipo).reduce((a, b) => a + b, 0);
    expect(suma).toBeCloseTo(1, 5);
  });

  it("muestra_detalle reporta el tipo ya mapeado, no el discontinuado", () => {
    const ctx = construirContextoObjeciones(objeciones, "lifetime");
    const historico = ctx.muestra_detalle.find((m) => m.detalle === "evento historico");
    expect(historico?.tipo).toBe("OTRA");
  });
});
