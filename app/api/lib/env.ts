import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

export const env = {
  appId: required("APP_ID"),
  appSecret: required("APP_SECRET"),
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  googleClientId: required("GOOGLE_CLIENT_ID"),
  googleClientSecret: required("GOOGLE_CLIENT_SECRET"),
  googleRedirectUri: required("GOOGLE_REDIRECT_URI"),
  googleTokenEncryptionKey: required("GOOGLE_TOKEN_ENCRYPTION_KEY"),
  geminiApiKey: required("GEMINI_API_KEY"),
  // No es secreto, no usa required() -- un nombre de modelo puede quedar
  // obsoleto sin que el codigo cambie; se sobreescribe por env si hace falta
  // sin tocar geminiProvider.ts. "gemini-flash-latest" es un alias que
  // Google mantiene apuntando al modelo flash vigente -- se prefiere sobre
  // fijar una version puntual (confirmado necesario: "gemini-2.5-flash"
  // devolvio 404 "no longer available to new users" al verificar esto).
  geminiModel: process.env.GEMINI_MODEL || "gemini-flash-latest",
};
