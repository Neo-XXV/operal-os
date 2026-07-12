# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

OPERAL OS — a lead-tracking / commercial-pipeline system for a single agency (single-tenant, V1). Setters work leads through a fixed funnel; managers/admins assign leads and manage users. The entire app lives under [app/](app/); the repo root only adds [docs/](docs/).

## Governing rules (read before changing behavior)

[docs/00_prompt_maestro_kimi.md](docs/00_prompt_maestro_kimi.md) sets binding rules for how this codebase is to be developed. They apply to you as much as to the original implementer:

- The docs in `docs/` are **contractual**. Code must conform to them, not the other way around. Don't modify defined behavior without approval.
- **Do not add unspecified behavior** — validations, automations, buttons, states, or events not called out in the docs. Propose it as a question instead of implementing it on initiative.
- **Do not simplify the domain model** for implementation convenience (e.g. don't add a cached "current stage" column to `leads` — see Event Sourcing below). Propose simplifications as alternatives, don't implement them unasked.
- If you find a **contradiction** between docs, or between an instruction and the docs, ask — never resolve silently by inference. If forced to pick, precedence is `02_reglas_de_negocio` > `03_catalogo_eventos` > `08_modelo_de_datos` > `01_dia_en_la_vida...` (context only, not authoritative) — but still flag that you found the contradiction.
- If UI/UX/naming information is missing, ask rather than invent it.
- Work is scoped by sprint. Sprint 1 (current): Login, Usuarios, Crear Lead, Event Log. Don't build business features outside the current sprint's declared scope.

Key business-rule docs:
- [docs/02_reglas_de_negocio (1).md](docs/02_reglas_de_negocio%20(1).md) — funnel states (`A → MS → B → C → D`, strictly sequential, no skipping, no going back), discard rules and valid `motivo` values, immutability of events.
- [docs/03_catalogo_eventos.md](docs/03_catalogo_eventos.md) — the authoritative catalog of every event type, its payload shape, and the 4-point test for whether a new event type is even allowed to exist.

## Architecture

### Event sourcing is the core design

The `leads` table ([app/db/schema.ts](app/db/schema.ts)) intentionally stores almost nothing — no current stage, no assigned setter, no created-at. Every "current state" fact is a **projection computed by reading the `eventos` table**, never a stored field. `eventos` rows are immutable (insert-only, never updated or deleted).

When adding a feature that needs to know "what's true right now" about a lead (current setter, current funnel stage, discarded?), follow the existing pattern in [app/api/routers/lead.ts](app/api/routers/lead.ts) (`obtenerProyecciones`) and [app/api/routers/event.ts](app/api/routers/event.ts) (`obtenerSetterActual`, `obtenerEstadoActual`, `verificarLeadActivo`): query the latest relevant event and derive the value, don't add a mutable column. Any cache/materialized view added later must be fully reconstructable from `eventos`.

Event types are the closed enum in `eventos.tipo` ([app/db/schema.ts](app/db/schema.ts)): `LEAD_CREADO`, `LEAD_ASIGNADO`, `ESTADO_CAMBIADO`, `SEGUIMIENTO_ENVIADO`, `RESPUESTA_RECIBIDA`, `OBJECION_REGISTRADA`, `LEAD_DESCARTADO`, `NOTA_AGREGADA`. Business-rule validation for each type (funnel transition legality, discard reasons, "no events after discard") lives in [app/api/routers/event.ts](app/api/routers/event.ts)'s `create` mutation — new validation belongs there, gated by `input.tipo`.

### Backend: Hono + tRPC, single process

- [app/api/boot.ts](app/api/boot.ts) is the entrypoint: a Hono app mounts the tRPC handler at `/api/trpc/*`. In production it also serves the built SPA ([app/api/lib/vite.ts](app/api/lib/vite.ts)); in dev, Vite's dev server proxies through `@hono/vite-dev-server` (see [app/vite.config.ts](app/vite.config.ts)) so `npm run dev` serves both frontend and API on port 3000.
- [app/api/router.ts](app/api/router.ts) composes the root router from [app/api/routers/](app/api/routers/) (`auth`, `user`, `lead`, `event`). Add new domains as a new file there.
- [app/api/middleware.ts](app/api/middleware.ts) defines the procedure tiers: `publicQuery` (no auth), `authedQuery` (any logged-in user), `adminQuery` (ADMIN/MANAGER — Sprint 1 treats these as equivalent), `setterQuery` (SETTER only). Pick the narrowest one that fits; don't hand-roll auth checks inside a procedure body.
- [app/api/context.ts](app/api/context.ts) resolves the JWT bearer token into `ctx.user` per-request. Roles: `SETTER`, `MANAGER`, `ADMIN`.
- DB access always goes through `getDb()` in [app/api/queries/connection.ts](app/api/queries/connection.ts) (Drizzle ORM, MySQL via `mysql2`, PlanetScale mode — no explicit FK constraints, joins done in app code via `relations.ts`).
- Setters see a role-filtered view of leads/events (only what's assigned to them); this filtering happens in the router, not the DB layer — see the `ctx.user.rol === "SETTER"` branches in `lead.ts`/`event.ts`.

### Frontend: React 19 + Vite + tRPC + shadcn/ui

- [app/src/App.tsx](app/src/App.tsx) — route table (`react-router`). Pages live in [app/src/pages/](app/src/pages/).
- [app/src/providers/trpc.tsx](app/src/providers/trpc.tsx) — tRPC client/React Query setup. Auth token is a JWT in `localStorage` under `operal_token`, sent as `Authorization: Bearer`.
- [app/src/hooks/useAuth.ts](app/src/hooks/useAuth.ts) — wraps `trpc.auth.me`; exposes `isAdmin`/`isSetter`/`logout`.
- `AppRouter` type is imported directly from `../../api/router` into the frontend — the tRPC contract is shared by TypeScript project reference, not a generated client. Backend route changes are immediately type-checked against frontend usage.
- UI components in [app/src/components/ui/](app/src/components/ui/) are shadcn/ui primitives (Radix + Tailwind) — treat them as generated/vendored; extend by composition in page/feature code rather than editing them unless fixing a real bug in the primitive itself.

### Shared code and path aliases

Both frontend and backend resolve `@db/*` → [app/db/](app/db/) and `@contracts/*` → [app/contracts/](app/contracts/) (see `paths` in [app/tsconfig.json](app/tsconfig.json) and `resolve.alias` in [app/vite.config.ts](app/vite.config.ts)). `@/*` → `app/src/*` is frontend-only. [app/contracts/errors.ts](app/contracts/errors.ts) defines a small tagged `AppError` shape (`Errors.badRequest`, `.unauthorized`, etc.) for cross-boundary error typing.

## Commands

All commands run from [app/](app/) (there is no root `package.json`).

```bash
cd app
npm run dev          # Vite dev server + API on http://localhost:3000
npm run build         # vite build (frontend) + esbuild bundle of api/boot.ts -> dist/
npm run start          # run the production build (dist/boot.js)
npm run check           # tsc -b (project references: app/node/server tsconfigs)
npm run lint              # eslint .
npm run format             # prettier --write .
npm test                    # vitest run
npm run db:generate           # drizzle-kit generate (new migration from schema.ts diff)
npm run db:migrate              # drizzle-kit migrate (apply pending migrations)
npm run db:push                   # drizzle-kit push (dev-only: push schema directly, no migration file)
```

Run a single test file: `npx vitest run api/path/to/file.test.ts`. Tests are configured to match `api/**/*.test.ts` / `api/**/*.spec.ts` ([app/vitest.config.ts](app/vitest.config.ts)) — none exist yet.

Requires a `.env` in `app/` (see [app/.env.example](app/.env.example)): `APP_ID`, `APP_SECRET`, `DATABASE_URL` (MySQL), and `JWT_SECRET` (used in [app/api/lib/env.ts](app/api/lib/env.ts) / [app/api/context.ts](app/api/context.ts) — note it's read as `JWT_SECRET` even though it's absent from `.env.example`).
