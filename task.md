# Task

Implementacion del frontend de chat social tipo Cafe/IRC.

## Estado de esta etapa

- Backend embebido en `Node + SQLite` implementado dentro del repo.
- API same-origin implementada desde el servidor preview.
- Frontend actual integrado al backend sin rediseno general.
- Reglas activas: `40` temas activos, `20` visibles, reordenamiento por ultima actividad y expulsion del tema `41`.
- Cada tema conserva `1` mensaje raiz fijo y `29` respuestas rotativas.
- Usuarios invitados y registrados con sesion persistente y rate limits iniciales.
- Boton manual de `Actualizar` conectado al backend real.
- Comentarios sobre temas expulsados o bloqueados muestran bloqueo con feedback visual de candado.
- Suite de tests actualizada para cubrir dominio, backend y regresiones del frontend.

## Alcance

- Barra superior fija con `Perfil`, cambio de tema, titulo del tema activo, `Contacto admin` y `Tienda`.
- Desktop con cinco paneles:
  - temas
  - crear nuevo tema
  - chat principal
  - usuarios conectados
  - rankings
- Mobile simplificado con:
  - vista principal con temas y creacion
  - chat al entrar en un tema
  - menus hamburguesa laterales para temas, usuarios y rankings
- Persistencia con backend embebido, sin tiempo real.
- Boton manual de `Actualizar` con SVG.
- `20` temas visibles en la lista principal.
- Existen otros `20` temas activos que quedan fuera de esa ventana visible inicial.
- El sistema mantiene un maximo de `40` temas activos y revivibles.
- Cada tema conserva `1` mensaje inicial fijo y solo las ultimas `29` respuestas.
- Ranking unico por tema.
- Variante de marca neutral para convivir con `TOPYKLY` como segunda pagina.
- Usuarios invitados y usuarios registrados.

## Notas

- Implementado como app autocontenida con HTML, CSS y JS puros en frontend, mas backend embebido en Node + SQLite.
- No hay sincronizacion en tiempo real en esta etapa.
- Para backend, asumir una escala baja: aproximadamente `40` temas activos.
- Cada tema conserva un maximo de `30` mensajes totales: `1` mensaje fijo del tema y `29` respuestas rotativas.
- Cuando entra una respuesta nueva y ya existen `29` respuestas, desaparece la mas antigua.
- Capacidad esperada en ventana activa: alrededor de `1200` mensajes almacenados (`40 x 30`).
- Los temas se ordenan por actividad reciente.
- Si un tema recibe un comentario, sube al puesto `0`.
- Si ese tema estaba dentro de los `20` activos pero fuera de la ventana visible, pasa a ser el primer tema visible.
- La lista visible debe reacomodarse desplazando hacia abajo al resto de temas.
- Los temas ubicados entre las posiciones `21` y `40` no son navegables manualmente por un usuario nuevo.
- Solo vuelven a estar accesibles para navegacion normal si suben por actividad y reingresan a la ventana visible.
- Crear un tema nuevo lo deja directamente en el puesto `0`.
- Abrir o leer un tema no cambia el orden.
- Si aparece un tema `41`, el tema que cae al ultimo lugar sale del conjunto activo.
- Un tema que ya salio de esos `40` activos deja de ser revivible, aunque algun usuario todavia lo tenga abierto.
- Los temas expulsados pueden seguir guardados para usos futuros, por ejemplo reactivacion paga, pero no vuelven al conjunto activo en esta etapa.
- Si un usuario tiene abierto un tema expulsado e intenta comentar, el backend debe bloquear el comentario.
- En ese caso, el frontend debe mostrar una animacion de candado sobre la accion de comentar.
- El mensaje inicial fijo del tema es el mismo mensaje que crea el tema.
- Ese mensaje inicial queda fijo como raiz del tema y no rota con el limite de respuestas.
- Los usuarios comunes no pueden editar ni borrar mensajes.
- Cuando una respuesta sale del limite de `29`, se elimina fisicamente de la base de datos.
- La primera version se sincroniza por carga inicial, acciones del usuario y boton manual de `Actualizar`.
- No hace falta sobredimensionar la base de datos ni agregar infraestructura pesada para esta etapa.

## Usuarios y Limites

- Los usuarios invitados se identifican con `*` al inicio del nombre.
- Los invitados conservan la misma identidad temporal al recargar la pagina.
- Los nicks de invitados pueden repetirse.
- Los invitados pueden crear temas una vez cada `2` horas.
- Los invitados pueden comentar una vez cada `5` minutos.
- Los usuarios registrados pueden crear temas una vez cada `30` minutos.
- Los usuarios registrados pueden comentar con un delay minimo de `10` segundos entre mensajes.
- Los usuarios registrados no tienen mas ventajas funcionales que esas en esta etapa.

## Regla de Orden Concurrente

- Si entran dos comentarios casi al mismo tiempo, el backend debe serializarlos.
- El desempate puede resolverse por orden real de insercion en base de datos.
- El comentario que quede persistido ultimo define el puesto `0` final del tema mas reciente.
- Conviene guardar `createdAt` y un `id` incremental para que el orden sea deterministicamente reproducible.

## Backend Inicial

- Resolver persistencia simple para temas, mensajes y usuarios.
- Mantener el primer mensaje del tema como mensaje fijo y mensaje raiz de creacion.
- Aplicar limite de `29` respuestas por tema, ademas del mensaje fijo.
- Reordenar temas por ultima actividad para reflejar subidas inmediatas al frente.
- Expulsar del conjunto activo al tema que quede en posicion `41` y bloquear su reactivacion posterior.
- Aplicar rate limits distintos para invitados y registrados.
- Guardar temas expulsados sin permitir que revivan en esta fase.
- Rechazar comentarios sobre temas expulsados.
- Eliminar fisicamente de la base las respuestas que excedan el limite rotativo.
- Mantener mensajes inmutables.
- Incluir moderacion desde el dia `1`.
- Priorizar una API chica y directa antes que tiempo real o colas.
- Elegir almacenamiento liviano para la primera version, con posibilidad de migrar despues si hiciera falta.

## Proximo Trabajo Backend

- Definir el esquema de tablas inicial para `users`, `topics`, `messages`, `sessions`, `reports` y acciones de moderacion.
- Modelar estados de tema como `activo`, `expulsado`, `bloqueado` y `fijado`.
- Guardar identidad temporal persistente para invitados entre recargas.
- Implementar creacion de temas con mensaje raiz fijo.
- Implementar comentarios con limite rotativo de `29` respuestas y borrado fisico de las mas antiguas.
- Implementar orden por actividad usando un identificador monotono de mensaje para evitar empates reales.
- Implementar mantenimiento del conjunto de `40` temas activos y la ventana visible de `20`.
- Rechazar comentarios en temas expulsados o bloqueados y devolver una respuesta que permita mostrar la animacion de candado.
- Aplicar rate limits distintos para invitados y usuarios registrados.
- Preparar endpoints minimos para listar temas visibles, abrir tema activo, crear tema, comentar y actualizar manualmente.
- Preparar endpoints de moderacion para eliminar comentarios, bloquear temas, fijar temas, expulsar usuarios, bloquear por sesion, bloquear por IP y marcar entidades como problematicas.
- Dejar la logica critica dentro de transacciones para evitar inconsistencias con comentarios simultaneos.
- Mantener el backend simple y liviano, sin tiempo real en esta etapa.

## Moderacion Inicial

- Un moderador puede eliminar comentarios.
- Un moderador puede bloquear temas.
- Un moderador puede fijar temas.
- Un moderador puede expulsar usuarios.
- Un moderador puede bloquear por sesion.
- Un moderador puede bloquear por IP.
- Un moderador puede marcar temas como reportados o problematicos.
- Un moderador puede marcar mensajes como reportados o problematicos.
- Un moderador puede marcar usuarios como problematicos.
- La capacidad de borrar mensajes es una excepcion exclusiva de moderacion; no aplica a usuarios comunes.

## Inspiracion

Este proyecto toma inspiracion de decisiones de producto, navegacion y UI vistas en:

- [Zulip](https://github.com/zulip/zulip)
- [Elk](https://github.com/elk-zone/elk)
- [Phanpy](https://github.com/cheeaun/phanpy)
- [Misskey](https://github.com/misskey-dev/misskey)
- [Sengi](https://github.com/nolanlawson/sengi)

## Pendientes

- Endpoints completos de moderacion.
- Panel de admin.
- Autenticacion real de usuarios registrados.
- Espacio reservado para publicidad.
- Boton de reporte.

## Pendiente diferido: rollout de Google Auth

- El repo ya tiene integrada la base tecnica para login externo con Google via OAuth/OIDC en el backend propio.
- Falta configurar Google Cloud / Google Auth Platform para pasar de login local a login real con usuarios.

### Objetivo

- Habilitar login real con Google para usuarios de `TOPYKLY`.
- Mantener la app fuera de productos facturables innecesarios.
- Evitar escenarios de facturacion sorpresa o deuda dificil de pagar.

### Proyecto recomendado en Google

- Crear un proyecto nuevo y separado solo para autenticacion, por ejemplo `topykly-auth-prod`.
- No mezclar este proyecto con otros servicios de infraestructura.
- No habilitar Compute, Cloud Run, Maps, Identity Platform ni otros productos si no son estrictamente necesarios.
- Revisar inmediatamente si el proyecto quedo asociado a una cuenta de billing.
- Si el proyecto quedo asociado a billing, dejar documentado si se mantiene o se desactiva.

### Setup pendiente en Google Auth Platform

- Entrar a `Google Auth Platform`.
- Configurar `Branding` con nombre de app, support email y developer contact email.
- Configurar `Audience` como `External` si va a poder entrar cualquier cuenta Google.
- Crear un cliente OAuth tipo `Web application`.
- Guardar `Client ID` y `Client Secret` en un lugar seguro al momento de crearlos.

### Redirect URIs para este repo

- Desarrollo local:
  - `http://127.0.0.1:4173/auth/oidc/callback`
  - opcionalmente `http://localhost:4173/auth/oidc/callback`
- Produccion:
  - `https://<dominio>/auth/oidc/callback`

### Variables de entorno a completar luego

- Crear `.env` a partir de `.env.example`.
- En VPS, definir TOPYKLY_DB_PATH apuntando a una ruta persistente, por ejemplo /var/lib/topykly/topykly.sqlite.
- Completar:
  - `TOPYKLY_SESSION_SECRET`
  - `TOPYKLY_AUTH_PROVIDER_NAME=Google`
  - `TOPYKLY_OIDC_ISSUER=https://accounts.google.com`
  - `TOPYKLY_OIDC_CLIENT_ID`
  - `TOPYKLY_OIDC_CLIENT_SECRET`
  - `TOPYKLY_OIDC_SCOPE=openid profile email`
- Cuando exista dominio productivo, completar:
  - `TOPYKLY_PUBLIC_ORIGIN=https://<dominio>`
  - `TOPYKLY_COOKIE_SECURE=true`

### Billing / seguridad operativa

- Confirmar explicitamente si el proyecto de auth tiene billing activo o no.
- Si billing queda activo, crear presupuestos y alertas desde el dia 1.
- Recordar que los presupuestos de Google no son un freno duro de gasto; solo alertan.
- Si alguna vez se necesita freno automatico, evaluar automatizacion para deshabilitar billing del proyecto.
- Mantener IAM minimo: solo admins necesarios.
- No guardar secretos en el repo ni en capturas.

### Verificacion y limites de Google

- Para pruebas chicas o uso personal, puede funcionar sin verificacion completa.
- Si la app crece, preparar verificacion de OAuth app antes de escalar en serio.
- Revisar limite de usuarios nuevos y grant rate si la adopcion empieza a subir rapido.
- Si se apunta a miles o millones de usuarios, tratar autenticacion, verificaciones y cuotas como trabajo de produccion, no como tarea secundaria.

### Antes de abrir a publico

- Tener dominio propio definido.
- Tener HTTPS activo.
- Registrar dominio autorizado en Google.
- Tener `Privacy Policy`.
- Tener idealmente `Terms`.
- Reprobar login completo en local y en produccion.

### Nota de arquitectura

- Google login no resuelve por si solo la escalabilidad total de la app.
- Si `TOPYKLY` crece mucho, el cuello de botella va a ser tambien la infraestructura propia actual (`preview server + SQLite`).
- Antes de escalar fuerte, evaluar migracion de persistencia, sesiones y despliegue a arquitectura de produccion.

## Idea pendiente: moderacion exhaustiva del buffer vivo

- La ventana activa actual permite un universo moderable acotado:
  - `40` temas activos
  - `30` mensajes maximos por tema
  - total aproximado de `1200` mensajes vivos/revivibles en el conjunto activo
- Explorar una estrategia de moderacion continua sobre ese buffer vivo en lugar de una moderacion solo reactiva por reportes.

### Enfoque recomendado

- No modelarlo como `1200` moderadores pegados a `1200` IDs fijos.
- Modelarlo como observacion continua del conjunto activo actual.
- Revisar mensajes por evento, cola o score de riesgo, no por posicion fija.

### Posible pipeline futuro

- Cada mensaje nuevo entra a una cola de revision.
- Un clasificador IA o checker humano asigna score de riesgo.
- Si supera umbral, se marca para moderacion o bloqueo preventivo.
- Los temas activos se reevalan cuando reciben actividad nueva.
- Los mensajes que salen del buffer rotativo dejan de consumir revision activa.

### Posibles variantes

- Moderacion 100% IA sobre el buffer vivo.
- Moderacion humana distribuida sobre el buffer vivo.
- Sistema mixto:
  - IA para preclasificar
  - humanos para confirmar casos medianos o graves

### Objetivo del experimento

- Aprovechar que el universo activo esta acotado para intentar cobertura casi total.
- Reducir dependencia exclusiva de reportes manuales.
- Medir si la moderacion preventiva mejora calidad del feed y tiempo de respuesta.


## Preparacion deploy TOPYKLY

- Apuntar Cloudflare DNS del dominio final al VPS.
- Ejecutar el servidor Node detras de un reverse proxy con HTTPS.
- Usar TOPYKLY_PUBLIC_ORIGIN=https://<dominio> y TOPYKLY_COOKIE_SECURE=true en produccion.
- Registrar en Google OAuth el redirect URI https://<dominio>/auth/oidc/callback.
- Mantener SQLite en una ruta persistente configurada con TOPYKLY_DB_PATH.

## Proxima sesion - Funcionamiento y usuarios

Estado al cierre:
- TOPYKLY esta online en `https://topykly.com` y `https://www.topykly.com`.
- Render esta conectado al repo `kiamchomi-hash/topykly`.
- Se corrigio el envio de mensajes: el composer ahora envia y la ruta `/api/topics/:id/messages` usa el topic id correcto.
- Se probo en produccion con el mensaje `QA automatico 1700` en `Patio abierto`.
- Se agrego QA automatizado: `npm run qa`, `tests/smoke.mjs` y GitHub Actions `.github/workflows/qa.yml`.

Pendientes pedidos por Matias:
- Estandarizar usuarios anonimos para que se llamen `*topy`, con sufijo numerico pegado si hace falta distinguir sesiones, por ejemplo `*topy24`.
- Revisar el flujo de registro/login de usuarios reales.
- Permitir que usuarios logueados cambien su foto/avatar.
- Agregar feedback rectangular en la zona inferior izquierda cuando una accion no se pueda realizar, por ejemplo rate limit, tema bloqueado, tema expulsado, falta de login o error de backend.
- Mantener el feedback pequeno, visible y no invasivo; debe desaparecer solo tras unos segundos.
- Antes de tocar produccion, cubrir estos flujos con tests automaticos.

Orden recomendado:
1. Cambiar generacion/nombre de invitados en backend y tests.
2. Definir modelo minimo de perfil para avatar de usuario registrado.
3. Agregar endpoint y UI para cambiar avatar.
4. Crear sistema global de toast/feedback inferior izquierdo.
5. Cubrir con `npm run qa` y, si aplica, smoke UI con Playwright.
