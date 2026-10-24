# Spec 03 — Database schema and seed

## Objetivo

Definir el esquema persistente (empresas, flags, reglas por ambiente, listas de empresas y auditoría) con Drizzle ORM sobre SQLite/libSQL, con migraciones versionadas, un seed reproducible y funciones de lectura que devuelvan el estado completo de una flag.

## Contexto y dependencias

- **Producto:** herramienta interna de feature flags. Una flag es un interruptor booleano y tiene una regla de targeting por cada uno de los tres ambientes fijos (`development`, `staging`, `production`). Cada cambio queda registrado en una auditoría inmutable con un motivo.
- **Depende de:**
  - **Spec 01:** monorepo pnpm con `@ff/web`, `@ff/api`, `@ff/db` (marcador vacío) y `@ff/domain`. Los paquetes se consumen como código fuente (`exports` hacia `./src/index.ts`). `@ff/domain` exporta `ENVIRONMENTS`, `Environment` e `isEnvironment`.
  - **Spec 02:** Vitest configurado con `test.projects` en la raíz. `packages/db` tiene `vitest.config.ts` (entorno `node`) y un `src/index.test.ts` trivial, que esta spec reemplaza.
- Esta spec no toca la API ni la web.

## Alcance

### In

- Tipos de dominio del estado de una flag en `@ff/domain`.
- Esquema Drizzle, migración inicial generada con `drizzle-kit` y función `runMigrations`.
- Cliente de base de datos con WAL y claves foráneas activadas.
- Seed reproducible con datos de ejemplo.
- Lecturas `getFlagState` y `listFlagStates`.
- Helper `createTestDb()` para tests con base de datos en memoria.

### Out

- Escrituras de negocio, validaciones de entrada y endpoints (spec 04 y siguientes).
- Lógica de evaluación (spec 09).
- Backups automáticos.

## Tareas en orden

1. **Tipos en `packages/domain/src/types.ts`**, reexportados desde `src/index.ts`:

   ```ts
   export const AUDIT_ACTIONS = [
     "create", "update", "archive", "unarchive",
     "kill_switch_on", "kill_switch_off", "targeting_update", "rollback",
   ] as const;
   export type AuditAction = (typeof AUDIT_ACTIONS)[number];

   export interface EnvironmentRule {
     enabled: boolean;
     rolloutPercentage: number;   // entero 0..100
     allowCompanies: string[];    // companyIds, ordenados alfabéticamente
     denyCompanies: string[];     // companyIds, ordenados alfabéticamente
     updatedAt: string;           // ISO 8601 UTC
   }

   export interface FlagState {
     key: string;
     name: string;
     description: string | null;
     owner: string;
     expiresAt: string;           // "YYYY-MM-DD"
     killSwitch: boolean;
     archived: boolean;
     environments: Record<Environment, EnvironmentRule>;
     createdAt: string;
     updatedAt: string;
   }

   export interface Company { id: string; name: string; createdAt: string; updatedAt: string; }
   ```
2. **Dependencias de `packages/db`:** `drizzle-orm`, `@libsql/client` y `@ff/domain: workspace:*`. Dependencias de desarrollo: `drizzle-kit` y `tsx`.
3. **`src/config.ts`:** exporta `DEFAULT_DATABASE_URL`, que apunta a `file:<repoRoot>/data/flags.db` (ruta absoluta calculada desde `import.meta.url`), y `resolveDatabaseUrl(envValue?: string)`, que devuelve `envValue ?? DEFAULT_DATABASE_URL`. Si la URL es `file:`, crea el directorio padre si no existe.
4. **`src/schema.ts`** con `drizzle-orm/sqlite-core`. Todas las fechas se guardan como `text` ISO 8601 UTC y los booleanos como `integer({ mode: "boolean" })`.
   - **`companies`:** `id` (text, PK), `name` (text, not null), `created_at` y `updated_at` (text, not null).
   - **`flags`:** `key` (text, PK), `name` (not null), `description` (nullable), `owner` (not null), `expires_at` (text `YYYY-MM-DD`, not null), `kill_switch` (boolean, default false), `archived` (boolean, default false), `created_at` y `updated_at`.
   - **`flag_environments`:** `flag_key` (FK a `flags.key`, on delete cascade), `environment` (text), `enabled` (boolean, default false), `rollout_percentage` (integer, default 0), `updated_at`.
     - PK compuesta: `(flag_key, environment)`.
     - Checks: `environment IN ('development','staging','production')` y `rollout_percentage BETWEEN 0 AND 100`.
   - **`flag_environment_companies`:** `flag_key`, `environment`, `company_id` (FK a `companies.id`) y `list` (text).
     - PK compuesta: `(flag_key, environment, company_id)`. Esto impide en la base de datos que una empresa esté en las dos listas del mismo ambiente.
     - FK compuesta a `flag_environments(flag_key, environment)`, on delete cascade.
     - Check: `list IN ('allow','deny')`.
   - **`audit_log`:** `id` (integer, PK autoincrement), `flag_key` (text, not null, **sin** FK para que la auditoría sobreviva siempre), `action` (text, check con `AUDIT_ACTIONS`), `reason` (text, not null), `before_state` (text JSON, nullable), `after_state` (text JSON, not null), `created_at`. Índice en `(flag_key, id)`.
5. **`drizzle.config.ts`** con `dialect: "sqlite"`, `schema: "./src/schema.ts"` y `out: "./drizzle"`. Generar la migración inicial con `drizzle-kit generate` y **commitear** la carpeta `drizzle/`.
6. **`src/client.ts`:**
   - `export type Db = LibSQLDatabase<typeof schema>`.
   - `createDb(url: string): Promise<Db>` crea el cliente libSQL y ejecuta `PRAGMA foreign_keys = ON`. Si la URL empieza por `file:`, ejecuta también `PRAGMA journal_mode = WAL`.
7. **`src/migrate.ts`:** `runMigrations(db: Db)` usa `migrate` de `drizzle-orm/libsql/migrator`, con `migrationsFolder` resuelto desde `import.meta.url`.
8. **`src/queries.ts`:**
   - `getFlagState(db, key): Promise<FlagState | null>` reúne `flags`, sus tres `flag_environments` y las listas, y construye el `FlagState`. Las listas van ordenadas alfabéticamente. Si falta la fila de algún ambiente, lanza un error (es un estado inválido).
   - `listFlagStates(db): Promise<FlagState[]>` devuelve todas las flags, archivadas incluidas, ordenadas por `key`. Usa como máximo tres consultas en total, nunca una por flag.
   - `listCompanies(db): Promise<Company[]>` ordena por `name`.
9. **`src/seed.ts`:** `seed(db, now = new Date())` borra todos los datos en una transacción e inserta:
   - **Empresas:** `acme` (Acme Corp), `globex` (Globex), `initech` (Initech), `umbrella` (Umbrella Corp) y `hooli` (Hooli).
   - **`checkout.new-flow`:** owner "Equipo Checkout", `expiresAt` = hoy + 90 días.
     - development: enabled, 100 %.
     - staging: enabled, 100 %.
     - production: enabled, 30 %, con `acme` en la lista de permitidas y `globex` en la de bloqueadas.
   - **`search.v2`:** owner "Equipo Search", `expiresAt` = hoy + 60 días, los tres ambientes deshabilitados al 0 %.
   - **`legacy.banner`:** owner "Equipo Growth", `expiresAt` = `2026-01-01` (vencida). Production enabled al 100 % con `updated_at` = hace 45 días. Los otros ambientes deshabilitados.
   - Para cada flag, una entrada de `audit_log` con `action: "create"`, `reason: "Seed inicial"`, `before_state: null` y `after_state` igual al `FlagState` serializado.
10. **Scripts CLI** en `src/cli/`, ejecutados con `tsx`, que leen `DATABASE_URL` del `.env` raíz:
    - `db:generate`: `drizzle-kit generate`.
    - `db:migrate`: ejecuta `runMigrations`.
    - `db:seed`: migra y luego ejecuta el seed.
    - `db:reset`: borra el archivo `.db` y ejecuta `db:seed`.

    Añadir alias de los cuatro en el `package.json` raíz (`pnpm db:seed`, etc.) y `DATABASE_URL=` (vacío, para usar el valor por defecto) en `.env.example`.
11. **`src/testing.ts`**, exportado como `@ff/db/testing` (añadir la entrada en `exports`): `createTestDb(): Promise<Db>` crea una base de datos `:memory:` y aplica las migraciones.
12. **`src/index.ts`** exporta `schema`, `Db`, `createDb`, `runMigrations`, `resolveDatabaseUrl`, `getFlagState`, `listFlagStates`, `listCompanies` y `seed`.
13. **Tests** (`packages/db/src/*.test.ts`) que cubran los criterios de aceptación.

## Criterios de aceptación verificables

1. `pnpm db:reset` crea `data/flags.db` y termina con código 0. Ejecutarlo dos veces seguidas da el mismo resultado: 5 empresas, 3 flags, 9 filas en `flag_environments` y 3 entradas de auditoría.
2. Tras `createTestDb()` existen las cinco tablas (comprobado consultando `sqlite_master`).
3. Insertar una flag con una `key` duplicada falla con un error de restricción.
4. Insertar `rollout_percentage = 101` falla con un error de restricción.
5. Insertar la misma empresa en `allow` y en `deny` del mismo flag y ambiente falla por la PK compuesta.
6. Insertar una empresa en una lista con un `company_id` inexistente falla por la FK.
7. Tras el seed, `getFlagState(db, "checkout.new-flow")` devuelve `environments.production` con `{ enabled: true, rolloutPercentage: 30, allowCompanies: ["acme"], denyCompanies: ["globex"] }`, más `updatedAt`.
8. `getFlagState(db, "no-existe")` devuelve `null`.
9. `listFlagStates(db)` devuelve las 3 flags ordenadas por key: `checkout.new-flow`, `legacy.banner`, `search.v2`.
10. `seed(db, new Date("2026-10-13T12:00:00Z"))` deja `legacy.banner.environments.production.updatedAt` igual a `2026-08-29T12:00:00.000Z` (45 días antes).
11. `pnpm test` y `pnpm typecheck` terminan con código 0.

## Notas técnicas

- Las fechas se guardan como ISO text y no como enteros para que los snapshots JSON de la auditoría sean legibles y comparables tal cual.
- La PK compuesta de `flag_environment_companies` es la garantía final de que una empresa no esté en ambas listas. La API (spec 08) valida antes para devolver un error claro.
- `audit_log.flag_key` no lleva FK a propósito: las flags no se borran físicamente, pero la auditoría no debe depender de ello.
- Con `:memory:`, cada `createClient` crea una base de datos independiente, así que los tests quedan aislados si cada uno llama a `createTestDb()`.
- WAL no aplica a bases de datos en memoria. Ejecuta ese PRAGMA solo con URLs `file:`.
- No inventes columnas fuera de este esquema. Si una spec futura las necesita, añadirá su propia migración (la spec 11 añade `rollback_of_id`).
