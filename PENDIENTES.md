# Pendientes tras la migración a Vercel

Estado al 30 de agosto de 2026. La app corre en `https://www.topykly.com` sobre
Vercel: base en Turso, avatares en Vercel Blob, límite de tráfico en Upstash,
mantenimiento por cron horario. Render se dio de baja el mismo día.

**No hay vuelta atrás.** Con Render apagado, Vercel es el único lugar donde corre
la aplicación. Eso cambia el peso de varios puntos de abajo.

---

## 1. Tope de gasto en Vercel

**Por qué importa.** El sondeo del chat en vivo cobra por uso: cada pestaña
abierta pide `/api/topics` cada 60 segundos, y cada pedido es una invocación de
función más lecturas en Turso. En Render eso costaba lo mismo con 1 usuario que
con 100; acá no. Si el gasto se dispara y Vercel pausa el proyecto, el sitio se
cae y ya no queda un Render al que volver.

**Qué hacer.** Vercel → Settings → Billing → Spend Management: fijar un monto y
elegir qué pasa al alcanzarlo. Conviene la opción que avisa antes de pausar.

**Qué mirar además.** Turso factura por filas leídas. Si el tráfico crece, la
consulta a vigilar es la de `/api/topics`, que devuelve los 40 temas activos con
sus mensajes en cada sondeo.

---

## 2. El cliente OAuth de Google vive en un proyecto sin acceso

**Qué pasa.** El cliente OAuth está en el proyecto de Google Cloud
**693456666067**. Ninguna de las cuentas del dueño puede abrirlo: la consola
responde "Necesitas acceso adicional a proyecto".

**Hoy funciona.** Los dos redirect URIs (apex y www) están registrados y el login
con Google anda. Verificado el 2026-08-30 contra el endpoint de autorización de
Google, usando una URI inventada como control para confirmar que la prueba
distinguía de verdad.

**El problema es a futuro.** No se puede cambiar un redirect URI ni rotar el
secreto. Si el dominio cambia, o el secreto se filtra, no hay forma de arreglarlo
desde ese cliente.

**Cómo se resuelve.** Crear un cliente OAuth nuevo en un proyecto propio y
reemplazar `TOPYKLY_OIDC_CLIENT_ID` y `TOPYKLY_OIDC_CLIENT_SECRET`. No es urgente,
pero conviene hacerlo antes de que haga falta con apuro.

---

## 3. El chat en vivo quedó en sondeo, sin SSE

**Decisión deliberada, no un olvido.** `/api/live` responde 501 en serverless.
Mantener el stream abierto sería una función viva por cada pestaña, y el fanout
solo llegaría a las conexiones de esa misma instancia: quien tuviera la mala
suerte de caer en otra no se enteraría de nada.

**Lo que hay hoy.** El cliente vuelve solo al sondeo: 60 segundos con la pestaña
visible, 5 minutos cuando está oculta.

**Qué haría falta para reactivarlo.** Implementar el `liveEventRelay` compartido
que `services/live-event-hub.js` ya acepta como parámetro, sobre el pub/sub de
Upstash que ya está contratado, y exponer `/api/live` como función con
`maxDuration` alto. El hub ya estampa un `sourceId` para ignorar su propio eco,
así que la pieza que falta es solo el relay.

**Cuándo.** Si el chat se siente lento con gente real usándolo a la vez. Antes de
eso, subir la frecuencia del sondeo es más barato de probar y de revertir.

---

## 4. `sharp` con vulnerabilidad conocida

`npm audit` reporta una severidad alta en `sharp` < 0.35.0, heredada de libvips
(CVE-2026-33327, 33328, 35590, 35591). Es anterior a la migración.

Se usa en `services/social-card.js` para generar las tarjetas OG, con datos que
vienen de la propia base, no de subidas de usuarios: la superficie de ataque es
acotada.

Arreglarlo es subir a 0.35.x, que es un cambio con ruptura. Conviene hacerlo
aparte, con la suite de tests como red.

---

## Decisiones ya tomadas, para no volver a discutirlas

- **Host canónico: `www.topykly.com`.** Se evaluó el apex y se descartó: todo el
  código y los tests ya decían www, el apex no admite CNAME (peor para volver a
  mudar de hosting) y sus cookies se filtran a los subdominios. El apex redirige
  con 308. Google solo tenía indexado www, con 11 impresiones y 0 clics en 90
  días, así que no había historial que preservar.
- **La base arrancó vacía**, por decisión del dueño. No se migraron datos.
- **Los avatares se cachean 5 minutos** en el almacén de objetos. Por defecto se
  cachean semanas, y eso dejaría un avatar rechazado por moderación visible en su
  URL mucho después de borrarlo.
