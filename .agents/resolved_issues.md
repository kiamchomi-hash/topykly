# 📜 Registro de Decisiones y Problemas Resueltos (Memoria de Agentes)

Este archivo sirve como la memoria de auditoría para el equipo de agentes de TOPYKLY. Antes de proponer cualquier refactorización de código o emitir una alerta de seguridad, debes consultar esta lista para evitar duplicar diagnósticos sobre problemas ya mitigados o decisiones de diseño intencionales.

---

## 🔒 Refuerzos de Seguridad Mitigados y Aprobados

### 1. Exposición de Archivos de Servidor y Estáticos
*   **Estado:** Solucionado y Verificado.
*   **Detalle:** La función `safeFilePathFromUrl` en `preview-server.js` bloquea estrictamente accesos a archivos con puntos iniciales (`.env`, `.git/`, `.data/`), así como los directorios de backend `services/`, `scripts/` y `tests/`.
*   **Acción del Agente:** No sugerir bloqueos adicionales en rutas estáticas a menos que se cree una nueva carpeta sensible fuera de estas exclusiones.

### 2. Hashing de Contraseñas y Rate Limits en Autenticación
*   **Estado:** Solucionado y Verificado.
*   **Detalle:** Los endpoints de autenticación local por contraseña (`/api/auth/password/*`) corren bajo el rate limit de autenticación restringido (`auth`, 30 peticiones/minuto) en lugar del general de la API para prevenir ataques de fuerza bruta contra el hashing de CPU `scrypt`.

### 3. Spoofing de IP y Rate Limit Bypass
*   **Estado:** Solucionado y Verificado.
*   **Detalle:** Se implementó la directiva `TRUST_PROXY` (`TOPYKLY_TRUST_PROXY`). Si está desactivada, el servidor obtiene la IP directamente del socket TCP del cliente, impidiendo que atacantes evadan los bloqueos rotando cabeceras `X-Forwarded-For`.

### 4. Denegación de Servicio (DoS) por Memoria
*   **Estado:** Solucionado y Verificado.
*   **Detalle:** Se implementó un límite de tamaño de cuerpo JSON de 1MB (`MAX_JSON_BODY_BYTES`) en `readJsonBody`. Conexiones con payloads mayores se descartan inmediatamente para evitar ataques de agotamiento de memoria (OOM).

### 5. Inhabilitación de Login Local en Producción
*   **Estado:** Solucionado y Verificado.
*   **Detalle:** El servidor deshabilita la pantalla y ruta de login de desarrollo local en producción a menos que se configure explícitamente `TOPYKLY_ALLOW_LOCAL_LOGIN=true`.

### 6. Mitigación de Bloqueos de Concurrencia SQLite
*   **Estado:** Solucionado y Verificado.
*   **Detalle:** Se configuró la directiva `PRAGMA busy_timeout = 5000;` al inicializar la base de datos en `backend-store.js` para evitar fallas bajo transacciones de escritura concurrentes.

### 7. Seguridad de Sesiones (Cookies)
*   **Estado:** Solucionado y Verificado.
*   **Detalle:** El cliente ya no almacena credenciales ni tokens en `localStorage` o cabeceras personalizadas de sesión, dependiendo exclusivamente de cookies seguras `HttpOnly` y `SameSite=Lax` firmadas criptográficamente.

---

## 📐 Decisiones de Arquitectura e Inmutabilidad

### 1. Gestión de Estado Centralizada (Store)
*   **Estado:** Decisión de diseño.
*   **Detalle:** El estado reside únicamente en `features/shared/store.js` y `app-store.js`. Los reducers son inmutables y devuelven un nuevo estado (`nextState`). Los componentes del UI se suscriben al store y se re-renderizan mediante DOM Diffing (`ui/render-utils.js`).
*   **Acción del Agente:** No sugerir mutaciones directas de estado ni la introducción de frameworks pesados de gestión de estado.

---

## 🔎 SEO, Rendimiento y Escalabilidad Mitigados

### 1. Indexación de Contenido Ofensivo
*   **Estado:** Solucionado y Verificado.
*   **Detalle:** Los temas con lenguaje ofensivo en título o mensajes, o con reportes abiertos, reciben `noindex` y se excluyen de sitemap, listados SEO y temas relacionados aunque superen el mínimo de comentarios.

### 2. Carga Inicial de la Mascota y Coloris
*   **Estado:** Solucionado y Verificado.
*   **Detalle:** Los paneles cerrados no crean la mascota. `ui/mascot.js`, su PNG y `services/coloris-loader.js` se cargan únicamente después de la interacción correspondiente.

### 3. Polling y Concurrencia SQLite
*   **Estado:** Mitigado para la escala actual.
*   **Detalle:** La sincronización principal usa SSE y conserva polling de respaldo espaciado. SQLite opera con WAL, `busy_timeout`, `synchronous=NORMAL`, `temp_store=MEMORY` y autocheckpoint.
*   **Acción del Agente:** Para varias instancias, proponer pub/sub compartido y una base multiinstancia; no volver a recomendar reducir el polling como si SSE no existiera.
