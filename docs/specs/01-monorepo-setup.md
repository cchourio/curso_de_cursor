# Spec 01 — Monorepo setup

## Objetivo

Crear el esqueleto del monorepo con las cuatro piezas del sistema (`apps/web`, `apps/api`, `packages/db`, `packages/domain`) compilando, arrancando en local y compartiendo código entre paquetes.

## Contexto y dependencias

- **Producto:** herramienta interna de feature flags. El PRD completo está en `docs/prds/feature-flags-prd.md`, pero esta spec no requiere leerlo.
- **Dependencias:** ninguna. Es la primera spec y el repositorio parte vacío, salvo la carpeta `docs/`.
- **Stack obligatorio:**
  - Gestor: pnpm workspaces (pnpm ≥ 9). Runtime: Node.js ≥ 20.
  - TypeScript en modo `strict`, módulos ESM en todos los paquetes.
  - `apps/web`: Next.js (App Router, carpeta `src/`) y Tailwind CSS v4. Puerto 3000.
  - `apps/api`: Hono sobre `@hono/node-server`. Puerto 3001.
  - `packages/db`: se usará para Drizzle ORM con SQLite/libSQL. En esta spec solo se crea vacío.
  - `packages/domain`: lógica de negocio pura, sin I/O. La comparten la web y la API.
- **Nombres de paquete:** `@ff/web`, `@ff/api`, `@ff/db`, `@ff/domain`.

## Alcance

### In

- Workspace pnpm, TypeScript base compartido y scripts raíz.
- Cuatro paquetes con `package.json`, `tsconfig.json` y un punto de entrada.
- API Hono con `GET /api/health`.
- App Next.js con Tailwind y una página inicial.
- Proxy de la web hacia la API (rewrites) para que el navegador solo hable con el origen `localhost:3000`.
- Carga y validación de variables de entorno en la API.
- `.gitignore` y `.env.example`.

### Out

- Tests y Vitest (spec 02).
- Base de datos, esquema y migraciones (spec 03).
- Linting y formateo (ESLint, Prettier o Biome), CI y Docker.
- Build de producción optimizado: la API se ejecuta con `tsx` también en `start`.

## Tareas en orden

1. **Raíz del monorepo**
   - `pnpm-workspace.yaml` con `apps/*` y `packages/*`.
   - `package.json` raíz, privado, con `"type": "module"`, `engines.node >= 20` y estos scripts:
     - `dev`: `pnpm -r --parallel --filter "./apps/*" dev`
     - `build`: `pnpm -r build`
     - `typecheck`: `pnpm -r typecheck`
   - `tsconfig.base.json` con `strict`, `noUncheckedIndexedAccess`, `target: ES2022`, `module: ESNext`, `moduleResolution: Bundler`, `esModuleInterop`, `skipLibCheck`, `resolveJsonModule`, `isolatedModules` y `verbatimModuleSyntax: false`.
   - `.gitignore`: `node_modules`, `.next`, `dist`, `coverage`, `.env`, `data/*.db*`.
   - `.env.example` con `API_PORT=3001` y `API_URL=http://localhost:3001`.
2. **`packages/domain`**
   - `package.json` con `name: "@ff/domain"`, `"type": "module"`, `"exports": { ".": "./src/index.ts" }` y script `typecheck: tsc --noEmit`.
   - `src/index.ts` exporta lo siguiente:

     ```ts
     export const ENVIRONMENTS = ["development", "staging", "production"] as const;
     export type Environment = (typeof ENVIRONMENTS)[number];
     export function isEnvironment(value: string): value is Environment {
       return (ENVIRONMENTS as readonly string[]).includes(value);
     }
     ```
3. **`packages/db`**: mismo patrón que `domain`. `src/index.ts` contiene `export {};` como marcador hasta la spec 03.
4. **`apps/api`**
   - Dependencias: `hono`, `@hono/node-server`, `zod`, `dotenv`, `@ff/domain: workspace:*`. Dependencia de desarrollo: `tsx`.
   - `src/env.ts`: carga el `.env` de la raíz del repo con `dotenv` (ruta resuelta desde `import.meta.url`) y valida con zod `API_PORT` (número, por defecto 3001). Exporta `env` tipado. Si la validación falla, lanza un error con el nombre de la variable.
   - `src/app.ts`: exporta `createApp()`, que devuelve una instancia `Hono` **sin** llamar a `listen`, para poder testearla. Todas las rutas cuelgan de `/api`.
   - `GET /api/health` responde `200` con `{ "status": "ok", "environments": ENVIRONMENTS }`. La lista se importa de `@ff/domain` para probar que el código compartido funciona.
   - `src/index.ts`: `serve({ fetch: createApp().fetch, port: env.API_PORT })` y un log `API escuchando en http://localhost:<port>`.
   - Scripts: `dev: tsx watch src/index.ts`, `start: tsx src/index.ts`, `typecheck: tsc --noEmit`.
5. **`apps/web`**
   - Next.js (App Router) con `src/app`, TypeScript y Tailwind CSS v4 (`@tailwindcss/postcss` y `@import "tailwindcss";` en `src/app/globals.css`).
   - Dependencia `@ff/domain: workspace:*`.
   - `next.config.ts`:
     - `transpilePackages: ["@ff/domain"]`;
     - `rewrites()` que mapea `/api/:path*` a `${process.env.API_URL ?? "http://localhost:3001"}/api/:path*`.
   - `src/app/layout.tsx` con `<html lang="es">` y un título de metadata `Feature Flags`.
   - `src/app/page.tsx` muestra un `<h1>Feature Flags</h1>` y una lista con los valores de `ENVIRONMENTS` importados de `@ff/domain`.
   - Scripts: `dev: next dev -p 3000`, `build: next build`, `start: next start -p 3000`, `typecheck: tsc --noEmit`.
6. Ejecutar `pnpm install`, `pnpm typecheck` y `pnpm dev`, y verificar los criterios de aceptación.

## Criterios de aceptación verificables

1. `pnpm install` en la raíz termina sin errores.
2. `pnpm typecheck` termina con código de salida 0 en los cuatro paquetes.
3. Con `pnpm dev` levantado, `curl http://localhost:3001/api/health` responde `200` con `{"status":"ok","environments":["development","staging","production"]}`.
4. `curl http://localhost:3000/api/health` devuelve exactamente la misma respuesta (el rewrite funciona).
5. `http://localhost:3000` muestra el título "Feature Flags" y los tres ambientes, con estilos de Tailwind aplicados (por ejemplo, una clase `text-2xl font-bold` visible en el título).
6. Cambiar el texto de `ENVIRONMENTS` en `packages/domain` se refleja en la API y en la web sin reinstalar dependencias (verificarlo y revertir el cambio).
7. Arrancar la API con `API_PORT=abc` falla con un mensaje que menciona `API_PORT`.

## Notas técnicas

- Los paquetes internos se consumen como **código fuente TypeScript** (`exports` apuntando a `src/index.ts`), sin compilarlos. Por eso Next.js necesita `transpilePackages` y la API se ejecuta con `tsx`.
- `createApp()` y `index.ts` deben quedar separados: los tests de las specs siguientes usan `createApp().request(...)` sin abrir puertos. En la spec 04, `createApp` pasará a recibir dependencias (`createApp(deps)`).
- No añadas rutas fuera de `/api`, porque el rewrite de Next.js solo reenvía ese prefijo.
- Cada paquete tiene su propio `tsconfig.json`, que extiende de `../../tsconfig.base.json`. En `apps/web`, conserva las opciones que Next.js necesita (`jsx: preserve`, plugin `next`).
