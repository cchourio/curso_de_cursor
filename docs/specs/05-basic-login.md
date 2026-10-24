# Spec 05 — Basic login

## Objetivo

Proteger la web y la API de administración con un login de un único usuario demo, con sesión en una cookie firmada, logout y un layout de aplicación con navegación.

## Contexto y dependencias

- **Producto:** herramienta interna de feature flags. El PRD fija **un único usuario demo** con acceso total. Quedan fuera OAuth, SSO, múltiples usuarios, roles y permisos.
- **Depende de:**
  - **Spec 01:** `apps/web` (Next.js App Router en `src/app`, Tailwind v4, rewrite de `/api/*` a la API en el puerto 3001) y `apps/api` (Hono, `src/env.ts` con zod y dotenv sobre el `.env` raíz).
  - **Spec 02:** Vitest. La web usa jsdom y Testing Library, con `fetch` y `next/navigation` mockeados.
  - **Spec 04:**
    - `createApp(deps: AppDeps)` con `AppDeps = { db, clock? }`.
    - Errores con formato `{ error: { code, message, details? } }` mediante `ApiError`.
    - Rutas de administración bajo `/api/admin/*`, en `src/routes/flags.ts` y `src/routes/companies.ts`.
    - Helper `createTestApp()` en `src/test/helpers.ts`, que devuelve `{ app, db, request }`.
- Como el navegador accede a la API a través del rewrite de Next.js, web y API comparten origen (`localhost:3000`), así que la cookie funciona sin CORS.

## Alcance

### In

- Endpoints de login, logout y sesión actual.
- Middleware que exige sesión en `/api/admin/*`.
- Variables de entorno de credenciales y secreto, validadas.
- Página `/login`.
- Redirección a `/login` sin sesión, con middleware de Next.js.
- Layout autenticado con cabecera, navegación y botón de salir.
- Cliente `apiFetch` en la web.

### Out

- Registro de usuarios, recuperación de contraseña, "recordarme" y bloqueo por intentos.
- Roles y permisos.
- Almacén de sesiones en servidor: la sesión es una cookie firmada sin estado.
- Protección de `/api/v1/*` (la spec 09 usa una API key).

## Tareas en orden

1. **Entorno de la API (`src/env.ts`):** añadir como obligatorias:
   - `DEMO_USERNAME`: mínimo 1 carácter.
   - `DEMO_PASSWORD`: mínimo 8.
   - `SESSION_SECRET`: mínimo 32.

   Si falta alguna, la API no arranca y el mensaje nombra la variable **sin mostrar su valor**. Añadirlas a `.env.example` con valores de ejemplo y un comentario indicando que se cambien.
2. **Configuración inyectable:** ampliar `AppDeps` con `auth: { username: string; password: string; sessionSecret: string; sessionTtlMs?: number }`. `sessionTtlMs` vale 8 horas por defecto. `src/index.ts` lo rellena desde `env`.
3. **Rutas de autenticación (`src/routes/auth.ts`):**
   - `POST /api/auth/login`, con body `{ username, password }`:
     - Compara ambos valores en tiempo constante, con `timingSafeEqual` sobre los hashes SHA-256 de cada valor.
     - Si son correctos, responde `200 { username }` y crea la cookie firmada `ff_session` con `setSignedCookie` de `hono/cookie`. El valor es el instante de expiración (epoch ms). Atributos: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` igual al TTL y `Secure` solo si `NODE_ENV === "production"`.
     - Si no, responde `401 INVALID_CREDENTIALS` con el mensaje "Usuario o contraseña incorrectos". No indica cuál de los dos campos falló.
   - `POST /api/auth/logout` borra la cookie y responde `204`.
   - `GET /api/auth/me` responde `200 { username }` si la sesión es válida, y `401 UNAUTHORIZED` si no.
4. **Middleware `requireSession`:**
   - Lee la cookie con `getSignedCookie`.
   - La rechaza si falta, si la firma es inválida o si `clock().getTime() > expiración`.
   - Al rechazar, responde `401 UNAUTHORIZED`.
   - Se monta sobre `/api/admin/*`. `/api/health` y `/api/auth/*` quedan públicos.
5. **Nunca registres en logs el body de `/api/auth/login`, la contraseña ni el secreto.**
6. **Helper de tests:** `createTestApp()` acepta `auth` opcional, con valores de test por defecto (`demo` / `demo-password` / un secreto de 32 caracteres). Ahora `request()` hace login una sola vez y añade la cookie automáticamente; `app.request` sigue disponible para peticiones sin sesión. Actualizar los tests de la spec 04 si hace falta, para que sigan pasando con la protección activa.
7. **Cliente de la web (`apps/web/src/lib/api.ts`):**
   - `apiFetch<T>(path, init?)` hace `fetch` relativo con `credentials: "same-origin"` y JSON.
   - Ante un `401`, ejecuta `window.location.assign("/login")` y lanza un error.
   - Ante otros errores, lanza `ApiClientError { status, code, message, details }` a partir del body de error.
8. **Middleware de Next.js (`apps/web/src/middleware.ts`):** si no existe la cookie `ff_session`, redirige a `/login?next=<ruta>`. Se excluyen `/login`, `/api/*`, `/_next/*` y `favicon.ico`. La validez real de la sesión la decide la API: el middleware solo comprueba que la cookie existe.
9. **Reorganizar las rutas de la web:**
   - `src/app/(auth)/login/page.tsx`: formulario con usuario, contraseña y botón "Entrar".
     - Mientras envía, el botón queda deshabilitado.
     - Ante un `401`, muestra "Usuario o contraseña incorrectos".
     - Si el login funciona, navega a `next` (solo si es una ruta relativa que empieza por `/`) o a `/`.
   - `src/app/(app)/layout.tsx`: cabecera con el título "Feature Flags", navegación desde `src/components/nav-items.ts` (por ahora solo `{ href: "/", label: "Flags" }`), el texto del usuario (de `/api/auth/me`) y un botón "Salir".
   - "Salir" llama a `/api/auth/logout` y navega a `/login`.
   - Mover la página de inicio de la spec 01 a `src/app/(app)/page.tsx`, con un contenido provisional; la spec 06 la reemplaza.
10. **Tests** de la API y de la web que cubran los criterios de aceptación.

## Criterios de aceptación verificables

1. Sin cookie, `GET /api/admin/flags` responde `401 UNAUTHORIZED`. `GET /api/health` sigue respondiendo `200`.
2. `POST /api/auth/login` con las credenciales correctas responde `200` y una cabecera `Set-Cookie` con `ff_session`, `HttpOnly` y `SameSite=Lax`. Con esa cookie, `GET /api/admin/flags` responde `200`.
3. Con la contraseña o el usuario incorrectos, la respuesta es `401 INVALID_CREDENTIALS` con un mensaje idéntico en ambos casos, sin `Set-Cookie`.
4. Una cookie con la firma alterada responde `401`.
5. Con `clock` avanzado más allá del TTL, una cookie válida responde `401`.
6. Tras `POST /api/auth/logout`, la cookie se invalida (`Max-Age=0`) y `GET /api/auth/me` sin cookie responde `401`.
7. Arrancar la API sin `SESSION_SECRET`, o con menos de 32 caracteres, falla con un mensaje que nombra la variable y no imprime ningún secreto.
8. En la web, visitar `/` sin cookie redirige a `/login?next=%2F`.
9. Test de la web: al enviar el formulario con un `fetch` mockeado que devuelve `401`, aparece "Usuario o contraseña incorrectos". Con un `200`, se llama a `router.push("/")`.
10. Test de la web: `next=https://evil.com` se ignora y se navega a `/`.
11. Manual: login con las credenciales del `.env`, se ve la cabecera con el usuario, "Salir" vuelve a `/login`, y el botón atrás del navegador no muestra datos (la API responde `401`).
12. `pnpm test` y `pnpm typecheck` terminan con código 0, incluidos los tests de la spec 04.

## Notas técnicas

- Sesión sin estado: reiniciar la API no invalida las cookies hasta que expiren, y cambiar `SESSION_SECRET` las invalida todas. Es aceptable para un MVP con usuario demo.
- Comparar hashes SHA-256 de igual longitud evita que `timingSafeEqual` lance un error cuando las longitudes difieren.
- El middleware de Next.js no puede validar la firma sin compartir el secreto. Por diseño, solo comprueba que la cookie existe y delega la validación en la API, a través de los `401` que maneja `apiFetch`.
- Todas las pantallas de las specs siguientes viven bajo `src/app/(app)/` y añaden su entrada a `nav-items.ts`.
