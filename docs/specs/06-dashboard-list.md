# Spec 06 — Dashboard y listado de flags

## Objetivo

Construir la pantalla principal (`/`): resumen de flags activas y obsoletas, panel de flags obsoletas con su responsable, y un listado filtrable que muestre de un vistazo el estado de cada flag por ambiente.

## Contexto y dependencias

- **Producto:** herramienta interna de feature flags. Cada flag tiene `owner` y `expiresAt` obligatorios para evitar flags olvidadas en el código.
- **Regla de obsolescencia (PRD RF-21).** Una flag **no archivada** es obsoleta si cumple al menos una de estas condiciones:
  - `EXPIRED`: su `expiresAt` (fecha `YYYY-MM-DD`) es anterior a la fecha UTC actual. Si vence hoy, todavía no es obsoleta.
  - `STALE_PRODUCTION`: en `production`, `rolloutPercentage` es 0 o 100 y su regla lleva **30 días o más** sin cambios (`now - environments.production.updatedAt >= 30 días`).
- **Estado actual (specs 01–05 hechas).** No las reimplementes.
  - `@ff/domain` exporta `ENVIRONMENTS`, `FlagState`, `EnvironmentRule` y los esquemas zod de flag y empresa. Todavía no exporta `FlagSummary`, `ObsoleteReason` ni `getObsolescence`: los añade esta spec.
  - `FlagState`: `{ key, name, description, owner, expiresAt, killSwitch, archived, environments: Record<Environment, EnvironmentRule>, createdAt, updatedAt }`.
  - `EnvironmentRule`: `{ enabled, rolloutPercentage, allowCompanies, denyCompanies, updatedAt }`.
  - El seed tiene tres flags, ninguna archivada: `checkout.new-flow`, `search.v2` y `legacy.banner`. Esta última vence el `2026-01-01`, su owner es `Equipo Growth` y en production está al 100 % desde hace 45 días. Con `clock = 2026-10-13T12:00:00.000Z` es la única obsoleta, así que el resumen es `activeCount: 3`, `archivedCount: 0`, `obsoleteCount: 1`.
  - `GET /api/admin/flags?q=&status=active|archived|all` devuelve hoy `{ items: FlagState[] }`. Esta spec cambia cada elemento a `FlagSummary`. `POST`, `GET /:key` y `PATCH` siguen devolviendo `FlagState`.
  - `createApp(deps)` inyecta `db`, `clock` y `auth`. `createTestApp()` devuelve `{ app, db, request }`. `request()` ya inicia sesión; `app.request` no.
  - La cookie de sesión es `ff_session`. En Next 16 la redirección vive en `apps/web/src/proxy.ts` (`export function proxy`), no en `middleware.ts`.
  - La web llama a la API con `apiFetch` (`apps/web/src/lib/api.ts`). El layout autenticado está en `src/app/(app)/layout.tsx`, la navegación en `src/components/nav-items.ts` (solo "Flags") y `src/app/(app)/page.tsx` es el contenido provisional que esta spec reemplaza.
- **Multitask.** Esta spec es la primera de la cola 06 → 07 → 08 → 11. Arráncala sola.
  - No depende de las specs 07, 08 ni 11, y ninguna de esas tres puede empezar mientras esta no esté en verde: la 07 edita el dashboard que creas aquí, y la 08 y la 11 escriben los mismos archivos de API que esta spec.
  - Archivos de esta spec: `packages/domain/src/obsolescence.ts`, el export nuevo en `packages/domain/src/index.ts`, el listado en `apps/api/src/services/flags.ts` y `apps/api/src/routes/flags.ts`, la ruta nueva `GET /api/admin/dashboard/summary` (móntala desde `apps/api/src/app.ts`), `src/app/(app)/page.tsx`, `src/components/dashboard/` y `src/components/flags/environment-badge.tsx`.
  - No toques `packages/domain/src/validation.ts`, `packages/db`, `src/components/reason-dialog.tsx`, `src/lib/flags-api.ts`, `src/app/(app)/flags/` ni `nav-items.ts`.
- **Depende de:**
  - **Spec 03:** tipos `FlagState` y `EnvironmentRule`, y el seed descrito arriba.
  - **Spec 04:** listado, `deps.clock`, errores `{ error: { code, message } }` y `createTestApp()`.
  - **Spec 05:** sesión en `/api/admin/*`, `apiFetch`, layout autenticado y la página provisional.

## Alcance

### In

- Funciones puras de obsolescencia en `@ff/domain`.
- Datos de obsolescencia y `lastChangedAt` en el listado de la API, más el filtro `obsolete`.
- Endpoint de resumen del dashboard.
- UI de resumen, panel de obsoletas, tabla con filtros sincronizados con la URL y estado vacío.

### Out

- Crear o editar flags y el kill switch (spec 07). En esta spec, el botón "Nueva flag" y los enlaces de fila solo navegan.
- Edición de targeting (spec 08).
- Paginación, ordenación por columnas y exportación.

## Tareas en orden

1. **Dominio (`packages/domain/src/obsolescence.ts`):**

   ```ts
   export type ObsoleteReason = "EXPIRED" | "STALE_PRODUCTION";
   export const STALE_DAYS = 30;
   export function getObsolescence(flag: FlagState, now: Date): ObsoleteReason[];
   export function getLastChangedAt(flag: FlagState): string; // máximo entre flag.updatedAt y los updatedAt de los 3 ambientes
   ```

   Una flag archivada devuelve siempre `[]`. El orden de los motivos es fijo: primero `EXPIRED` y después `STALE_PRODUCTION`.
2. **API: listado enriquecido.** `GET /api/admin/flags` devuelve `{ items: FlagSummary[] }`, con `FlagSummary = FlagState & { obsolescence: ObsoleteReason[]; lastChangedAt: string }`, calculado con `deps.clock()`. Exportar el tipo `FlagSummary` desde `@ff/domain`. Nuevo parámetro `obsolete=true`, que devuelve solo las flags con `obsolescence.length > 0` y se combina con `q` y `status`.
3. **API: resumen.** `GET /api/admin/dashboard/summary` responde `200`:

   ```json
   { "activeCount": 2, "archivedCount": 0, "obsoleteCount": 1,
     "obsolete": [{ "key": "legacy.banner", "name": "…", "owner": "Equipo Growth", "reasons": ["EXPIRED","STALE_PRODUCTION"], "lastChangedAt": "…" }] }
   ```

   Las obsoletas van ordenadas por `lastChangedAt` ascendente (las más antiguas primero).
4. **Web: página `src/app/(app)/page.tsx`.** Un componente cliente `FlagsDashboard` en `src/components/dashboard/` que contiene:
   - **Tarjetas de resumen:** "Flags activas" (`activeCount`) y "Obsoletas" (`obsoleteCount`, en color de aviso si es mayor que 0).
   - **Panel "Requieren limpieza":** visible solo si hay obsoletas. Cada una muestra key, owner, motivos en español ("Vencida" o "30+ días sin cambios en production") y la fecha del último cambio formateada `dd/mm/aaaa`. Cada fila enlaza a `/flags/<key>`.
   - **Filtros:**
     - texto ("Buscar por key o nombre", con debounce de 300 ms);
     - estado (Activas, Archivadas, Todas);
     - casilla "Solo obsoletas".

     Los filtros se reflejan en la query string (`?q=&status=&obsolete=true`) y se leen de ella al cargar, así que la URL es compartible.
   - **Tabla:** columnas Key (enlace a `/flags/<key>`), Nombre, Owner, Development, Staging, Production y Estado.
     - Las celdas de ambiente son badges: `Off` (gris) si `enabled = false`, `N %` (ámbar) si está habilitado con 0 < N < 100, `100 %` (verde) y `0 %` (gris claro) si está habilitado al 0 %.
     - En Estado, badges "Kill switch" (rojo), "Archivada" (gris) u "Obsoleta" (ámbar), según corresponda.
   - **Botón "Nueva flag":** enlace a `/flags/new`.
   - **Estado vacío:** "No hay flags que coincidan con los filtros", con un botón "Limpiar filtros". Si no existe ninguna flag, "Aún no hay flags" y un CTA "Crear la primera flag".
   - **Estados de carga y error:** skeleton o texto "Cargando…"; ante un error, un mensaje y un botón "Reintentar".
5. Extraer el badge de ambiente a `src/components/flags/environment-badge.tsx`, porque se reutiliza en las specs 07 y 08.
6. **Tests** de dominio, API y web que cubran los criterios de aceptación.

## Criterios de aceptación verificables

1. **Dominio:** con `now = 2026-10-13T12:00:00Z`:
   - `expiresAt = "2026-10-13"` no es `EXPIRED`; `"2026-10-12"` sí lo es.
   - Production al 100 % con `updatedAt` hace 29 días no es `STALE_PRODUCTION`; hace exactamente 30 días, sí.
   - Production al 30 % con `updatedAt` hace 90 días no es `STALE_PRODUCTION`.
   - Una flag archivada vencida devuelve `[]`.
2. **Dominio:** `getLastChangedAt` devuelve el mayor de los cuatro timestamps.
3. **API:** con el seed y `clock = 2026-10-13T12:00:00Z`, `GET /api/admin/flags?obsolete=true` devuelve solo `legacy.banner`, con `obsolescence: ["EXPIRED","STALE_PRODUCTION"]`.
4. **API:** `GET /api/admin/dashboard/summary` devuelve `activeCount: 3`, `archivedCount: 0`, `obsoleteCount: 1` y `obsolete[0].owner: "Equipo Growth"`.
5. **API:** sin sesión, ambos endpoints responden `401`.
6. **Web:** con datos mockeados, la tabla renderiza una fila por flag. `checkout.new-flow` muestra `100 %` en Development y Staging y `30 %` en Production.
7. **Web:** escribir "check" en el buscador llama, tras el debounce, a `/api/admin/flags?q=check&status=active` y actualiza la URL.
8. **Web:** cargar la página con `?obsolete=true` deja marcada la casilla y la petición incluye `obsolete=true`.
9. **Web:** con `obsoleteCount = 0`, el panel "Requieren limpieza" no se renderiza.
10. **Web:** si la respuesta es un error 500, se muestra el mensaje de error y "Reintentar" repite la petición.
11. `pnpm test` y `pnpm typecheck` terminan con código 0.

## Notas técnicas

- Calcula la obsolescencia en el servidor usando `deps.clock` para que los tests sean deterministas. La web no recalcula nada.
- Compara fechas `YYYY-MM-DD` como strings contra `now.toISOString().slice(0, 10)`: es correcto en UTC y evita problemas de zona horaria.
- Para los 30 días, usa la diferencia en milisegundos, `>= 30 * 24 * 60 * 60 * 1000`.
- Usa `useSearchParams` y `useRouter` de `next/navigation`. En tests, mockea ambos con `vi.mock("next/navigation")`.
- Formato de fechas en la UI: `Intl.DateTimeFormat("es", { day: "2-digit", month: "2-digit", year: "numeric" })`.
- El kill switch rápido desde la fila lo añade la spec 07. Deja la celda de Estado preparada para recibir un control adicional.
