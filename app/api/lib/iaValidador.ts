// Anti-alucinacion determinista -- docs/10_arquitectura_ia.md seccion 6,
// punto 3. No es otro LLM revisando al primero (eso agregaria costo y otra
// fuente de error, no lo resolveria) -- es parseo de numeros en la
// respuesta y comparacion contra los valores que realmente viajaron en el
// contexto. Heuristico a proposito: puede haber falsos positivos con
// numeros chicos usados como enumeracion ("las 3 acciones..."), por eso
// nunca bloquea -- solo advierte, el admin sigue viendo la respuesta.

function valoresNumericosDe(contexto: Record<string, unknown>): Set<string> {
  const valores = new Set<string>();
  for (const valor of Object.values(contexto)) {
    if (typeof valor !== "number") continue;
    valores.add(String(valor));
    valores.add(Math.round(valor).toString());
    // Las tasas (0-1) se citan en la respuesta como porcentaje, no como
    // fraccion -- se acepta tanto la forma redondeada como con un decimal.
    if (valor >= 0 && valor <= 1) {
      valores.add(Math.round(valor * 100).toString());
      valores.add((valor * 100).toFixed(1));
    }
  }
  return valores;
}

const REGEX_NUMERO = /\d+(?:[.,]\d+)?/g;

export function validarRespuesta(
  respuesta: string,
  contexto: Record<string, unknown>,
): { advertencia: string | null } {
  const aceptados = valoresNumericosDe(contexto);
  const sospechosos = new Set<string>();

  for (const match of respuesta.matchAll(REGEX_NUMERO)) {
    const crudo = match[0];
    const numero = Number(crudo.replace(",", "."));
    if (!Number.isFinite(numero)) continue;
    // Numeros chicos enteros son casi siempre enumeracion en lenguaje
    // natural ("las 3 acciones", "el 2do seguimiento"), no una cita de
    // dato -- se ignoran para no generar ruido de falsos positivos.
    if (numero < 10 && Number.isInteger(numero)) continue;

    const candidatos = [crudo.replace(",", "."), Math.round(numero).toString(), numero.toFixed(1)];
    const encontrado = candidatos.some((c) => aceptados.has(c));
    if (!encontrado) sospechosos.add(crudo);
  }

  if (sospechosos.size === 0) return { advertencia: null };
  return {
    advertencia: `Esta respuesta menciona valores que no pudimos verificar contra los datos: ${[...sospechosos].join(", ")}. Revisala antes de confiar en ella.`,
  };
}
