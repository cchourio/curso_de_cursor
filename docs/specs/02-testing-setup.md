# Spec 02 — Testing setup

## Objetivo

Configurar Vitest en todo el monorepo para que un solo comando (`pnpm test`) ejecute los tests de los cuatro paquetes, cada uno con el entorno adecuado (Node o navegador simulado).

## Contexto y dependencias

- **Producto:** herramienta interna de feature flags (PRD en `docs/prds/feature-flags-prd.md`, no es necesario leerlo).
- **Depende de:** spec 01. Estado esperado al empezar:
  - monorepo pnpm con `apps/web` (Next.js App Router, `src/app`, Tailwind v4), `apps/api` (Hono), `packages/db` (vacío) y `packages/domain`;
  - nombres de paquete `@ff/web`, `@ff/api`, `@ff/db` y `@ff/domain`, todos ESM y TypeScript `strict`;
  - `packages/domain/src/index.ts` exporta `ENVIRONMENTS`, `Environment` e `isEnvironment`;
  - `apps/api/src/app.ts` exporta `createApp()` (sin `listen`) con `GET /api/health`, que devuelve `{ status: "ok", environments }`;
  - `apps/web/src/app/page.tsx` muestra `<h1>Feature Flags</h1>` y la lista de ambientes.

## Alcance

### In

- Vitest en la raíz con un proyecto por paquete.
- Entorno `node` para `domain`, `db` y `api`, y entorno `jsdom` con React Testing Library para `web`.
- Un test de ejemplo real por paquete.
- Cobertura con `@vitest/coverage-v8`.
- Convenciones de ubicación y nombres de tests.

### Out

- Tests end-to-end con navegador real (Playwright, Cypress).
- Helpers de base de datos para tests (spec 03) y de app con dependencias (spec 04).
- Umbrales mínimos de cobertura y CI.

## Tareas en orden

1. Instalar en la raíz como dependencias de desarrollo: `vitest` (v3), `@vitest/coverage-v8`.
2. Crear `vitest.config.ts` en la raíz:

   ```ts
   import { defineConfig } from "vitest/config";
   export default defineConfig({
     test: {
       projects: ["packages/*", "apps/*"],
       coverage: { provider: "v8", reporter: ["text", "html"], exclude: ["**/*.config.*", "**/.next/**"] },
     },
   });
   ```
3. Añadir scripts en el `package.json` raíz: `test: vitest run`, `test:watch: vitest` y `test:coverage: vitest run --coverage`.
4. **`packages/domain` y `packages/db`:** `vitest.config.ts` con `defineProject({ test: { name: "<paquete>", environment: "node" } })` y script `test: vitest run`.
5. **`apps/api`:** igual que el paso 4, con `name: "api"`.
6. **`apps/web`:**
   - Dependencias de desarrollo: `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`, `@testing-library/dom`, `@testing-library/user-event` y `@testing-library/jest-dom`.
   - `vitest.config.ts` con `plugins: [react()]`, `name: "web"`, `environment: "jsdom"`, `setupFiles: ["./vitest.setup.ts"]` y un alias `@` hacia `./src` (el mismo que en `tsconfig`).
   - `vitest.setup.ts` importa `@testing-library/jest-dom/vitest` y llama a `cleanup()` en `afterEach`.
   - Añadir `"types": ["@testing-library/jest-dom"]` al tsconfig de la web, o una referencia equivalente, para que `pnpm typecheck` acepte `toBeInTheDocument`.
7. Tests de ejemplo, colocados junto al código:
   - `packages/domain/src/index.test.ts`: `ENVIRONMENTS` vale exactamente `["development","staging","production"]`; `isEnvironment("staging")` es `true` e `isEnvironment("prod")` es `false`.
   - `packages/db/src/index.test.ts`: un test trivial que importa el módulo sin errores. Lo reemplaza la spec 03.
   - `apps/api/src/app.test.ts`: `createApp().request("/api/health")` responde `200` con el body esperado, y `GET /api/no-existe` responde `404`.
   - `apps/web/src/app/page.test.tsx`: renderiza `<Page />` y comprueba que se ven el heading "Feature Flags" y el texto "production".
8. Documentar las convenciones en la sección "Testing" del `README.md` raíz (crearlo si no existe), con el contenido de las notas técnicas.

## Criterios de aceptación verificables

1. `pnpm test` en la raíz ejecuta los proyectos `domain`, `db`, `api` y `web`, los cuatro aparecen en la salida y todos los tests pasan con código de salida 0.
2. Si se cambia una aserción para que falle, `pnpm test` termina con un código distinto de 0 (verificarlo y revertir).
3. `pnpm --filter @ff/domain test` ejecuta solo los tests de `domain`.
4. `pnpm test:coverage` genera `coverage/index.html` en la raíz.
5. El test de la web corre en jsdom: `document` está definido y `toBeInTheDocument` funciona.
6. `pnpm typecheck` sigue terminando con código de salida 0.

## Notas técnicas

- **Convenciones:**
  - Los tests van junto al código, como `*.test.ts` o `*.test.tsx`.
  - Los tests de la API usan `app.request()` de Hono, nunca un servidor real ni puertos.
  - Los tests de la web mockean `fetch` (con `vi.stubGlobal("fetch", ...)`) y `next/navigation` (con `vi.mock`).
  - Los tests de `domain` no usan mocks: es lógica pura.
- Los paquetes se importan como código TypeScript fuente; Vitest los resuelve sin compilar gracias a los `exports` hacia `src/index.ts`.
- Si la página de la web pasa a ser un Server Component asíncrono en specs futuras, se testeará el componente cliente que contiene, no la página entera.
- Con Vitest v3, `test.projects` sustituye a `vitest.workspace.ts`. No crees ambos.
