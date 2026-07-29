import { describe, expect, it } from "vitest";
import { validarRespuesta } from "./iaValidador";

const CONTEXTO = {
  tipo_anomalia: "PRR_BAJO",
  setter_id: 7,
  tasa_medida: 0.4013452914798206,
  umbral_anomalia: 0.5,
  objetivo: null,
  numerador: 179,
  denominador: 446,
};

describe("validarRespuesta", () => {
  it("no advierte si la respuesta cita los numeros crudos del contexto", () => {
    const r = validarRespuesta(
      "La tasa medida es 0.4013452914798206 (179/446), por debajo del umbral de 0.5.",
      CONTEXTO,
    );
    expect(r.advertencia).toBeNull();
  });

  it("no advierte si una tasa se cita como porcentaje redondeado", () => {
    const r = validarRespuesta("La tasa es del 40% frente a un umbral del 50%.", CONTEXTO);
    expect(r.advertencia).toBeNull();
  });

  it("ignora numeros chicos usados como enumeracion", () => {
    const r = validarRespuesta("Se recomiendan 3 acciones para el 2do seguimiento.", CONTEXTO);
    expect(r.advertencia).toBeNull();
  });

  it("advierte si la respuesta cita un numero que no esta en el contexto", () => {
    const r = validarRespuesta("La tasa cayo un 87% respecto del mes pasado.", CONTEXTO);
    expect(r.advertencia).not.toBeNull();
    expect(r.advertencia).toContain("87");
  });
});
