# Spec 04 — API de feature flags (administración)

## Objetivo

Exponer en la API Hono los endpoints de administración para crear, leer, editar, archivar y desarchivar flags, activar el kill switch y gestionar el catálogo de empresas. Toda escritura sobre una flag debe exigir un motivo y quedar auditada en la misma transacción.

## Contexto y dependencias

- **Producto:** herramienta interna de feature flags. Una flag es booleana, se identifica por una `key` inmutable y tiene una regla de targeting por ambiente (`development`, `staging`, `production`). Las flags no se borran: se archivan. Cada cambio exige un motivo y genera una entrada de auditoría inmutable con el estado anterior y el nuevo.
- **Depende de:**
  - **Spec 01:** `apps/api` con `createApp()` en `src/app.ts`, `src/env.ts` (zod y dotenv, carga el `.env` raíz) y `src/index.ts` (`serve`). Rutas bajo `/api`; `GET /api/health` existe.
  - **Spec 02:** Vitest. Los tests de la API usan `app.request()`.
  - **Spec 03:** `@ff/db` exporta `Db`, `createDb`, `runMigrations`, `resolveDatabaseUrl`, `getFlagState`, `listFlagStates`, `listCompanies`, `seed` y `schema`. `@ff/db/testing` exporta `createTestDb()`.
    - Tablas: `companies`, `flags`, `flag_environments`, `flag_environment_companies` (`list` = `allow` o `deny`) y `audit_log` (`before_state` y `after_state` son JSON).
    - `@ff/domain` exporta `ENVIRONMENTS`, `Environment`, `isEnvironment`, `AUDIT_ACTIONS`, `AuditAction`, `FlagState`, `EnvironmentRule` y `Company`.
- **Autenticación:** en esta spec los endpoints son abiertos. La spec 05 los protegerá con sesión sin cambiar sus contratos.

## Alcance

### In

- Esquemas de validación zod compartidos en `@ff/domain`.
- Inyección de dependencias en `createApp(deps)` y migraciones automáticas al arrancar.
- Formato de error uniforme.
- Endpoints de flags (CRUD, archivado y kill switch) y de empresas.
- Escritura de auditoría transaccional.
- Helper `createTestApp()` para tests.

### Out

- Edición de reglas de targeting por ambiente (spec 08).
- Lectura del historial y rollback (spec 11).
- Evaluación de flags (spec 09).
- Login y sesiones (spec 05).
- Filtro y datos de obsolescencia (spec 06).
- Paginación del listado (el volumen previsto es de menos de 500 flags).

## Tareas en orden

1. **`packages/domain/src/validation.ts`** (con zod; reexportar desde `index.ts`):
   - `flagKeySchema`: string que cumple `^[a-z0-9][a-z0-9_.-]{2,63}$`.
   - `reasonSchema`: string con `trim()` y mínimo 5 caracteres; mensaje: "El motivo debe tener al menos 5 caracteres".
   - `isoDateSchema`: string `YYYY-MM-DD` que además es una fecha real del calendario (rechaza `2026-02-30`).
   - `createFlagInputSchema`: `{ key, name (trim, 1..100), description? (trim, máx. 500, "" se convierte en null), owner (trim, 1..100), expiresAt, reason }`.
   - `updateFlagInputSchema`: `{ name?, description?, owner?, expiresAt?, reason }`, con al menos un campo además de `reason`.
   - `killSwitchInputSchema`: `{ enabled: boolean, reason }`.
   - `reasonOnlyInputSchema`: `{ reason }`.
   - `companyIdSchema`: `^[a-z0-9][a-z0-9_-]{1,63}$`.
   - `createCompanyInputSchema`: `{ id, name (trim, 1..100) }`.
   - `updateCompanyInputSchema`: `{ name }`.
2. **Dependencias de la app:** cambiar la firma a `createApp(deps: AppDeps)`, con `AppDeps = { db: Db; clock?: () => Date }`. `clock` vale por defecto `() => new Date()`. Inyectar `deps` en el contexto de Hono (`c.var` o un closure).
3. **Arranque (`src/index.ts`):** añadir `DATABASE_URL` opcional a `env.ts`. Crear la base de datos con `createDb(resolveDatabaseUrl(env.DATABASE_URL))`, ejecutar `runMigrations` y luego `serve`.
4. **Errores (`src/http/errors.ts`):**
   - Clase `ApiError(status, code, message, details?)`.
   - Un `app.onError` que serializa `{ error: { code, message, details? } }`.
   - Un `ZodError` se convierte en `400 VALIDATION_ERROR`, con `details` igual a `[{ path, message }]`.
   - Cualquier otro error devuelve `500 INTERNAL_ERROR`, sin exponer la traza.
   - `app.notFound` devuelve `404 NOT_FOUND`.
5. **Servicio de flags (`src/services/flags.ts`).** Cada mutación:
   - abre una transacción;
   - lee el estado actual con `getFlagState`;
   - aplica el cambio;
   - actualiza `flags.updated_at` con `clock()`;
   - lee el estado nuevo;
   - inserta en `audit_log` `{ flag_key, action, reason, before_state, after_state, created_at }`.

   Si algo falla, no se persiste nada.
6. **Endpoints de flags** (todas las respuestas de flag devuelven `FlagState` en JSON):

   | Método y ruta | Body | Éxito | Errores |
   |---|---|---|---|
   | `GET /api/admin/flags?q=&status=` | — | `200 { items: FlagState[] }`, ordenados por key | `400` si `status` no es válido |
   | `GET /api/admin/flags/:key` | — | `200 FlagState` | `404` |
   | `POST /api/admin/flags` | `createFlagInputSchema` | `201 FlagState` | `400`, `409 CONFLICT` si la key ya existe |
   | `PATCH /api/admin/flags/:key` | `updateFlagInputSchema` | `200 FlagState` | `400`, `400 NO_CHANGES`, `404`, `409 FLAG_ARCHIVED` |
   | `POST /api/admin/flags/:key/archive` | `reasonOnlyInputSchema` | `200 FlagState` | `404`, `409 CONFLICT` si ya está archivada |
   | `POST /api/admin/flags/:key/unarchive` | `reasonOnlyInputSchema` | `200 FlagState` | `404`, `409 CONFLICT` si no está archivada |
   | `POST /api/admin/flags/:key/kill-switch` | `killSwitchInputSchema` | `200 FlagState` | `400 NO_CHANGES` si ya tiene ese valor, `404`, `409 FLAG_ARCHIVED` |

   Detalles del listado y de la creación:
   - `q` filtra por subcadena en `key` o `name`, sin distinguir mayúsculas.
   - `status` admite `active` (por defecto), `archived` o `all`.
   - `POST` crea la flag con `killSwitch = false` y `archived = false`, y sus tres ambientes con `enabled = false`, `rolloutPercentage = 0` y listas vacías.
   - En `POST`, `expiresAt` debe ser hoy o una fecha futura según `clock()`; si no, devuelve `400 VALIDATION_ERROR`.
7. **Acciones de auditoría:**
   - creación: `create`, con `before_state = null`;
   - edición: `update`;
   - archivado y desarchivado: `archive` y `unarchive`;
   - kill switch: `kill_switch_on` o `kill_switch_off`.
8. **Endpoints de empresas** (sin auditoría):
   - `GET /api/admin/companies` responde `200 { items: Company[] }`, ordenadas por nombre.
   - `POST /api/admin/companies` con `createCompanyInputSchema` responde `201 Company`, o `409 CONFLICT` si el id existe.
   - `PATCH /api/admin/companies/:id` con `updateCompanyInputSchema` responde `200 Company` o `404`.
   - No hay endpoint de borrado.
9. **Helper de tests (`src/test/helpers.ts`):** `createTestApp(overrides?: Partial<AppDeps>)` crea una base de datos con `createTestDb()` y devuelve `{ app, db, request }`. En esta spec, `request(path, init)` es `app.request` con `Content-Type: application/json` cuando hay body. La spec 05 hará que añada la cookie de sesión.
10. **Tests** de los endpoints en `src/routes/*.test.ts`, que cubran los criterios de aceptación.

## Criterios de aceptación verificables

1. `POST /api/admin/flags` con datos válidos responde `201`. La flag tiene los tres ambientes deshabilitados al 0 % y existe una fila en `audit_log` con `action = "create"`, `before_state = null` y el motivo enviado.
2. Repetir el `POST` con la misma key responde `409` con `error.code = "CONFLICT"`.
3. Un `POST` con key `Checkout` (mayúscula), `ab` (demasiado corta) o `-abc` responde `400 VALIDATION_ERROR`, con `details[0].path` igual a `"key"`.
4. Un `POST` o `PATCH` sin motivo, o con `"abc"`, responde `400 VALIDATION_ERROR` con `path` igual a `"reason"`.
5. Con `clock` fijado en `2026-10-13`, un `POST` con `expiresAt: "2026-10-12"` responde `400`, y con `"2026-10-13"` responde `201`.
6. `PATCH` con `{ name: "Nuevo", reason: "Renombrar flag" }` responde `200`. La auditoría registra `action = "update"`, con `before_state.name` igual al nombre anterior y `after_state.name` igual a `"Nuevo"`.
7. `PATCH` con los mismos valores actuales responde `400 NO_CHANGES` y no crea ninguna entrada de auditoría.
8. `archive` responde `200` con `archived = true`. A partir de ahí, `PATCH` y `kill-switch` responden `409 FLAG_ARCHIVED` y un segundo `archive` responde `409 CONFLICT`. `unarchive` lo revierte.
9. `kill-switch` con `{ enabled: true }` responde `200` con `killSwitch = true` y la auditoría `kill_switch_on`. Repetirlo responde `400 NO_CHANGES`.
10. `GET /api/admin/flags` devuelve solo flags no archivadas; `?status=archived` solo archivadas; `?status=all` todas; y `?q=CHECK` encuentra `checkout.new-flow`.
11. `GET /api/admin/flags/no-existe` responde `404` con `error.code = "NOT_FOUND"`.
12. Si la inserción de auditoría falla (simulándolo con un mock que lanza un error), la flag no queda modificada: transaccionalidad verificada.
13. Empresas: `POST` responde `201`; un id duplicado, `409`; `PATCH` de una inexistente, `404`; y `GET` devuelve la lista ordenada por nombre.
14. `pnpm dev` arranca la API sobre `data/flags.db` y aplica las migraciones automáticamente aunque el archivo no exista.
15. `pnpm test` y `pnpm typecheck` terminan con código 0.

## Notas técnicas

- `before_state` y `after_state` guardan siempre el `FlagState` **completo** serializado con `JSON.stringify`. La spec 11 usa esos snapshots para mostrar diferencias y hacer rollback, así que no guardes solo los campos que cambiaron.
- La comprobación de "sin cambios" compara el estado nuevo y el anterior ignorando `updatedAt` y `createdAt`.
- Mantén las rutas en archivos separados (`src/routes/flags.ts`, `src/routes/companies.ts`) montados en `createApp`, para que las specs 05, 08, 09 y 11 añadan middleware y rutas sin reescribir.
- Valida los bodies con `@hono/zod-validator` o con `schema.parse` dentro del handler. En ambos casos, el error debe salir con el formato de la tarea 4.
- No añadas un `DELETE` de flags ni de empresas: el PRD lo excluye.
