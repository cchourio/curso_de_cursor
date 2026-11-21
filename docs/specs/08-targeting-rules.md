# Spec 08 — Reglas de targeting

## Objetivo

Permitir configurar, por flag y por ambiente, si la flag está habilitada, su porcentaje de rollout y las listas de empresas permitidas y bloqueadas, con validación, auditoría y una UI por pestañas. También se incluye la gestión del catálogo de empresas.

## Contexto y dependencias

- **Producto:** herramienta interna de feature flags. Cada flag tiene **una regla por ambiente** (`development`, `staging`, `production`):

  | Campo | Regla |
  |---|---|
  | `enabled` | Interruptor maestro de la flag en ese ambiente. |
  | `rolloutPercentage` | Entero de 0 a 100: porcentaje de empresas que reciben `true`. |
  | `allowCompanies` | Empresas que siempre reciben `true`. |
  | `denyCompanies` | Empresas que siempre reciben `false`. |

  Una empresa no puede estar en ambas listas del mismo ambiente, y las listas solo aceptan empresas del catálogo. La evaluación de estas reglas es la spec 09; esta spec solo las guarda.
- **Estado actual (specs 01–05 hechas).** El esquema ya admite la acción `targeting_update` en `AUDIT_ACTIONS` y en el `CHECK` de `audit_log`. No generes una migración para eso. No hay `environmentRuleInputSchema` ni `PUT` de ambiente: los añade esta spec.
  - `getFlagState(db, key)` y `listCompanies(db)` ya existen. Las listas de `FlagState.environments[env]` vienen ordenadas.
  - Empresas: `GET` y `POST /api/admin/companies` y `PATCH /api/admin/companies/:id`. No hay `DELETE`. El catálogo del seed incluye `acme`, `globex`, `initech` y `hooli`.
  - `createTestApp().request()` ya lleva la sesión. `apiFetch` está en `apps/web/src/lib/api.ts`. `nav-items.ts` solo tiene `{ href: "/", label: "Flags" }`.
  - Las mutaciones de la spec 04 usan `BEGIN`/`COMMIT` sobre la misma conexión (libSQL en `:memory:` no ve las tablas si se usa `db.transaction()`). Sigue ese patrón. `updated_at` del ambiente cambia solo en el ambiente editado: la spec 06 decide `STALE_PRODUCTION` con `environments.production.updatedAt`, y la spec 11 comprueba que un rollback no toca el `updatedAt` de los otros ambientes.
- **Multitask.** Empieza solo cuando la spec 07 esté terminada. No la corras en paralelo con la 06, la 07 ni la 11.
  - El `PUT` no necesita la UI, pero la spec se entrega entera. Partirla choca igual: las tareas de API escriben `packages/domain/src/index.ts`, `packages/domain/src/validation.ts`, `apps/api/src/routes/flags.ts` y `apps/api/src/services/flags.ts`, que la 06 también modifica y que la 11 vuelve a modificar.
  - La UI sustituye el marcador de `FlagDetail` y añade funciones a `src/lib/flags-api.ts`. Esos dos archivos los crea la spec 07. `ReasonDialog` y los toasts también tienen que existir ya.
  - El criterio manual mira el badge de Production en el dashboard de la spec 06, así que esa pantalla también tiene que estar hecha.
  - No toques el listado, el resumen, `obsolescence.ts`, el dashboard, `environment-badge.tsx` (solo impórtalo si ya lo usa el detalle), ni `audit`/`rollback`. No borres empresas.
- **Depende de:**
  - **Spec 03:** tablas `flag_environments` y `flag_environment_companies`, `getFlagState` y `listCompanies`.
  - **Spec 04:** patrón de mutación y auditoría, `ApiError`, `deps.clock`, rutas de flags, API de empresas y `createTestApp()`.
  - **Spec 05:** sesión en `/api/admin/*`, `apiFetch` y `nav-items.ts`.
  - **Spec 06:** dashboard en `/` con `EnvironmentBadge`, porque el criterio manual comprueba ahí el `50 %` de Production.
  - **Spec 07:** `ReasonDialog`, toasts, `src/lib/flags-api.ts` y `FlagDetail` en `/flags/[key]`, con la sección "Ambientes" de solo lectura, el marcador `{/* Targeting: spec 08 */}` y el modo solo lectura si la flag está archivada.

## Alcance

### In

- Esquema zod de la regla.
- Endpoint `PUT` de la regla de un ambiente, con auditoría `targeting_update`.
- Editor de targeting por pestañas en el detalle de la flag.
- Página `/companies` para listar, crear y renombrar empresas.

### Out

- Evaluación y simulación de reglas (specs 09 y 10).
- Copiar reglas entre ambientes, editar varios ambientes a la vez o programar cambios.
- Borrar empresas.
- Targeting por usuario o por atributos.

## Tareas en orden

1. **Dominio (`packages/domain/src/validation.ts`):** añadir y exportar `environmentRuleInputSchema`:

   ```ts
   { enabled: boolean, rolloutPercentage: number /* int 0..100 */,
     allowCompanies: string[] /* companyIdSchema, sin duplicados */,
     denyCompanies: string[], reason: reasonSchema }
   ```

   Un `refine` rechaza que una empresa esté en ambas listas, con el mensaje "La empresa <id> no puede estar en ambas listas" y el `path` `["denyCompanies"]`.
2. **API:** añadir `PUT /api/admin/flags/:key/environments/:env`, con este orden de comprobaciones:
   1. Si `env` no es válido, `400 INVALID_ENVIRONMENT`.
   2. Si el body no es válido, `400 VALIDATION_ERROR`.
   3. Si la flag no existe, `404`.
   4. Si está archivada, `409 FLAG_ARCHIVED`.
   5. Si alguna empresa no existe en el catálogo, `400 UNKNOWN_COMPANY`, con `details: [{ companyId }]`.
   6. Si la regla resultante es igual a la actual (las listas se comparan como conjuntos), `400 NO_CHANGES`.
   7. En una transacción: actualizar `flag_environments`, sustituir las filas de `flag_environment_companies` de ese ambiente, poner `updated_at` del ambiente y de la flag a `clock()`, y auditar con `action = "targeting_update"`.
   8. Responder `200 FlagState`.
3. **Web: cliente.** Añadir a `flags-api.ts` las funciones `updateEnvironmentRule(key, env, input)`, `listCompanies()`, `createCompany()` y `updateCompany()`.
4. **Web: `src/components/targeting/targeting-editor.tsx`.** Sustituye el marcador de la spec 07 en `FlagDetail`.
   - Tres pestañas accesibles (`role="tablist"`), una por ambiente. La pestaña `production` lleva un indicador visual de "Producción".
   - Cada pestaña contiene un borrador local inicializado desde `FlagState.environments[env]` con:
     - un interruptor "Habilitada en <env>";
     - el **rollout**: un slider (0 a 100, paso 1) y un input numérico sincronizados, con el texto "N % de las empresas recibirán la feature";
     - **empresas permitidas** y **empresas bloqueadas**: multiselect con búsqueda sobre el catálogo (`GET /api/admin/companies`). Una empresa ya elegida en la otra lista aparece deshabilitada con el texto "(en la otra lista)", y cada empresa elegida se muestra como chip con un botón para quitarla.
   - Avisos según el estado:
     - si `killSwitch` está activo: "Kill switch activo: esta regla no se aplica hasta desactivarlo";
     - si `enabled = false`: "Mientras esté deshabilitada, todas las empresas reciben `false`".
   - Si el borrador difiere del estado guardado, aparece "Cambios sin guardar" junto a la pestaña y se habilitan "Guardar" y "Descartar".
   - "Guardar" abre `ReasonDialog`. En `production`, el título es "Guardar cambios en PRODUCCIÓN" con `tone="danger"`. Al confirmar se hace `PUT` y el detalle se actualiza con la respuesta.
   - Si se cambia de pestaña con cambios sin guardar, se pide confirmación ("¿Descartar cambios de <env>?").
   - Si la flag está archivada, todo es de solo lectura.
5. **Web: página `src/app/(app)/companies/page.tsx`.**
   - Tabla con ID y Nombre, más un formulario "Nueva empresa" (ID y Nombre) validado con `createCompanyInputSchema`.
   - Si la API responde `409`, muestra "Ya existe una empresa con ese ID".
   - El nombre se edita en línea (pasa a input; `Enter` guarda y `Escape` cancela).
   - Añadir `{ href: "/companies", label: "Empresas" }` a `nav-items.ts`.
6. **Tests** de dominio, API y web que cubran los criterios de aceptación.

## Criterios de aceptación verificables

1. **Dominio:** el esquema acepta `rolloutPercentage` 0 y 100, y rechaza -1, 101 y 12.5. También rechaza `acme` en ambas listas, con `path` `denyCompanies`.
2. **API:** sobre una flag con el seed, `PUT .../environments/staging` con `{ enabled: true, rolloutPercentage: 100, allowCompanies: [], denyCompanies: [], reason: "Abrir en staging" }` responde `200`, y `environments.staging` refleja esos valores con un `updatedAt` igual a `clock()`.
3. **API:** el `PUT` anterior crea una entrada de auditoría `targeting_update`, cuyo `before_state.environments.staging` y `after_state.environments.staging` difieren y cuyos otros ambientes son idénticos.
4. **API:** `PUT .../environments/prod` responde `400 INVALID_ENVIRONMENT`.
5. **API:** con `allowCompanies: ["no-existe"]` responde `400 UNKNOWN_COMPANY` y `details[0].companyId` vale `"no-existe"`.
6. **API:** repetir el mismo `PUT` responde `400 NO_CHANGES`, y no se crea ninguna entrada de auditoría nueva.
7. **API:** enviar `allowCompanies: ["globex","acme"]` y luego el mismo contenido como `["acme","globex"]` responde `NO_CHANGES` (las listas se comparan como conjuntos).
8. **API:** sobre una flag archivada responde `409 FLAG_ARCHIVED`.
9. **Web:** mover el slider a 40 actualiza el input numérico a 40 y muestra "Cambios sin guardar". "Descartar" restaura el valor guardado.
10. **Web:** con `acme` en la lista de permitidas, la opción `acme` aparece deshabilitada en el selector de bloqueadas.
11. **Web:** guardar en `production` abre el diálogo con el título "Guardar cambios en PRODUCCIÓN". Al confirmar se envía `PUT /api/admin/flags/<key>/environments/production` con el borrador y el motivo.
12. **Web:** con `killSwitch: true` se muestra el aviso del kill switch.
13. **Web:** en `/companies`, crear `hooli` cuando ya existe muestra "Ya existe una empresa con ese ID".
14. **Manual:** configurar `checkout.new-flow` en production al 50 % con `initech` en la lista de permitidas, recargar y verificar que se conserva. El listado `/` muestra `50 %` en Production.
15. `pnpm test` y `pnpm typecheck` terminan con código 0.

## Notas técnicas

- La API es la fuente de verdad de la validación. La UI previene los errores (opciones deshabilitadas, límites del slider) pero debe mostrar igualmente los `400` que devuelva la API.
- `PUT` sustituye la regla completa del ambiente: el cliente siempre envía los cuatro campos. Es más simple y auditable que un `PATCH` parcial.
- Actualiza `flag_environments.updated_at` **solo** para el ambiente editado. La spec 06 usa `environments.production.updatedAt` para detectar flags obsoletas.
- Implementa el multiselect con elementos nativos y accesibles (un input de búsqueda y una lista de botones u opciones) sin añadir librerías de UI.
