import { env } from "./env";
import type { AIProvider } from "./aiProvider";

// docs/10_arquitectura_ia.md seccion 7: fetch nativo, sin SDK -- mismo
// criterio que GoogleCalendarService (googleCalendarService.ts), que usa
// fetch para las 3 operaciones reales de la API de Google en vez de traer
// una libreria entera para eso. Ac lo mismo: un endpoint, un metodo.
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// Techo de espera. El proceso es unico (mismo criterio que el scheduler de
// anomalias): sin timeout, un cuelgue del proveedor deja el request colgado
// para siempre y se van acumulando. 60s es holgado para una generacion con
// contexto grande y sigue acotando el peor caso.
const TIMEOUT_MS = 60_000;

export class GeminiProvider implements AIProvider {
  async completar(
    promptSistema: string,
    contexto: string,
    pregunta: string,
    temperatura = 0.2,
  ): Promise<string> {
    const url = `${GEMINI_API_BASE}/models/${env.geminiModel}:generateContent`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // La key va en header y NO en la query string: un `?key=...` queda
          // escrito en logs de proxy/CDN y en cualquier traza que registre la
          // URL. El header no se loguea por defecto en ningun lado.
          "x-goog-api-key": env.geminiApiKey,
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: promptSistema }] },
          contents: [
            {
              role: "user",
              parts: [{ text: `Contexto (JSON):\n${contexto}\n\nPregunta:\n${pregunta}` }],
            },
          ],
          generationConfig: { temperature: temperatura },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new Error(`El proveedor de IA no respondio en ${TIMEOUT_MS / 1000}s. Intenta de nuevo.`);
      }
      throw new Error("No se pudo contactar al proveedor de IA.");
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gemini rechazo la solicitud (${res.status}): ${body.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const texto = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!texto) {
      throw new Error("Gemini no devolvio texto en la respuesta.");
    }
    return texto;
  }
}
