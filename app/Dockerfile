# syntax=docker/dockerfile:1

# Node LTS activa al momento de escribir esto (misma major que el entorno de
# desarrollo real, ver `node --version`). Alpine alcanza: ninguna dependencia
# de este proyecto compila nativo -- mysql2 y bcryptjs son JS puro, no hay
# addons que necesiten glibc/build-essential.
ARG NODE_VERSION=24-alpine

# ─── deps-prod ────────────────────────────────────────────────────────────
# node_modules de PRODUCCION unicamente, en su propio stage. Se instala con
# `npm ci` (nunca `npm install`): usa exclusivamente lo que dice
# package-lock.json -- exacto y reproducible, sin re-resolver versiones
# dentro de los rangos `^` de package.json (docs/11_auditoria_seguridad.md,
# S2-M-2). `drizzle-kit` vive en "dependencies" (no en devDependencies) a
# proposito: el release step de abajo corre `npm run db:migrate`, que lo
# necesita en runtime, no solo en desarrollo.
FROM node:${NODE_VERSION} AS deps-prod
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ─── build ──────────────────────────────────────────────────────────────
# Stage separado con TODAS las deps (necesita vite/esbuild/tailwind, que son
# devDependencies) solo para compilar. Este stage entero se descarta despues
# -- nada de esto llega a la imagen final.
FROM node:${NODE_VERSION} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ─── runtime ────────────────────────────────────────────────────────────
# Imagen final: solo node_modules de produccion + el bundle compilado + lo
# minimo que el release step necesita para migrar (drizzle.config.ts y las
# migraciones ya generadas -- NO db/schema.ts: verificado que `drizzle-kit
# migrate` no lo lee, solo aplica los .sql de db/migrations/ contra el
# journal, así que no hace falta cargar ningun archivo fuente del schema).
# Sin devDependencies: sin vite, sin esbuild, sin eslint, sin typescript.
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps-prod /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json drizzle.config.ts ./
COPY db/migrations ./db/migrations

# Sin EXPOSE de un puerto fijo: Railway asigna PORT dinamicamente (variable
# de entorno, ver boot.ts) y no lo lee de metadata de la imagen -- un EXPOSE
# hardcodeado aca seria puramente documental y podria confundir mas de lo
# que aclara. El puerto real se decide en runtime, nunca en build time.
#
# Sin ARG/ENV con secretos: cero valores de JWT_SECRET, GEMINI_API_KEY,
# GOOGLE_CLIENT_SECRET, DATABASE_URL, etc. en este Dockerfile o en la
# imagen resultante -- todos llegan como variables de entorno inyectadas
# por Railway en runtime (configuradas en el dashboard del proyecto),
# nunca horneados acá.
CMD ["node", "dist/boot.js"]
