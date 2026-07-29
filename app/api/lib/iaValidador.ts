// Anti-alucinacion determinista -- docs/10_arquitectura_ia.md seccion 6,
// punto 3. No es otro LLM revisando al primero (eso agregaria costo y otra
// fuente de error, no lo resolveria) -- es parseo de numeros en la
// respuesta y comparacion contra los valores que realmente viajaron en el
// contexto. Heuristico a proposito: puede haber falsos positivos con
// numeros chicos usados como enumeracion ("las 3 acciones..."), por eso
// nunca bloquea -- solo advierte, el admin sigue viendo la respuesta.

// Recursivo: los contextos reales no son planos (kpis_mes_actual.MSR.actual,
// anomalias_tiempo_activas[].horas_transcurridas, etc.) -- un escaneo de un
// solo nivel no encuentra nada de eso. Ver 99_deuda_tecnica.md si esto se
// vuelve a romper: se detecto tarde porque la primera verificacion real
// (resumen de objeciones con 0 datos) no citaba ningun numero real.
function valoresNumericosDe(valor: unknown, acumulador: Set<string> = new Set()): Set<string> {
  if (typeof valor === "number") {
    acumulador.add(String(valor));
    acumulador.add(Math.round(valor).toString());
    // Las tasas (0-1) se citan en la respuesta como porcentaje, no como
    // fraccion -- se acepta tanto la forma redondeada como con un decimal.
    if (valor >= 0 && valor <= 1) {
      acumulador.add(Math.round(valor * 100).toString());
      acumulador.add((valor * 100).toFixed(1));
    }
    return acumulador;
  }
  if (Array.isArray(valor)) {
    for (const item of valor) valoresNumericosDe(item, acumulador);
    return acumulador;
  }
  if (valor && typeof valor === "object") {
    for (const v of Object.values(valor)) valoresNumericosDe(v, acumulador);
    return acumulador;
  }
  return acumulador;
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
