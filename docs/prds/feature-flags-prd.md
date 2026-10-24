# PRD — Herramienta interna de Feature Flags (MVP)

| Campo | Valor |
|---|---|
| Estado | Aprobado para implementación (v1) |
| Fecha | 2026-10-13 |
| Tipo | Herramienta interna |

---

## 1. Contexto y problema

Hoy, activar o desactivar una funcionalidad para un cliente, un ambiente o un subconjunto de tráfico requiere modificar código o configuración y hacer un deploy. Esto provoca:

- **Lentitud:** un cambio de negocio trivial (habilitar una feature para un cliente) espera un ciclo de release.
- **Riesgo:** no existe un mecanismo rápido para apagar una funcionalidad defectuosa en producción.
- **Releases todo-o-nada:** no se puede exponer una feature gradualmente para limitar el impacto de errores.
- **Falta de trazabilidad:** no hay registro centralizado de qué está activo, dónde ni por qué.

## 2. Objetivo

Permitir que el equipo active, desactive y libere gradualmente funcionalidades **por ambiente, por empresa y por porcentaje de tráfico, sin deploy**, con un registro auditable de cada cambio y reversión en un clic.

**Métricas de éxito (90 días tras el lanzamiento):**

- ≥ 80 % de las features nuevas se lanzan detrás de una flag.
- Tiempo desde la decisión hasta el cambio efectivo en producción: < 5 minutos (hoy: un ciclo de deploy).
- 0 incidentes causados por la propia herramienta (caída del servicio de flags que afecte a una aplicación).

## 3. Público objetivo y usuarios

| Usuario | Necesidad principal |
|---|---|
| Ingenieros | Desplegar código desactivado y encenderlo después; apagar features con problemas. |
| Tech Leads / PMs | Controlar rollouts graduales y la habilitación por cliente. |
| Servicios backend (usuario técnico) | Consultar el estado de una flag de forma rápida y fiable. |

En el MVP existe **un único usuario humano: el usuario demo**, con acceso total. No hay diferenciación de permisos entre personas.

## 4. Alcance

### In scope

- Login con un único usuario demo (credenciales definidas por configuración).
- CRUD de flags booleanas (crear, editar, archivar). Las flags no se borran físicamente.
- Tres ambientes fijos: `development`, `staging` y `production`.
- Catálogo simple de empresas (ID y nombre).
- Targeting por ambiente, por empresa (listas de permitidas y bloqueadas) y por rollout porcentual.
- Kill switch global por flag.
- Evaluador con reglas de precedencia deterministas.
- API REST de evaluación protegida con una API key estática.
- SDK de backend para el stack principal, con caché y fallback.
- Registro de auditoría de cambios con motivo obligatorio.
- Rollback en un clic a un estado anterior de la flag.
- Dueño y fecha de expiración por flag, y un dashboard de flags obsoletas.
- Persistencia local en SQLite.

### Out of scope (explícito)

- OAuth, SSO o cualquier proveedor de identidad.
- Múltiples usuarios, roles, permisos o flujos de aprobación.
- Flags multivariante (string, número o JSON).
- Experimentos A/B y análisis de métricas o conversión.
- Targeting por usuario final, por atributos arbitrarios o por segmentos.
- Ambientes configurables (creación de ambientes nuevos).
- SDK de frontend o evaluación de reglas en el navegador.
- Notificaciones (Slack, email).
- Streaming de cambios en tiempo real (se usa polling o TTL de caché).
- Alta disponibilidad, despliegue multi-instancia o escalado horizontal.
- Integración con sistemas externos de flags (LaunchDarkly, Unleash, etc.).

## 5. Conceptos de dominio

### Flag

Interruptor booleano que controla si una funcionalidad está activa.

| Atributo | Regla |
|---|---|
| `key` | Única e inmutable. Formato `^[a-z0-9][a-z0-9_.-]{2,63}$`. Ejemplo: `checkout.new-flow`. |
| `name`, `description` | Texto descriptivo. `name` es obligatorio. |
| `owner` | Texto libre, obligatorio (persona o equipo responsable). |
| `expiresAt` | Fecha de expiración, obligatoria. |
| `killSwitch` | Booleano global. Si está activo, la flag devuelve `false` en todos los ambientes. |
| `archived` | Una flag archivada no se puede editar y siempre se evalúa como `false`. |
| `environments` | Una configuración de targeting por cada uno de los tres ambientes. |

### Targeting rule (configuración por ambiente)

Cada flag tiene, **por ambiente**, una regla con estos campos:

| Campo | Descripción |
|---|---|
| `enabled` | Interruptor maestro de la flag en ese ambiente. |
| `allowCompanies` | Lista de IDs de empresa que siempre reciben `true`. |
| `denyCompanies` | Lista de IDs de empresa que siempre reciben `false`. |
| `rolloutPercentage` | Entero de 0 a 100. Porcentaje de empresas que reciben `true`. |

Una misma empresa no puede estar a la vez en `allowCompanies` y `denyCompanies` del mismo ambiente.

### Empresa

Cliente identificado por un `companyId` (string) y un nombre. Es la unidad de targeting y de rollout.

### Evaluador

Función pura y determinista: `evaluate(flagKey, environment, companyId?) → { value, reason }`.

Aplica las siguientes reglas **en orden**; la primera que aplica determina el resultado:

| # | Condición | `value` | `reason` |
|---|---|---|---|
| 1 | La flag no existe | `false` (el SDK usa el default del código) | `FLAG_NOT_FOUND` |
| 2 | La flag está archivada | `false` | `ARCHIVED` |
| 3 | `killSwitch = true` | `false` | `KILL_SWITCH` |
| 4 | `enabled = false` en el ambiente | `false` | `ENV_DISABLED` |
| 5 | `companyId` está en `denyCompanies` | `false` | `COMPANY_DENIED` |
| 6 | `companyId` está en `allowCompanies` | `true` | `COMPANY_ALLOWED` |
| 7 | `rolloutPercentage = 100` | `true` | `ROLLOUT` |
| 8 | Hay `companyId` y `bucket(flagKey, companyId) < rolloutPercentage` | `true` | `ROLLOUT` |
| 9 | Ninguna de las anteriores | `false` | `DEFAULT` |

**Bucket:** `bucket = hash(flagKey + ":" + companyId) mod 100`, con un hash estable y documentado (por ejemplo, los primeros 32 bits de SHA-256). Esto garantiza que:

- una empresa obtiene siempre el mismo resultado para la misma flag y el mismo porcentaje;
- al subir el porcentaje, las empresas que ya tenían `true` lo conservan;
- el reparto entre flags distintas es independiente.

Sin `companyId`, solo se obtiene `true` con un rollout del 100 %.

## 6. Requerimientos funcionales

### Autenticación

- **RF-01.** La UI y la API de administración exigen sesión iniciada. Sin sesión, la UI redirige al login y la API responde `401`.
- **RF-02.** El login acepta únicamente el usuario y la contraseña demo definidos en configuración (variables de entorno). Con credenciales incorrectas responde con un error genérico y no crea sesión.
- **RF-03.** El usuario puede cerrar sesión; tras hacerlo, las peticiones a la UI o a la API de administración se comportan como en RF-01.

### Gestión de flags

- **RF-04.** El usuario puede crear una flag con `key`, `name`, `owner` y `expiresAt` obligatorios, y `description` opcional. Una flag nueva tiene `enabled = false` y `rolloutPercentage = 0` en los tres ambientes, y `killSwitch = false`.
- **RF-05.** El sistema rechaza crear una flag con una `key` duplicada o que no cumpla el formato, mostrando un mensaje que indica el motivo.
- **RF-06.** La `key` no se puede modificar después de creada. El resto de los atributos sí.
- **RF-07.** El usuario puede listar las flags con filtros por texto (key o nombre), por estado (activa o archivada) y por "obsoleta" (ver RF-21).
- **RF-08.** El usuario puede archivar y desarchivar una flag. Una flag archivada se evalúa siempre como `false` (`ARCHIVED`) y no se puede editar.

### Targeting

- **RF-09.** Por cada ambiente, el usuario puede activar o desactivar `enabled`, definir `rolloutPercentage` (entero de 0 a 100) y editar `allowCompanies` y `denyCompanies`.
- **RF-10.** El sistema rechaza un `rolloutPercentage` fuera de 0 a 100 o no entero.
- **RF-11.** El sistema rechaza guardar una regla en la que la misma empresa aparezca en `allowCompanies` y en `denyCompanies` del mismo ambiente.
- **RF-12.** El usuario puede activar y desactivar el kill switch de una flag con una sola acción desde la lista o el detalle de la flag.

### Empresas

- **RF-13.** El usuario puede crear, editar y listar empresas (`companyId` único e inmutable, `name` obligatorio).
- **RF-14.** Las listas de permitidas y bloqueadas solo aceptan empresas existentes en el catálogo.

### Evaluación

- **RF-15.** El sistema expone `GET /api/v1/evaluate?flag={key}&env={env}&company={companyId}` y devuelve `{ "flag", "env", "value", "reason" }` aplicando las reglas de la sección 5.
- **RF-16.** El endpoint de evaluación exige el header `X-API-Key` con la clave configurada. Sin ella, o si es incorrecta, responde `401`. Un `env` inválido devuelve `400`.
- **RF-17.** El sistema expone `GET /api/v1/flags?env={env}`, que devuelve el estado de todas las flags no archivadas de ese ambiente para que el SDK pueda cachearlas en bloque.

### Auditoría y rollback

- **RF-18.** Toda creación, modificación, archivado, cambio de kill switch y rollback exige un motivo (mínimo 5 caracteres) y genera una entrada de auditoría con fecha y hora, flag, acción, estado anterior completo, estado nuevo completo y motivo.
- **RF-19.** Las entradas de auditoría no se pueden editar ni borrar desde la UI ni desde la API.
- **RF-20.** Desde el historial de una flag, el usuario puede restaurar el estado anterior de cualquier entrada con una sola acción (más el motivo). El rollback genera su propia entrada de auditoría.

### Ciclo de vida

- **RF-21.** Una flag se marca como **obsoleta** si cumple al menos una condición: (a) `expiresAt` ya pasó, o (b) en `production` lleva 30 días o más sin cambios con `rolloutPercentage` en 0 o 100.
- **RF-22.** Un dashboard muestra el total de flags activas, el número de obsoletas y la lista de obsoletas con su `owner`, el motivo por el que son obsoletas y la fecha del último cambio.

### SDK de backend

- **RF-23.** El SDK expone `isEnabled(flagKey, companyId?, defaultValue)` y evalúa localmente con la misma lógica y el mismo hash que el servidor, a partir del estado obtenido en RF-17.
- **RF-24.** El SDK refresca su caché cada 30 segundos (valor configurable).
- **RF-25.** Si el servidor no responde, el SDK sigue usando el último estado conocido. Si nunca obtuvo un estado, devuelve `defaultValue`. En ningún caso lanza una excepción a la aplicación.

## 7. Requerimientos no funcionales

| ID | Categoría | Requerimiento |
|---|---|---|
| RNF-01 | Rendimiento | El endpoint de evaluación responde en < 50 ms (p95) con 500 flags y 1.000 empresas cargadas. La evaluación en el SDK con la caché cargada tarda < 1 ms. |
| RNF-02 | Propagación | Un cambio guardado se refleja en las aplicaciones con SDK en ≤ 60 segundos. |
| RNF-03 | Resiliencia | Una caída de la herramienta no provoca errores en las aplicaciones consumidoras (ver RF-25). |
| RNF-04 | Determinismo | Para la misma entrada, servidor y SDK devuelven el mismo resultado. Se verifica con una suite de tests compartida. |
| RNF-05 | Persistencia | SQLite en modo WAL. Todo cambio y su entrada de auditoría se guardan en la misma transacción. |
| RNF-06 | Backup | La base de datos es un único archivo y se respalda copiándolo. El procedimiento queda documentado. |
| RNF-07 | Seguridad | Credenciales demo y API key en variables de entorno, nunca en el repositorio. La contraseña no aparece en logs. Cookie de sesión `HttpOnly`. |
| RNF-08 | Despliegue | Una sola instancia. Arranque con un comando y migraciones de esquema automáticas al iniciar. |
| RNF-09 | Usabilidad | Cambiar el porcentaje o activar el kill switch de una flag no requiere más de 3 interacciones desde la lista de flags. |
| RNF-10 | Observabilidad | Cada petición de evaluación queda registrada en un log estructurado con flag, env, resultado, reason y latencia. |

## 8. Criterios de aceptación del MVP

El MVP se considera completo cuando **todos** los siguientes escenarios pasan, ya sea con tests automatizados o con una demo verificada:

1. **Login:** con credenciales demo correctas se accede al dashboard. Con credenciales incorrectas aparece un error y no se crea sesión. Sin sesión, `/api/admin/*` responde `401`.
2. **Crear flag:** al crear `checkout.new-flow`, la evaluación en cualquier ambiente devuelve `false` con `ENV_DISABLED`. Crear otra flag con la misma key falla.
3. **Ambiente:** con `enabled = true` y un rollout del 100 % solo en `staging`, la evaluación devuelve `true` en `staging` y `false` (`ENV_DISABLED`) en `production`.
4. **Empresa:** en `production` con `enabled = true` y un rollout del 0 %, la empresa `acme` en la lista de permitidas obtiene `true` (`COMPANY_ALLOWED`) y la empresa `globex` obtiene `false` (`DEFAULT`).
5. **Bloqueo:** con un rollout del 100 % y `globex` en la lista de bloqueadas, `globex` obtiene `false` (`COMPANY_DENIED`).
6. **Rollout:** con un rollout del 30 % sobre 1.000 IDs de empresa sintéticos, entre 25 % y 35 % obtienen `true`. Repetir la evaluación da resultados idénticos. Al subir al 50 %, todas las empresas que tenían `true` lo conservan.
7. **Kill switch:** con la flag activa al 100 % en todos los ambientes, activar el kill switch hace que todas las evaluaciones devuelvan `false` (`KILL_SWITCH`), incluso para empresas en la lista de permitidas.
8. **Auditoría:** un cambio sin motivo se rechaza. Con motivo, aparece en el historial con el estado anterior y el nuevo.
9. **Rollback:** tras cambiar el rollout de 10 % a 80 %, el rollback restaura el 10 % y crea una nueva entrada de auditoría.
10. **Propagación:** un cambio guardado se refleja en una aplicación de prueba con SDK en ≤ 60 segundos, sin reiniciarla.
11. **Fallback:** con la herramienta detenida, la aplicación de prueba sigue respondiendo con el último estado conocido. Si arranca sin conexión, usa `defaultValue`.
12. **Obsoletas:** una flag con `expiresAt` en el pasado aparece en el dashboard de obsoletas con su `owner`.
13. **API key:** una evaluación sin `X-API-Key`, o con una clave incorrecta, responde `401`.

## 9. Riesgos y supuestos

### Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| SQLite en una sola instancia es un punto único de fallo. | Si cae, no se pueden hacer cambios. | El SDK sigue funcionando con su caché (RF-25). Backups documentados (RNF-06). La migración a una base de datos servidor queda como evolución. |
| Usuario demo compartido: no se sabe quién hizo cada cambio. | Trazabilidad limitada. | El motivo es obligatorio en cada cambio. Uso restringido a la red interna. Añadir usuarios reales es la siguiente iteración. |
| Que servidor y SDK den resultados distintos. | Comportamiento inconsistente y difícil de depurar. | Algoritmo de hash documentado y suite de tests compartida (RNF-04). |
| Acumulación de flags sin limpiar en el código. | Deuda técnica y complejidad. | `owner` y `expiresAt` obligatorios, y dashboard de obsoletas (RF-21, RF-22). |
| Uso de la herramienta para configuración que no es una feature (límites, precios). | Mal uso del modelo booleano. | Solo flags booleanas en el MVP. Documentar el uso previsto. |
| Error humano en producción (por ejemplo, un rollout al 100 % por equivocación). | Exposición accidental de una feature. | Motivo obligatorio, rollback en un clic y kill switch. |

### Supuestos

- La herramienta solo es accesible desde la red interna. El usuario demo no queda expuesto a internet.
- Todas las aplicaciones consumidoras conocen el `companyId` en el momento de evaluar.
- El volumen se mantiene por debajo de 500 flags y 1.000 empresas en el horizonte del MVP.
- Una propagación de hasta 60 segundos es aceptable para todos los casos de uso, incluido el kill switch.
- El SDK se implementa para un solo lenguaje de backend (el stack principal). Los demás servicios usan la API REST directamente.
- Los tres ambientes (`development`, `staging`, `production`) cubren las necesidades actuales.
