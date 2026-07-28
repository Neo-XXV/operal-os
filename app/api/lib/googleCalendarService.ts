import { env } from "./env";

// Sprint 5: integracion con Google Calendar. Solo scope Calendar
// (lectura/escritura) -- ver docs/02_reglas_de_negocio (1).md seccion 8.
// fetch nativo en vez del paquete googleapis: son 4 llamadas REST puntuales
// (token exchange, refresh, events.insert/patch/list), no justifica traer
// google-auth-library + gaxios para esto.

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
};

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: env.googleRedirectUri,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google rechazo el intercambio de codigo por tokens (${res.status}).`);
  }
  return res.json() as Promise<TokenResponse>;
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (body.includes("invalid_grant")) {
      throw new Error("La conexion con Google Calendar vencio o fue revocada. Reconecta desde /calendario.");
    }
    throw new Error(`No se pudo renovar el token de Google (${res.status}).`);
  }
  return res.json() as Promise<TokenResponse>;
}
