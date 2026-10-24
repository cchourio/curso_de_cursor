# Spec 11 — Historial, revisión de cambios y rollback

## Objetivo

Mostrar el historial de auditoría de cada flag con las diferencias entre el estado anterior y el nuevo, y permitir restaurar en un clic el estado previo a cualquier cambio. El rollback queda auditado y el registro sigue siendo inmutable.

## Contexto y dependencias

- **Producto:** herramienta interna de feature flags. PRD:
  - **RF-18:** toda creación, modificación, archivado, cambio de kill switch y rollback exige un motivo y queda auditada con el estado anterior completo y el nuevo completo.
  - **RF-19:** la auditoría no se puede editar ni borrar.
  - **RF-20:** se puede restaurar el estado anterior de cualquier entrada con una sola acción (más el motivo); el rollback genera su propia entrada.

  "Review" en esta spec significa **revisar los cambios**, no un flujo de aprobación (el PRD lo excluye).
- **Depende de:**
  - **Spec 03:**
    - Tabla `audit_log`: `id` (autoincremental), `flag_key`, `action` (uno de `create`, `update`, `archive`, `unarchive`, `kill_switch_on`, `kill_switch_off`, `targeting_update` o `rollback`), `reason`, `before_state` (JSON `FlagState` o `null` en `create`), `after_state` (JSON `FlagState`) y `created_at`. Índice en `(flag_key, id)`.
    - Las migraciones se generan con `pnpm db:generate` (drizzle-kit, carpeta `packages/db/drizzle/`).
    - `getFlagState(db, key)`.
    - `FlagState` = `{ key, name, description, owner, expiresAt, killSwitch, archived, environments: Record<"development"|"staging"|"production", { enabled, rolloutPercentage, allowCompanies, denyCompanies, updatedAt }>, createdAt, updatedAt }`.
  - **Spec 04:**
    - Patrón de mutación: transacción, estado anterior, cambio, `flags.updated_at`, estado nuevo y auditoría.
    - `ApiError` con el formato `{ error: { code, message, details? } }`, `reasonOnlyInputSchema` y `reasonSchema` en `@ff/domain`, `deps.clock` y `createTestApp()` (devuelve `{ app, db, request }`, y `request` ya lleva la sesión).
  - **Spec 05:** `/api/admin/*` con sesión. En la web, `apiFetch` y las páginas bajo `src/app/(app)/`.
  - **Spec 07:** `ReasonDialog` (`src/components/reason-dialog.tsx`, props `{ open, title, description?, confirmLabel, tone?, onConfirm(reason), onCancel }`), toasts, `src/lib/flags-api.ts` y un enlace "Historial" en el detalle que apunta a `/flags/<key>/history`.
  - **Spec 08:** `flag_environments.updated_at` se actualiza solo en el ambiente que cambia. La spec 06 lo usa para detectar flags obsoletas.

## Alcance

### In

- Función de diferencias `diffFlagStates` en `@ff/domain`.
- Columna `rollback_of_id` con su migración.
- Endpoint paginado de historial.
- Endpoint de rollback.
- Garantía de que no existen rutas para modificar la auditoría.
- Página `/flags/[key]/history` con línea de tiempo, diferencias y botón de restaurar con vista previa.

### Out

- Historial global de todas las flags y filtros por acción o fecha.
- Exportar la auditoría.
- Deshacer un rollback de forma especial: es una entrada más y se puede restaurar como cualquier otra.
- Aprobaciones y comentarios.

## Tareas en orden

1. **Dominio (`packages/domain/src/diff.ts`):**

   ```ts
   export interface FieldChange { path: string; before: unknown; after: unknown }
   export function diffFlagStates(before: FlagState | null, after: FlagState): FieldChange[];
   ```

   - Compara `name`, `description`, `owner`, `expiresAt`, `killSwitch` y `archived`, y por cada ambiente `enabled`, `rolloutPercentage`, `allowCompanies` y `denyCompanies`.
   - Los paths tienen la forma `name` o `environments.production.rolloutPercentage`.
   - Ignora `createdAt`, `updatedAt` y `environments.*.updatedAt`.
   - Las listas se comparan como conjuntos: el mismo contenido en otro orden no cuenta como cambio.
   - Si `before` es `null`, devuelve un único cambio con `path: "*"`, `before: null` y `after` igual al estado completo.
   - El orden de salida es fijo: primero los campos generales y luego los ambientes en el orden de `ENVIRONMENTS`.
2. **Migración:** añadir a `audit_log` la columna `rollback_of_id` (integer, nullable, que referencia `audit_log.id`). Generarla con `pnpm db:generate` y commitearla.
3. **API: `GET /api/admin/flags/:key/audit?limit=&cursor=`:**
   - `limit` va de 1 a 100 y vale 50 por defecto. `cursor` es un `id`: se devuelven entradas con `id < cursor`.
   - Responde `200 { items: AuditEntry[], nextCursor: number | null }`, ordenadas por `id` descendente.
   - `AuditEntry` = `{ id, flagKey, action, reason, createdAt, before: FlagState | null, after: FlagState, changes: FieldChange[], rollbackOfId: number | null }`. `changes` se calcula con `diffFlagStates(before, after)`.
   - Si la flag no existe, `404`. Exportar el tipo `AuditEntry` desde `@ff/domain`.
4. **API: `POST /api/admin/flags/:key/rollback`**, con body `{ auditId: number, reason }`:
   1. Si el body no es válido, `400 VALIDATION_ERROR`.
   2. Si la flag no existe, o la entrada no existe o pertenece a otra flag, `404`.
   3. Si `before_state` de la entrada es `null` (una entrada `create`), `400 ROLLBACK_NOT_AVAILABLE`, con el mensaje "No hay estado anterior que restaurar".
   4. Si `diffFlagStates(current, target)` está vacío, `400 NO_CHANGES`.
   5. En una transacción, escribe el estado `target = before_state` (incluido `archived`, por lo que **está permitido aunque la flag esté archivada**):
      - campos generales y `kill_switch` en `flags`, con `updated_at = clock()`;
      - para cada ambiente con cambios, `enabled`, `rollout_percentage`, las listas y `updated_at = clock()`; los ambientes sin cambios conservan su `updated_at`.
   6. Inserta la auditoría con `action: "rollback"`, `before_state` igual al estado actual, `after_state` igual al estado restaurado leído de la base de datos, `rollback_of_id = auditId` y el motivo.
   7. Responde `200 FlagState`.

   Si alguna empresa del estado objetivo ya no existe en el catálogo, responde `400 UNKNOWN_COMPANY`. No debería ocurrir, porque las empresas no se borran, pero se valida igualmente.
5. **Inmutabilidad:** no registrar ninguna ruta `PUT`, `PATCH` ni `DELETE` sobre `/api/admin/flags/:key/audit*`. Un test lo comprueba.
6. **Web: cliente.** Añadir a `flags-api.ts` las funciones `getAudit(key, cursor?)` y `rollback(key, auditId, reason)`.
7. **Web: página `src/app/(app)/flags/[key]/history/page.tsx`**, con un componente cliente `FlagHistory`:
   - Cabecera con la key, un enlace "Volver al detalle" y el estado actual resumido.
   - Una **línea de tiempo** de las más recientes a las más antiguas. Cada entrada muestra:
     - la acción en español:

       | action | Etiqueta |
       |---|---|
       | `create` | Creada |
       | `update` | Información editada |
       | `archive` | Archivada |
       | `unarchive` | Desarchivada |
       | `kill_switch_on` | Kill switch activado |
       | `kill_switch_off` | Kill switch desactivado |
       | `targeting_update` | Targeting modificado |
       | `rollback` | Rollback |

     - la fecha y hora local (`Intl.DateTimeFormat("es", { dateStyle: "short", timeStyle: "short" })`);
     - el motivo, entre comillas;
     - en un rollback, el texto "Restaura el estado previo a la entrada #<rollbackOfId>";
     - la **lista de cambios**: una fila por `FieldChange`, con una etiqueta legible (por ejemplo, `environments.production.rolloutPercentage` se muestra como "Production · Rollout") y el valor anterior tachado y el nuevo resaltado. Las listas se muestran como diferencia: `+initech`, `−globex`. En `create`, el texto "Estado inicial" y un resumen.
   - En cada entrada con `before` distinto de `null`, un botón **"Restaurar estado anterior"**. Abre `ReasonDialog` con `tone="danger"` y, como `description`, una **vista previa** con la lista de lo que cambiará: `diffFlagStates(estadoActual, entry.before)`. Si la vista previa está vacía, el botón aparece deshabilitado con el tooltip "El estado actual ya coincide".
   - Al confirmar, se ejecuta el rollback, se muestra el toast "Estado restaurado" y se recarga la primera página del historial (la nueva entrada aparece arriba).
   - Un botón **"Cargar más"** mientras `nextCursor` no sea `null`.
8. **Tests** de dominio, API y web que cubran los criterios de aceptación.

## Criterios de aceptación verificables

1. **Dominio:** al cambiar solo `environments.production.rolloutPercentage` de 10 a 80, `diffFlagStates` devuelve exactamente `[{ path: "environments.production.rolloutPercentage", before: 10, after: 80 }]`.
2. **Dominio:** con `allowCompanies` igual a `["a","b"]` y luego `["b","a"]`, no hay cambios. Si solo cambian `updatedAt`, tampoco.
3. **API, escenario PRD #9:** sobre una flag, con production al 10 % y luego al 80 % (dos `PUT` de targeting), el rollback de la entrada del cambio 10 → 80 deja production al 10 %. Se crea una entrada nueva con `action: "rollback"`, `rollback_of_id` igual a esa entrada y `changes` igual a `[{ path: "environments.production.rolloutPercentage", before: 80, after: 10 }]`.
4. **API:** después del rollback del punto 3, `environments.staging.updatedAt` no ha cambiado y `environments.production.updatedAt` es igual a `clock()`.
5. **API:** el rollback de una entrada `create` responde `400 ROLLBACK_NOT_AVAILABLE`.
6. **API:** repetir el mismo rollback responde `400 NO_CHANGES`.
7. **API:** un `auditId` de otra flag responde `404`, y un rollback sin motivo, `400`.
8. **API:** el rollback de una entrada `archive`, sobre una flag archivada, responde `200` con `archived: false`.
9. **API:** `GET .../audit?limit=2`, sobre una flag con 3 entradas, devuelve las 2 más recientes y un `nextCursor`. Con ese cursor, devuelve la restante y `nextCursor: null`.
10. **API:** `DELETE`, `PATCH` y `PUT` sobre `/api/admin/flags/<key>/audit` y `/audit/<id>` responden `404`, y el número de filas de `audit_log` no cambia.
11. **Web:** una entrada `targeting_update` mockeada muestra "Targeting modificado", el motivo y la fila "Production · Rollout" con `10 %` y `80 %`.
12. **Web:** en una entrada `create` no aparece el botón "Restaurar estado anterior".
13. **Web:** al pulsar "Restaurar estado anterior", la vista previa del diálogo lista los cambios que se aplicarán. Al confirmar, se envía `POST /api/admin/flags/<key>/rollback` con `{ auditId, reason }` y la lista se recarga.
14. **Manual:** cambiar el rollout de `checkout.new-flow` en production del 30 % al 80 %, abrir el historial y restaurar. El listado `/` vuelve a mostrar `30 %` y el historial muestra la entrada "Rollback" arriba.
15. `pnpm test` y `pnpm typecheck` terminan con código 0.

## Notas técnicas

- El rollback restaura `before_state` de la entrada elegida, es decir, el estado **anterior a ese cambio**. Si hubo cambios posteriores, también se revierten los campos que difieran. La vista previa existe precisamente para que el usuario vea el efecto completo antes de confirmar.
- Guarda como `after_state` del rollback el estado **releído de la base de datos**, no el objeto `before_state` tal cual, para que los `updatedAt` reflejen lo realmente persistido.
- Calcula `changes` en el servidor en el momento de leer, sin persistirlo, así el formato del diff puede evolucionar sin migrar datos.
- La etiqueta legible de cada path se construye con un mapa en la web (`name` → "Nombre", `owner` → "Owner", `expiresAt` → "Expiración", `killSwitch` → "Kill switch", `archived` → "Archivada", `enabled` → "Habilitada", `rolloutPercentage` → "Rollout", `allowCompanies` → "Permitidas", `denyCompanies` → "Bloqueadas") más el nombre del ambiente con la primera letra en mayúscula.
