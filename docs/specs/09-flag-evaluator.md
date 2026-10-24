# Spec 09 — Evaluador de flags y API de evaluación

## Objetivo

Implementar el evaluador determinista de flags como función pura en `@ff/domain` y exponerlo a otros servicios mediante una API pública (`/api/v1/*`) protegida con una API key, con logs estructurados y tiempos de respuesta acotados.

## Contexto y dependencias

- **Producto:** herramienta interna de feature flags. Los servicios backend preguntan "¿está activa la flag X en el ambiente Y para la empresa Z?". La respuesta incluye un `reason` para poder depurar.
- **Reglas de evaluación (PRD, sección 5).** Se aplican en orden y gana la primera que se cumple:

  | # | Condición | `value` | `reason` |
  |---|---|---|---|
  | 1 | La flag no existe | `false` | `FLAG_NOT_FOUND` |
  | 2 | La flag está archivada | `false` | `ARCHIVED` |
  | 3 | `killSwitch = true` | `false` | `KILL_SWITCH` |
  | 4 | `enabled = false` en el ambiente | `false` | `ENV_DISABLED` |
  | 5 | `companyId` está en `denyCompanies` | `false` | `COMPANY_DENIED` |
  | 6 | `companyId` está en `allowCompanies` | `true` | `COMPANY_ALLOWED` |
  | 7 | `rolloutPercentage = 100` | `true` | `ROLLOUT` |
  | 8 | Hay `companyId` y `bucket(flagKey, companyId) < rolloutPercentage` | `true` | `ROLLOUT` |
  | 9 | Ninguna de las anteriores | `false` | `DEFAULT` |

  - **Bucket:** `SHA-256(UTF-8("<flagKey>:<companyId>"))`; se toman los primeros 4 bytes como entero sin signo big-endian y se calcula `mod 100`, lo que da un valor entre 0 y 99.
  - Un `companyId` vacío (`""`) o ausente cuenta como "sin empresa".
- **Depende de:**
  - **Spec 03:**
    - `@ff/domain` exporta `ENVIRONMENTS`, `Environment`, `isEnvironment` y `FlagState` (`{ key, archived, killSwitch, environments: Record<Environment, { enabled, rolloutPercentage, allowCompanies, denyCompanies, updatedAt }>, … }`).
    - `@ff/db` exporta `getFlagState(db, key)` y `listFlagStates(db)`, y `@ff/db/testing` exporta `createTestDb()`.
    - El seed incluye `checkout.new-flow` (production: enabled al 30 %, `acme` en permitidas y `globex` en bloqueadas).
  - **Spec 04:** `createApp(deps)` con `AppDeps = { db, clock?, auth }`, errores `{ error: { code, message } }`, `ApiError`, `src/env.ts` con zod y `createTestApp()`.
  - **Spec 05:** `/api/admin/*` usa sesión por cookie. **`/api/v1/*` no usa sesión.**

## Alcance

### In

- `bucket`, `evaluate` y `toEvaluableFlag` en `@ff/domain`, sin dependencias de Node (isomórficos).
- Vectores de prueba fijos del hash.
- Middleware de API key.
- `GET /api/v1/evaluate` y `GET /api/v1/flags`.
- Un log JSON por petición de evaluación.
- Test de rendimiento.

### Out

- El SDK de backend con caché y fallback (PRD RF-23 a RF-25): queda pendiente para una spec futura. `GET /api/v1/flags` ya le sirve como contrato.
- UI de simulación (spec 10).
- Rotación de API keys, varias keys y rate limiting.

## Tareas en orden

1. Añadir `@noble/hashes` a `@ff/domain`.
2. **`packages/domain/src/evaluator.ts`:**

   ```ts
   export type EvaluationReason = "FLAG_NOT_FOUND" | "ARCHIVED" | "KILL_SWITCH" | "ENV_DISABLED"
     | "COMPANY_DENIED" | "COMPANY_ALLOWED" | "ROLLOUT" | "DEFAULT";
   export interface EvaluableFlag {
     key: string; archived: boolean; killSwitch: boolean;
     rule: { enabled: boolean; rolloutPercentage: number; allowCompanies: string[]; denyCompanies: string[] };
   }
   export interface EvaluationResult { value: boolean; reason: EvaluationReason }
   export function bucket(flagKey: string, companyId: string): number;          // 0..99
   export function toEvaluableFlag(flag: FlagState, env: Environment): EvaluableFlag;
   export function evaluate(flag: EvaluableFlag | null, companyId?: string | null): EvaluationResult;
   ```

   `evaluate` aplica la tabla del contexto en orden estricto. Es pura: no accede a la fecha, a la red ni a `Math.random`.
3. **API: middleware `requireApiKey`** sobre `/api/v1/*`. Lee la cabecera `X-API-Key` y la compara en tiempo constante (SHA-256 más `timingSafeEqual`) con `deps.evalApiKey`. Si falta o no coincide, responde `401 UNAUTHORIZED`.
   - Añadir `EVAL_API_KEY` (obligatoria, mínimo 16 caracteres) a `env.ts` y a `.env.example`.
   - Añadir `evalApiKey: string` a `AppDeps`.
4. **`GET /api/v1/evaluate?flag=<key>&env=<env>&company=<companyId>`:**
   - Si falta `flag` o `env`, `400 VALIDATION_ERROR`. Si `env` no es válido, `400 INVALID_ENVIRONMENT`.
   - Si no, responde `200 { flag, env, company: string | null, value, reason }`.
   - Si la flag no existe, también responde `200`, con `value: false` y `reason: "FLAG_NOT_FOUND"`.
5. **`GET /api/v1/flags?env=<env>`:** responde `200 { env, generatedAt, flags: EvaluableFlag[] }`, con las flags no archivadas del ambiente, ordenadas por key. Si `env` falta o no es válido, `400`.
6. **Logs estructurados:** añadir `logger?: (entry: Record<string, unknown>) => void` a `AppDeps`; por defecto escribe una línea JSON en `stdout`. Cada petición a `/api/v1/evaluate` registra `{ ts, route, flag, env, company, value, reason, status, latencyMs }`. Las peticiones a `/api/v1/flags` registran `{ ts, route, env, count, status, latencyMs }`. Nunca se registra la API key.
7. Actualizar `createTestApp()` para que use un `evalApiKey` de test y un `logger` capturable (un array). Ese logger se devuelve en el resultado del helper.
8. **Tests** que cubran los criterios de aceptación, incluidos los vectores de prueba.

## Criterios de aceptación verificables

1. **Vectores del bucket** (fijos; si alguno falla, la implementación es incorrecta):

   | flagKey | companyId | bucket |
   |---|---|---|
   | `checkout.new-flow` | `acme` | 84 |
   | `checkout.new-flow` | `globex` | 51 |
   | `checkout.new-flow` | `initech` | 22 |
   | `search.v2` | `acme` | 89 |
   | `search.v2` | `globex` | 4 |
2. **Distribución:** para `checkout.new-flow` y los IDs `sim-0001` … `sim-1000`, exactamente **311** tienen `bucket < 30` y **505** tienen `bucket < 50`. Toda empresa con `bucket < 30` también cumple `bucket < 50` (monotonía).
3. **Precedencia:** hay un test por cada fila de la tabla. En particular:
   - con el kill switch activo y la empresa en la lista de permitidas, el resultado es `KILL_SWITCH`;
   - con `enabled = false` y la empresa en permitidas, `ENV_DISABLED`;
   - con la empresa en bloqueadas y un rollout del 100 %, `COMPANY_DENIED`;
   - sin empresa y con un rollout del 100 %, `true` con `ROLLOUT`;
   - sin empresa y con un rollout del 99 %, `false` con `DEFAULT`;
   - con `companyId = ""`, el mismo resultado que sin empresa.
4. **Ejemplo concreto:** al 30 %, `initech` (bucket 22) obtiene `true` con `ROLLOUT` y `globex`, sin estar en ninguna lista (bucket 51), obtiene `false` con `DEFAULT`.
5. **API:** sin `X-API-Key`, o con una key incorrecta, `/api/v1/evaluate` responde `401`. Con una cookie de sesión válida pero sin API key, también `401`.
6. **API:** con el seed, `GET /api/v1/evaluate?flag=checkout.new-flow&env=production&company=acme` devuelve `value: true` con `reason: "COMPANY_ALLOWED"`; con `company=globex`, `false` con `COMPANY_DENIED`.
7. **API:** con el seed, `env=staging` y `company=hooli` devuelve `true` con `ROLLOUT`; `env=production` con `flag=search.v2` devuelve `false` con `ENV_DISABLED`.
8. **API:** `flag=no-existe` responde `200` con `value: false` y `reason: "FLAG_NOT_FOUND"`. `env=prod` responde `400 INVALID_ENVIRONMENT`.
9. **API:** `GET /api/v1/flags?env=production` no incluye flags archivadas. Además, al evaluar localmente con `evaluate()` cada flag devuelta, se obtiene lo mismo que con `/api/v1/evaluate` para `acme`, `globex` e `initech` (servidor y cliente dan el mismo resultado).
10. **Logs:** cada `GET /api/v1/evaluate` añade una entrada al logger con `flag`, `env`, `value`, `reason` y un `latencyMs` numérico. Ninguna entrada contiene la API key.
11. **Rendimiento:** con 500 flags y 1.000 empresas en la base de datos de test, 200 peticiones secuenciales a `/api/v1/evaluate` tienen un p95 menor de 50 ms (test `evaluate.perf.test.ts`).
12. `pnpm test` y `pnpm typecheck` terminan con código 0.

## Notas técnicas

- Usa `sha256` de `@noble/hashes/sha256` en lugar de `node:crypto`, para que `@ff/domain` funcione igual en Node y en el navegador (el simulador de la spec 10 lo usa en ambos).
- Para extraer el número: `new DataView(digest.buffer, digest.byteOffset, 4).getUint32(0, false) % 100`.
- Los vectores de prueba se calcularon con exactamente ese algoritmo sobre la cadena `"<flagKey>:<companyId>"`. No cambies el separador ni la codificación.
- La regla 7 (100 %) va antes que la 8 para que el 100 % signifique "todas", también sin `companyId`.
- `/api/v1/evaluate` lee la base de datos en cada petición, así que los cambios se reflejan de inmediato. La caché con un TTL de 30 s es responsabilidad del SDK futuro.
- Mide `latencyMs` con `performance.now()`, desde que entra la petición hasta justo antes de responder.
