# Proyecto TOPYKLY - Arquitectura activa

## Descripción general

TOPYKLY combina un frontend de módulos ES sin framework con un servidor HTTP de Node, una API JSON y persistencia SQLite. `app.js` carga el bootstrap de `controller-app.js`; la aplicación activa no se inicia desde `features/`.

## Flujo de datos

El flujo de una acción de usuario es:

`evento UI -> controller-actions/controller-chat-actions -> services/api.js -> servidor/backend-store -> reducer -> render`

- `app-store.js` y los stores pequeños conservan el estado compartido del cliente.
- `store-logic.js` centraliza reducers e hidratación. Las actualizaciones deben ser inmutables.
- `controller-render.js` compone los renderers de `ui/`.
- `ui/render-utils.js` reconcilia nodos por identidad y evita limpiar listas completas con `innerHTML = ""`.
- `services/api.js` realiza llamadas HTTP reales; no es una API simulada.

## Backend y persistencia

- `services/preview-server.js` sirve archivos públicos y expone la API HTTP.
- `services/backend-store.js` implementa persistencia y reglas de negocio sobre SQLite.
- `services/auth-service.js` concentra cookies, OIDC, Turnstile y entrega de códigos por correo.
- `services/seo-pages.js` y `services/social-card.js` generan superficies públicas para compartir e indexar.
- SQLite se inicializa con `busy_timeout`; no retirar esa protección sin una alternativa verificada.

## Reglas de negocio que deben preservarse

- Al comentar, un tema activo vuelve al primer puesto.
- Sólo los primeros 20 temas se muestran y la ventana activa se limita a 40.
- Cada tema conserva el mensaje raíz y los últimos 29 comentarios.
- Los temas archivados son de sólo lectura tanto en UI como en el límite del servicio.
- Las cookies de sesión son `HttpOnly`; el cliente no debe almacenar credenciales en `localStorage`.

## Directorios y módulos

- `controller-*.js`: bootstrap, acciones, sincronización, viewport y render.
- `ui/`: renderers, DOM helpers y eventos de presentación.
- `services/`: API cliente, servidor, autenticación, persistencia, SEO y tarjetas sociales.
- `features/`: arquitectura paralela o en transición; no extenderla como ruta principal salvo que una tarea migre explícitamente el bootstrap y sus pruebas.
- `tests/run.mjs`: suites deterministas seleccionables (`core`, `ui`, `backend`, `server`).
- `tests/smoke.mjs`: pruebas HTTP con servidor y base aislados.

## Criterios de cambio

- Preferir módulos existentes y refactors pequeños antes que nuevas capas o frameworks.
- Confirmar la ruta activa mediante imports desde `app.js` antes de editar código paralelo.
- Actualizar pruebas al cambiar render, ranking, autenticación, moderación o transiciones de estado.
- Consultar `.agents/resolved_issues.md` antes de repetir hallazgos arquitectónicos o de seguridad ya resueltos.
