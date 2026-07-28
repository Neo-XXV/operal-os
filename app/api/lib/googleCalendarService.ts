import { env } from "./env";
import { decrypt } from "./crypto";
import { getDb } from "../queries/connection";

// Sprint 5: integracion con Google Calendar. Solo scope Calendar
// (lectura/escritura) -- ver docs/02_reglas_de_negocio (1).md seccion 8.
// fetch nativo en vez del paquete googleapis: son 4 llamadas REST puntuales
// (token exchange, refresh, events.insert/patch/list), no justifica traer
// google-auth-library + gaxios para esto.

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
// Docs/02_reglas_de_negocio y fecha_call/fecha_pago ya asumen Argentina como
// unica zona horaria del negocio -- mismo criterio para el invite.
const TIMEZONE_AGENCIA = "America/Argentina/Buenos_Aires";

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

type EventoGoogleListado = { id: string; titulo: string; inicio: string; fin: string };

// Un access token por instancia, obtenido via forConnection() -- sin cache
// entre llamadas (bajo volumen, no vale la complejidad de invalidacion).
export class GoogleCalendarService {
  private accessToken: string;
  readonly calendarId: string;

  private constructor(accessToken: string, calendarId: string) {
    this.accessToken = accessToken;
    this.calendarId = calendarId;
  }

  static async forConnection(db: ReturnType<typeof getDb>): Promise<GoogleCalendarService | null> {
    const conexion = await db.query.googleCalendarConnections.findFirst();
    if (!conexion) return null;
    const refreshToken = decrypt(conexion.refreshTokenEncrypted);
    const { access_token } = await refreshAccessToken(refreshToken);
    return new GoogleCalendarService(access_token, conexion.calendarId);
  }

  async createEvent(input: {
    titulo: string;
    inicio: Date;
    fin: Date;
    invitados?: string[];
  }): Promise<{ googleEventId: string }> {
    const res = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${this.calendarId}/events?sendUpdates=all`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: input.titulo,
          start: { dateTime: input.inicio.toISOString(), timeZone: TIMEZONE_AGENCIA },
          end: { dateTime: input.fin.toISOString(), timeZone: TIMEZONE_AGENCIA },
          attendees: input.invitados?.map((email) => ({ email })),
        }),
      },
    );
    if (!res.ok) {
      throw new Error(`Google Calendar rechazo la creacion del evento (${res.status}).`);
    }
    const data = (await res.json()) as { id: string };
    return { googleEventId: data.id };
  }

  async updateEvent(googleEventId: string, input: { inicio: Date; fin: Date }): Promise<void> {
    const res = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${this.calendarId}/events/${googleEventId}?sendUpdates=all`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          start: { dateTime: input.inicio.toISOString(), timeZone: TIMEZONE_AGENCIA },
          end: { dateTime: input.fin.toISOString(), timeZone: TIMEZONE_AGENCIA },
        }),
      },
    );
    if (!res.ok) {
      throw new Error(`Google Calendar rechazo la edicion del evento (${res.status}).`);
    }
  }

  async listEvents(input: { timeMin: Date; timeMax: Date }): Promise<EventoGoogleListado[]> {
    const params = new URLSearchParams({
      timeMin: input.timeMin.toISOString(),
      timeMax: input.timeMax.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
    });
    const res = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${this.calendarId}/events?${params}`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );
    if (!res.ok) {
      throw new Error(`No se pudo listar eventos de Google Calendar (${res.status}).`);
    }
    const data = (await res.json()) as {
      items?: { id: string; summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }[];
    };
    return (data.items ?? []).map((ev) => ({
      id: ev.id,
      titulo: ev.summary ?? "(sin titulo)",
      inicio: ev.start?.dateTime ?? ev.start?.date ?? "",
      fin: ev.end?.dateTime ?? ev.end?.date ?? "",
    }));
  }
}
