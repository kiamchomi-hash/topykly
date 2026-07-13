# Handoff: login, seguridad y recuperación de cuenta

Estado general (actualizado 2026-07-12): la implementación de recuperación de contraseña y vinculación de Google está **completa y verificada** (backend + UI + tests + prueba en navegador). Sigue pendiente: commit, push, deploy y la configuración de HSTS en Cloudflare. La rama local es `main` y el repo está sucio con cambios propios, cambios del usuario y archivos sin trackear; no conviene resetear ni limpiar el árbol.

## Contexto del repo

- Ruta: `C:\Users\matia\Desktop\chetrend`
- Producción actual: Render detrás de Cloudflare, no Vercel.
- `vercel.json` no aplica al despliegue actual de producción.
- El fix local de HSTS está en `services/preview-server.js`, pero producción sigue sin HSTS hasta desplegar y configurar Cloudflare para cubrir apex + www.
- No hay credenciales ni herramienta de Cloudflare disponibles.

## Skills usados en el trabajo anterior

Se leyeron completamente y se usaron:

- `flow_auditor`
- `security_auditor`
- `qa_tester`
- `vercel-deploy`

Si se continúa el trabajo en otro turno y la tarea vuelve a coincidir con esos skills, hay que volver a leer sus `SKILL.md`.

## Trabajo ya completado antes de esta etapa

- IDs estables de usuario con UUID.
- `username` único e inmutable separado de nombres visibles repetibles.
- Nombres reales o display names pueden repetirse, por ejemplo varias personas llamadas Abril.
- Enforcement de emails verificados en OIDC.
- Auto-link seguro entre cuenta password y Google cuando el email verificado coincide.
- Colisión legacy no verificada falla de forma segura.
- Emails públicos removidos.
- Tests previos pasaban antes de los cambios parciales de recuperación/linking.

## Cambios parciales ya aplicados

### `services/backend-store.js`

- Nuevas constantes de recuperación:
  - TTL de código: 10 minutos.
  - Cooldown de reenvío: 60 segundos.
  - Máximo de intentos: 5.
  - Límites durables por email/IP: 5/20 por hora.
- Helpers HMAC usando `TOPYKLY_AUTH_CHALLENGE_SECRET || TOPYKLY_SESSION_SECRET || CHETREND_SESSION_SECRET`.
- En producción, si falta secreto, debe responder 503; en desarrollo usa fallback aleatorio por proceso.
- Nueva tabla `password_reset_challenges` con índices.
- `mapViewerRow` expone solo booleanos `hasPassword` y `canLinkGoogle`.
- `createStoredPasswordResetChallenge`:
  - valida email,
  - usa HMAC para email/IP,
  - evita guardar emails plaintext de cuentas inexistentes,
  - aplica rate limit y cooldown durables,
  - devuelve desafío genérico para emails inexistentes o limitados,
  - invalida desafíos activos previos.
- `verifyStoredPasswordResetChallenge`:
  - valida código, TTL, intentos y replay,
  - compara HMAC en tiempo constante,
  - actualiza password con scrypt,
  - marca email como verificado,
  - conserva rol/admin,
  - consume desafíos,
  - revoca sesiones anteriores,
  - crea sesión rotada,
  - conserva UUID y datos del usuario.
- Helpers de vinculación:
  - `getIdentityLinkTarget` exige sesión activa, cuenta registrada con password, proveedor no vinculado y password actual correcta.
  - `linkIdentityToCurrentUser` exige flow firmado, email Google verificado y exact-match, sin provider/subject/email duplicado, y conserva `users.id`.
- Store expone:
  - `createPasswordResetChallenge`
  - `discardPasswordResetChallenge`
  - `verifyPasswordResetChallenge`
  - `prepareIdentityLink`
  - `completeIdentityLink`
- Mensaje `ACCOUNT_LINK_REQUIRED` actualizado para indicar login/recuperación y vinculación desde perfil.

### `services/auth-service.js`

- `EMAIL_CODE_CONTENT` acepta `register` y `password_reset`.
- `sendEmailCode` acepta `purpose`.
- `buildReturnUrl` acepta `authAction`.
- `clearFlowCookies` borra cookies de flow actuales y legacy.
- El flow OIDC soporta `purpose: "login"` y `purpose: "link"`.
- En link guarda `targetUserId` y `expectedEmail` firmados.
- Link usa `prompt=select_account`.
- Callback valida campos de link y redirige con `authAction=google-linked`.
- Falta pulir: el footer del email sigue diciendo “No se creó ninguna cuenta”, texto incorrecto para recuperación.

### `services/preview-server.js`

- Respuestas JSON con `Cache-Control: no-store` por defecto.
- Nuevas rutas:
  - `POST /api/auth/password/reset/request`
  - `POST /api/auth/password/reset/confirm`
  - `POST /api/auth/account-link/start`
- Request de reset:
  - exige Turnstile,
  - exige Resend configurado,
  - crea desafío genérico,
  - envía email solo si hay target real,
  - traga fallos de delivery para no permitir enumeración,
  - consume desafío si falla delivery,
  - responde 202 genérico con `challengeId`, `expiresInSeconds` y `message`.
- Confirm de reset implementado.
- Start de account-link implementado con preflight de sesión, password y Turnstile.
- Callback distingue flow de link vs login normal.
- Errores limpian cookies.
- Scope de rate-limit cubre todo `/api/auth/`.
- HSTS se envía solo en producción HTTPS según `NODE_ENV`/`VERCEL_ENV` y forwarded proto.

### Cliente/controlador

- `services/api.js`:
  - `requestPasswordResetCode`
  - `confirmPasswordReset`
  - `startAccountLink`
- `controller-actions.js`: handlers equivalentes exportados.
- `controller-app.js`:
  - lee y limpia `authAction`,
  - feedback específico para `ACCOUNT_LINK_REQUIRED`,
  - pasa `initialAuthAction` y handlers nuevos,
  - muestra feedback de éxito para `google-linked`.

### HTML/UI parcial

- `index.html` agregó:
  - `authEmailField`
  - `authPasswordField`
  - `authPasswordConfirmField`
  - `authPasswordConfirmInput`
  - `authRecoveryButton`
  - `profileLinkGoogleButton`
- `ui/dom.js` registra esos IDs.
- `ui/profile-modal.js` muestra/oculta `profileLinkGoogleButton` según `viewer.canLinkGoogle`.
- `ui/topbar-action-events.js` solo tiene variables nuevas:
  - `authRecoveryMode`
  - `authRecoveryStep`
  - `authRecoveryChallenge`
  - `authAccountLinkMode`
  - `authAccountLinkRequested`
- La UI todavía no conecta la máquina de estados de recuperación ni vinculación.

## Completado el 2026-07-12

- `ui/topbar-action-events.js` terminado:
  - modo recuperación con máquina de estados (`request` → `verify`): paso email-only, Turnstile, request genérico, código + nueva password + confirmación, validación local, reenvío con cooldown, feedback de éxito;
  - modo account-link pidiendo password actual, llama `startAccountLink` y redirige a Google (`prompt=select_account`);
  - listeners para `authRecoveryButton` y `profileLinkGoogleButton`;
  - auto-open del modo link cuando `authAction=link-account` y el viewer tiene `canLinkGoogle` (cubre el caso post-login/reset por colisión, con password + Turnstile fresco);
  - `syncAuthPasswordMode` reescrito con los modos recovery/link (título, tabs, campos, labels, botones);
  - reset correcto de estado/campos al cerrar el modal, cambiar de modo y volver atrás;
  - los mensajes persistentes no usan el overlay `authStatus` (tapaba el formulario); la copia genérica vive en el hint inline del código.
- CSS de `.auth-recovery-button` agregado junto a `.auth-resend-button`; sin overflow horizontal en desktop ni mobile (verificado con Playwright).
- Footer del email ahora depende del propósito (`register` vs `password_reset`) en `services/auth-service.js`, con redacción en español neutro.
- Tests agregados en `tests/run.mjs` (todos pasan):
  - "backend password reset is indistinguishable, rate limited and rotates credentials safely" (email conocido/desconocido indistinguible, cooldown de reenvío, expiración, 5 intentos, replay, password vieja vs nueva, revocación de sesiones, UUID estable);
  - "backend account linking demands fresh password proof and a matching Google identity" (password/sesión/email/subject conflictivos + link exitoso + `ACCOUNT_ALREADY_LINKED`);
  - "auth service recovery emails use the password reset copy";
  - "auth modal walks the password recovery flow from request to confirmation" (estados UI);
  - asserts de caracterización del fuente actualizados a los nuevos modos.
- Verificación ejecutada: `node tests/run.mjs` OK, `node tests/smoke.mjs` OK, `git diff --check` sin errores de whitespace, prueba browser local con Playwright:
  - recuperación: 30 checks OK, capturas en `output/playwright/auth-recovery-*.png`;
  - vinculación: 14 checks OK hasta el redirect real a `accounts.google.com`, capturas en `output/playwright/account-link-*.png`.

## Falta hacer

- Commit de los archivos intencionales y push a `main` (deploy Render) cuando el usuario lo autorice.
- HSTS en Cloudflare para apex + www (acción externa del usuario, ver sección HSTS).
- Auditoría live de seguridad post-deploy.
- Tests opcionales que quedaron fuera: signed OIDC link purpose/cookies y rutas con Turnstile + `Cache-Control: no-store` a nivel servidor HTTP.
- Actualizar reportes `.agents/reports/flows.json`, `security.json`, `qa.json` solo después del deploy verificado.

## Estado de verificación

Suite completa (`tests/run.mjs` y `tests/smoke.mjs`) en verde el 2026-07-12 después de todos los cambios. Flujos de recuperación y vinculación verificados en navegador contra el servidor local real.

## Cuidado con el worktree

- Hay 42 archivos tracked modificados y muchos untracked.
- Muchos cambios son del usuario.
- No usar `git reset`, `git checkout --`, `git clean` ni staging amplio sin revisar.
- Posibles fuentes nuevas del usuario que pueden ser necesarias:
  - `terms.html`
  - `ui/report-modal.js`
  - `report-reasons.js`
- Hay capturas y artefactos sin trackear que no deberían commitearse a ciegas.
- `.agents/reports/flows.json` está modificado por el usuario; preservar.

## HSTS y deploy

- La auditoría live detectó que `https://www.topykly.com/` y apex no tenían HSTS.
- Render probablemente despliega por push a `main`.
- Después de terminar UI/tests, hacer commit solo de archivos intencionales y push a `main` si el usuario lo sigue autorizando.
- Para cubrir apex + www, configurar HSTS en Cloudflare:
  - 12 meses;
  - `includeSubDomains` solo después de verificar que todos los subdominios sirvan HTTPS;
  - `preload` apagado por ahora.
- Como no hay credenciales/herramienta de Cloudflare, esa parte puede quedar como acción externa del usuario.
- No usar Vercel deploy para producción.

## Siguiente paso recomendado

Retomar completando la UI en `ui/topbar-action-events.js`, corregir el footer de emails, agregar tests de recuperación/linking, correr la suite, hacer prueba browser y recién después preparar commit/push/deploy.
