# Spec 07 — Crear y editar flag

## Objetivo

Permitir desde la web crear una flag, editar su información general, activar o desactivar el kill switch (también desde el listado) y archivar o desarchivar. Toda acción pide un motivo antes de confirmarse.

## Contexto y dependencias

- **Producto:** herramienta interna de feature flags.
  - La `key` es única e inmutable, con formato `^[a-z0-9][a-z0-9_.-]{2,63}$`.
  - `name`, `owner` y `expiresAt` (`YYYY-MM-DD`) son obligatorios; `description` es opcional.
  - El **kill switch** fuerza `false` en todos los ambientes.
  - Una flag **archivada** es de solo lectura y se evalúa siempre como `false`.
  - Cada cambio exige un **motivo** de al menos 5 caracteres, que queda en la auditoría.
- **Depende de:**
  - **Spec 04:** la API ya implementa todo lo necesario. Todas las respuestas de flag son `FlagState`.

    | Endpoint | Body | Respuestas |
    |---|---|---|
    | `POST /api/admin/flags` | `{ key, name, description?, owner, expiresAt, reason }` | `201`, `400 VALIDATION_ERROR` con `details[{path,message}]`, `409 CONFLICT` si la key está duplicada |
    | `GET /api/admin/flags/:key` | — | `200`, `404` |
    | `PATCH /api/admin/flags/:key` | `{ name?, description?, owner?, expiresAt?, reason }` | `200`, `400 NO_CHANGES`, `409 FLAG_ARCHIVED` |
    | `POST /api/admin/flags/:key/kill-switch` | `{ enabled, reason }` | `200`, `400 NO_CHANGES`, `409 FLAG_ARCHIVED` |
    | `POST /api/admin/flags/:key/archive` y `/unarchive` | `{ reason }` | `200`, `409 CONFLICT` |

    `@ff/domain` exporta `createFlagInputSchema`, `updateFlagInputSchema`, `reasonSchema`, `flagKeySchema` (zod) y los tipos `FlagState` y `FlagSummary`.
  - **Spec 05:** `apiFetch` y `ApiClientError { status, code, message, details }` en `apps/web/src/lib/api.ts`. Las páginas autenticadas viven en `src/app/(app)/`.
  - **Spec 06:**
    - El dashboard `/` (componente `FlagsDashboard`) tiene una tabla con una columna Estado, el botón "Nueva flag" (que enlaza a `/flags/new`) y enlaces de fila a `/flags/<key>`.
    - Existe `src/components/flags/environment-badge.tsx`.

## Alcance

### In

- Componente reutilizable `ReasonDialog`.
- Página de creación `/flags/new`.
- Página de detalle `/flags/[key]`: información general editable, kill switch, archivado y modo solo lectura cuando está archivada.
- Kill switch rápido desde la fila del dashboard.
- Mensajes de éxito (toast) y de error.

### Out

- Edición de reglas por ambiente: es la sección "Targeting" del detalle (spec 08). Aquí solo se muestra un resumen de solo lectura con `EnvironmentBadge`.
- Historial y rollback (spec 11): solo se deja el enlace "Historial" hacia `/flags/<key>/history`.
- Cambios en la API.

## Tareas en orden

1. **`src/components/reason-dialog.tsx`:** un modal accesible (`role="dialog"`, `aria-modal`, foco inicial en el textarea, `Escape` cancela).
   - Props: `{ open, title, description?, confirmLabel, tone?: "default" | "danger", onConfirm(reason: string): Promise<void>, onCancel() }`.
   - El botón de confirmar está deshabilitado hasta que `reasonSchema` acepte el texto.
   - Mientras `onConfirm` está pendiente, muestra "Guardando…" y bloquea un segundo envío.
   - Si `onConfirm` lanza un error, muestra el mensaje dentro del modal y no lo cierra.
2. **`src/components/toast.tsx`:** un proveedor de toasts mínimo (éxito y error, que se ocultan solos a los 4 s) montado en `src/app/(app)/layout.tsx`.
3. **Página `src/app/(app)/flags/new/page.tsx`**, con un componente cliente `CreateFlagForm`:
   - Campos: Key, Nombre, Descripción (textarea), Owner, Fecha de expiración (`<input type="date">`, por defecto hoy + 90 días) y Motivo.
   - La validación en cliente usa `createFlagInputSchema` al hacer blur y al enviar, y muestra el error bajo cada campo.
   - Un texto de ayuda bajo Key: "Minúsculas, números, `.`, `_` o `-`. No se puede cambiar después."
   - Si la API responde `409`, muestra "Ya existe una flag con esta key" bajo Key. Si responde `400` con `details`, mapea cada `path` a su campo.
   - Si se crea, muestra el toast "Flag creada" y navega a `/flags/<key>`.
4. **Página `src/app/(app)/flags/[key]/page.tsx`**, con un componente cliente `FlagDetail`:
   - **Cabecera:** key en monoespaciado con un botón "Copiar", nombre, badges (Kill switch / Archivada) y enlaces "Historial" (`/flags/<key>/history`) y "Volver al listado".
   - **Si es `404`:** "Flag no encontrada" y un enlace al listado.
   - **Sección "Información general":** formulario con Nombre, Descripción, Owner y Expiración. La key no se puede editar.
     - "Guardar cambios" solo se habilita si hay cambios respecto al estado cargado.
     - Al pulsarlo se abre `ReasonDialog` y luego se hace `PATCH` enviando **solo los campos modificados**.
     - Si va bien, el formulario se actualiza con la respuesta y aparece el toast "Cambios guardados".
   - **Sección "Kill switch":** un interruptor con el texto "Si está activo, la flag devuelve `false` en todos los ambientes".
     - Al pulsarlo se abre `ReasonDialog` con `tone="danger"`, el título "Activar kill switch" o "Desactivar kill switch", y luego se hace `POST kill-switch`.
   - **Sección "Ambientes" (solo lectura):** una fila por ambiente con `EnvironmentBadge` y el número de empresas en cada lista. Deja un marcador `{/* Targeting: spec 08 */}` donde irá el editor.
   - **Zona de archivado:** el botón "Archivar flag" (`tone="danger"`) o "Desarchivar flag", con `ReasonDialog`.
   - **Modo archivada:** un banner "Flag archivada: solo lectura". Todos los campos y el kill switch quedan deshabilitados; solo "Desarchivar" está activo.
5. **Kill switch rápido en el dashboard:** añadir en la columna Estado de cada fila no archivada un interruptor compacto con `aria-label="Kill switch de <key>"`. Abre `ReasonDialog` y, al confirmar, actualiza la fila con la respuesta sin recargar la tabla. Recorrido: un clic en el interruptor, escribir el motivo y un clic en confirmar.
6. Crear `src/lib/flags-api.ts` con funciones tipadas sobre `apiFetch`: `createFlag`, `getFlag`, `updateFlag`, `setKillSwitch`, `archiveFlag` y `unarchiveFlag`. Las specs siguientes añaden funciones aquí.
7. **Tests** de componentes con Testing Library y `fetch` mockeado, que cubran los criterios de aceptación.

## Criterios de aceptación verificables

1. **`ReasonDialog`:** con "abc" el botón confirmar está deshabilitado; con "Activar para QA", habilitado. `Escape` llama a `onCancel`. Si `onConfirm` rechaza con un error, el mensaje se muestra y el modal sigue abierto.
2. **Crear:** con una key `Mal Key`, al hacer blur se muestra el error de formato y no se llama a `fetch`.
3. **Crear:** si `fetch` devuelve `409`, aparece "Ya existe una flag con esta key" bajo el campo Key.
4. **Crear:** si `fetch` devuelve `201`, se navega a `/flags/<key>` (se verifica la llamada a `router.push`).
5. **Editar:** con el detalle cargado, "Guardar cambios" está deshabilitado. Al cambiar Owner se habilita, y al confirmar con un motivo se envía un `PATCH` cuyo body contiene **solo** `owner` y `reason`.
6. **Kill switch en el detalle:** al confirmar se envía `POST /kill-switch` con `{ enabled: true, reason }` y el badge "Kill switch" aparece en la cabecera.
7. **Kill switch en el dashboard:** el interruptor con `aria-label="Kill switch de checkout.new-flow"` abre el diálogo. Al confirmar, la fila muestra el badge "Kill switch" sin una nueva petición al listado.
8. **Archivada:** con `archived: true`, todos los inputs y el kill switch están deshabilitados, se ve el banner y solo "Desarchivar flag" está habilitado.
9. **Detalle `404`:** se muestra "Flag no encontrada".
10. **Manual:** crear una flag, editar su owner, activar y desactivar su kill switch, archivarla y desarchivarla. Cada acción pide motivo y aparece reflejada en el listado.
11. `pnpm test` y `pnpm typecheck` terminan con código 0.

## Notas técnicas

- Reutiliza los esquemas zod de `@ff/domain` en el cliente para que las reglas de validación sean idénticas a las de la API. No dupliques regex.
- `description` vacía se envía como `""` y la API la normaliza a `null`. Al comparar cambios, trata `null` y `""` como iguales.
- Las fechas `YYYY-MM-DD` se manejan como strings, sin convertirlas a `Date`, para evitar desfases de zona horaria con `<input type="date">`.
- No hagas actualizaciones optimistas: muestra el estado devuelto por la API, que es la fuente de verdad.
