import { env } from "./env";
import type { AIProvider } from "./aiProvider";

// docs/10_arquitectura_ia.md seccion 7: fetch nativo, sin SDK -- mismo
// criterio que GoogleCalendarService (googleCalendarService.ts), que usa
// fetch para las 3 operaciones reales de la API de Google en vez de traer
// una libreria entera para eso. Ac lo mismo: un endpoint, un metodo.
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiProvider implements AIProvider {
  async completar(
    promptSistema: string,
    contexto: string,
    pregunta: string,
    temperatura = 0.2,
  ): Promise<string> {
    const url = `${GEMINI_API_BASE}/models/${env.geminiModel}:generateContent?key=${env.geminiApiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    });

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
