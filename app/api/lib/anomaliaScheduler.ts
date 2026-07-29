import { getDb } from "../queries/connection";
import { evaluarAnomalias } from "../routers/anomalia";
import { ANOMALIA_CONFIG } from "./anomaliaConfig";

// Barrido periodico en el mismo proceso -- no hay infraestructura de
// cron/job scheduler en el proyecto (Hono + tRPC, proceso unico). Corrida
// inmediata al bootear (no esperar 1h para la primera) y despues cada
// ANOMALIA_CONFIG.intervaloEvaluacionMs. Limitacion aceptada si el proceso
// se reinicia o corre en mas de una instancia -- ver docs/99_deuda_tecnica.md.
export function iniciarSchedulerAnomalias() {
  const correr = () => {
    evaluarAnomalias(getDb()).catch((err) => {
      console.error("[anomalias] error en la evaluacion periodica:", err);
    });
  };
  correr();
  setInterval(correr, ANOMALIA_CONFIG.intervaloEvaluacionMs);
}
