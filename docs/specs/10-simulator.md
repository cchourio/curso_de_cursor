# Spec 10 — Simulador

## Objetivo

Dar al usuario una pantalla para responder, sin escribir código, dos preguntas: "¿qué recibe la empresa Z con la flag X en el ambiente Y, y por qué?" y "¿qué porcentaje real de empresas recibe esta flag con el rollout actual, o con uno hipotético?".

## Contexto y dependencias

- **Producto:** herramienta interna de feature flags. El simulador **no modifica nada**: no persiste datos ni genera auditoría.
- **Depende de:**
  - **Spec 09:** `@ff/domain` exporta funciones isomórficas:

    ```ts
    type EvaluationReason = "FLAG_NOT_FOUND" | "ARCHIVED" | "KILL_SWITCH" | "ENV_DISABLED"
      | "COMPANY_DENIED" | "COMPANY_ALLOWED" | "ROLLOUT" | "DEFAULT";
    interface EvaluableFlag { key; archived; killSwitch; rule: { enabled; rolloutPercentage; allowCompanies; denyCompanies } }
    function bucket(flagKey: string, companyId: string): number;          // 0..99, SHA-256
    function toEvaluableFlag(flag: FlagState, env: Environment): EvaluableFlag;
    function evaluate(flag: EvaluableFlag | null, companyId?: string | null): { value: boolean; reason: EvaluationReason };
    ```

    El orden de reglas es: no existe, archivada, kill switch, ambiente deshabilitado, empresa bloqueada, empresa permitida, rollout al 100 %, `bucket < rolloutPercentage` y default (`false`).
  - **Spec 03:** `getFlagState(db, key)` y `listCompanies(db)` de `@ff/db`, y `ENVIRONMENTS` e `isEnvironment` de `@ff/domain`.
  - **Spec 04:** `createApp(deps)`, `ApiError` con el formato `{ error: { code, message, details? } }`, `flagKeySchema` en `@ff/domain` y `createTestApp()`.
  - **Spec 05:** `/api/admin/*` exige sesión (el simulador usa la sesión, no la API key). En la web, `apiFetch` y `nav-items.ts`; las pantallas viven en `src/app/(app)/`.
  - **Spec 07:** `src/lib/flags-api.ts`, la página de detalle `/flags/[key]` (`FlagDetail`) y los toasts.
  - **Spec 08:** `GET /api/admin/companies` devuelve `{ items: Company[] }`.

## Alcance

### In

- Endpoints de simulación individual y de rollout masivo (con sesión).
- Página `/simulator` con las dos secciones.
- Explicación en español de cada `reason`.
- Enlace "Simular" desde el detalle de la flag, con los parámetros precargados en la URL.

### Out

- Guardar simulaciones o compararlas entre sí.
- Simular cambios de listas o de kill switch: solo se puede sobrescribir el porcentaje.
- Evaluar con datos reales de tráfico.

## Tareas en orden

1. **Dominio (`packages/domain/src/simulation.ts`):**
   - `syntheticCompanyIds(n: number): string[]` devuelve `["sim-0001", …]`, usando `String(i).padStart(4, "0")` para `i` de 1 a n.
   - `simulateRollout(flag: EvaluableFlag, sampleSize: number)` devuelve `{ sampleSize, trueCount, actualPercentage, byReason: Partial<Record<EvaluationReason, number>> }`. `actualPercentage` se redondea a un decimal.
2. **API: `POST /api/admin/simulate`**, con body `{ flagKey, env, companyId? }`:
   - Responde `200 { flagKey, env, companyId, value, reason, bucket, rule }`.
   - `bucket` es `bucket(flagKey, companyId)` si hay `companyId` y `null` si no.
   - `rule` es `EvaluableFlag["rule"]`, o `null` si la flag no existe.
   - Si `env` no es válido, `400 INVALID_ENVIRONMENT`. Si la flag no existe, `200` con `reason: "FLAG_NOT_FOUND"`.
3. **API: `POST /api/admin/simulate/rollout`**, con body `{ flagKey, env, sampleSize?: int 1..10000 (por defecto 1000), rolloutPercentageOverride?: int 0..100 }`:
   - Si se envía el override, se sustituye `rule.rolloutPercentage` en una **copia** del objeto.
   - Responde `200 { flagKey, env, sampleSize, configuredPercentage, simulatedPercentage, trueCount, actualPercentage, byReason }`.
   - Si la flag no existe, `404`. Si los datos no son válidos, `400`.
4. **Web: página `src/app/(app)/simulator/page.tsx`**, con un componente cliente `Simulator`. Añadir `{ href: "/simulator", label: "Simulador" }` a `nav-items.ts`.
   - **Sección "Evaluar una empresa":**
     - Selectores de Flag (todas, con las archivadas marcadas como "(archivada)") y de Ambiente.
     - Campo Empresa: un combobox con el catálogo que también acepta texto libre, porque una empresa no registrada puede recibir el rollout. Vacío significa "sin empresa".
     - Botón "Evaluar".
     - **Tarjeta de resultado:** un badge grande `true` (verde) o `false` (rojo), el `reason` en código y una explicación en español:

       | reason | Explicación |
       |---|---|
       | `FLAG_NOT_FOUND` | La flag no existe. El SDK usará el valor por defecto del código. |
       | `ARCHIVED` | La flag está archivada y siempre devuelve `false`. |
       | `KILL_SWITCH` | El kill switch está activo: `false` en todos los ambientes. |
       | `ENV_DISABLED` | La flag está deshabilitada en este ambiente. |
       | `COMPANY_DENIED` | La empresa está en la lista de bloqueadas. |
       | `COMPANY_ALLOWED` | La empresa está en la lista de permitidas. |
       | `ROLLOUT` | La empresa cae dentro del porcentaje de rollout. |
       | `DEFAULT` | La empresa queda fuera del rollout. |

     - Si `bucket` no es `null` y el reason es `ROLLOUT` o `DEFAULT`, se muestra la línea "Bucket 22 < 30 % → dentro del rollout" o "Bucket 84 ≥ 30 % → fuera del rollout".
   - **Sección "Simular rollout":**
     - Usa la misma flag y ambiente de la sección anterior.
     - Campos: Tamaño de muestra (por defecto 1.000) y "Probar con otro porcentaje" (opcional, de 0 a 100).
     - Botón "Simular".
     - **Resultado:** "311 de 1.000 empresas (31,1 %) recibirían la feature, con un rollout configurado del 30 %", una barra horizontal proporcional y un desglose por `reason`.
     - Si se usó el override, se muestra la etiqueta "Simulación: no se ha guardado ningún cambio".
   - **Estado en la URL:** `?flag=&env=&company=`. Al cargar con esos parámetros, se rellenan los campos y se ejecuta "Evaluar" automáticamente.
5. **Enlace desde el detalle:** en `FlagDetail`, añadir un botón "Simular" que enlaza a `/simulator?flag=<key>&env=production`.
6. Añadir a `flags-api.ts` las funciones `simulate(input)` y `simulateRollout(input)`.
7. **Tests** de dominio, API y web que cubran los criterios de aceptación.

## Criterios de aceptación verificables

1. **Dominio:** `syntheticCompanyIds(3)` devuelve `["sim-0001","sim-0002","sim-0003"]`.
2. **Dominio:** `simulateRollout` con `checkout.new-flow`, `enabled`, 30 %, sin listas y 1.000 muestras devuelve `trueCount: 311` y `actualPercentage: 31.1`. Al 50 %, `trueCount: 505`.
3. **Dominio:** con el kill switch activo, `trueCount: 0` y `byReason: { KILL_SWITCH: 1000 }`.
4. **API:** con el seed, `POST /api/admin/simulate` con `{ flagKey: "checkout.new-flow", env: "production", companyId: "initech" }` devuelve `value: true`, `reason: "ROLLOUT"` y `bucket: 22`.
5. **API:** con el seed, `companyId: "acme"` devuelve `COMPANY_ALLOWED` y `bucket: 84`, y sin `companyId` devuelve `DEFAULT` y `bucket: null`.
6. **API:** `simulate/rollout` con `rolloutPercentageOverride: 50` en production devuelve `simulatedPercentage: 50` y `configuredPercentage: 30`. Después de la llamada, `GET /api/admin/flags/checkout.new-flow` sigue mostrando el 30 % y el número de filas de `audit_log` no cambia.
7. **API:** sin sesión, ambos endpoints responden `401`. `sampleSize: 20000` responde `400`.
8. **Web:** al evaluar con un resultado mockeado `{ value: false, reason: "DEFAULT", bucket: 84, rule: { rolloutPercentage: 30 … } }`, se muestran el badge `false`, el texto "La empresa queda fuera del rollout." y "Bucket 84 ≥ 30 % → fuera del rollout".
9. **Web:** al cargar `/simulator?flag=checkout.new-flow&env=staging&company=acme`, se lanza automáticamente un `POST /api/admin/simulate` con esos valores.
10. **Web:** el resultado del rollout mockeado muestra "311 de 1.000" y "31,1 %". Con override, aparece la etiqueta de que no se ha guardado ningún cambio.
11. **Manual:** desde el detalle de `checkout.new-flow`, "Simular" abre el simulador con la flag y production preseleccionados.
12. `pnpm test` y `pnpm typecheck` terminan con código 0.

## Notas técnicas

- La simulación se calcula en el servidor para usar el estado persistido real. Como `evaluate` y `bucket` son isomórficos, el cliente podría calcularla localmente, pero aquí no se hace para tener una sola fuente de verdad.
- `simulateRollout` debe llamar a `evaluate()` para cada ID sintético, sin reimplementar las reglas. Así el desglose por `reason` es coherente con el evaluador real.
- Los IDs sintéticos (`sim-XXXX`) no están en el catálogo ni en ninguna lista, así que la simulación de rollout mide solo el efecto del porcentaje, además del kill switch y del ambiente.
- Formato de números en la UI: `Intl.NumberFormat("es")` (por ejemplo, "1.000" y "31,1").
- 10.000 evaluaciones con SHA-256 tardan bastante menos de 1 s en Node, así que no hace falta paralelizarlas ni ejecutarlas en segundo plano.
