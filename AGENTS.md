# [AGENTS.md](http://AGENTS.md)

Punto de entrada para cualquier agente o persona que trabaje en este repo. Léelo primero.

## Producto

**Feature Flags Dashboard**: herramienta interna para activar o desactivar features por **ambiente** (`development`, `staging`, `production`), por **empresa** (listas de permitidas y bloqueadas) y por **rollout porcentual**, sin hacer deploy. Cada cambio exige un motivo y queda auditado, con rollback en un clic. El acceso es con un único usuario demo.

- Qué se construye y por qué: [`docs/prds/feature-flags-prd.md`](docs/prds/feature-flags-prd.md)
- Cómo y en qué orden: [`docs/specs/`](docs/specs/)

## Stack

Monorepo con pnpm · TypeScript (strict) · Next.js App Router y Tailwind CSS · Hono · Drizzle ORM con SQLite/libSQL · Vitest.

## Estructura

```
apps/web         @ff/web     UI Next.js (:3000). Llama a /api/* por rewrite.
apps/api         @ff/api     API Hono (:3001). /api/admin, /api/v1, /api/auth.
packages/db      @ff/db      Esquema Drizzle, migraciones, seed, lecturas.
packages/domain  @ff/domain  Tipos, esquemas zod y evaluador. Lógica pura.
docs/prds        PRD
docs/specs       Specs 01–11, en orden de implementación
.cursor/rules    Contrato de ingeniería (ver abajo)
```
