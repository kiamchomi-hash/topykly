# Loop de SEO — Estado y guardrails

> **Qué es este archivo.** Es la memoria persistente del cron de SEO. Se inyecta *completo* al inicio de cada corrida. El agente lee el estado, los datos de Search Console y este historial; decide **un** cambio; lo aplica sobre la **capa SEO**; corre los tests; despliega; y **antes de terminar actualiza este mismo archivo** (nueva entrada en el log + backlog + qué falló).
>
> Regla de oro: si al terminar no actualizaste este archivo, la corrida no cuenta.

---

## 0. Precondiciones (no correr el loop hasta cumplirlas)

El loop **no debe ejecutar cambios** hasta que TODO esto sea cierto. Si alguna falla, la corrida solo registra "bloqueado por precondición X" y termina sin tocar nada.

- [ ] `topykly.com` sirviendo en hosting real de producción (`NODE_ENV=production`).
- [ ] Redirect 301 `www` → apex (o apex → `www`) consistente y una sola canónica.
- [ ] Propiedad dada de alta y verificada en Google Search Console.
- [ ] Al menos **21 días** de datos acumulados en GSC (menos que eso es ruido, no señal).
- [ ] MCP de Search Console conectado y con permiso de lectura.
- [ ] Comando de deploy definido y probado a mano una vez (ver §5).

> Estado actual (2026-07-20): **BLOQUEADO.** Faltan hosting real, prod, 301 y alta en GSC. El andamiaje SEO del código (`services/seo-pages.js`, sitemap, robots, JSON-LD) ya está listo; falta lanzar y esperar datos.

---

## 1. Guardrails (reglas duras — NUNCA violar)

Estas reglas están por encima de cualquier "oportunidad" que sugieran los datos. Ante la duda, no actuar.

### Contenido
1. **NUNCA generar temas, comentarios, respuestas ni actividad de usuarios.** El contenido de TOPYKLY es de personas reales. Fabricarlo es comunidad falsa **y** *scaled content abuse* (el update de Google de marzo 2026 penalizó exactamente esto). El loop optimiza cómo se presenta e interconecta lo que ya existe; no lo crea.
2. **NUNCA bajar `SEO_THIN_TOPIC_COMMENT_COUNT` para forzar la indexación de temas flacos.** Subirlo es aceptable si los datos muestran que temas con pocos comentarios generan soft-404 o thin content. Indexar basura para inflar el índice es justo lo que penaliza Google.
3. **Respetar los flags de indexación existentes:** `isThin`, `isBlocked`, `isProblematic`, `isArchived`, y `profile.indexable`. No forzar `index` sobre contenido marcado como `noindex`.

### Alcance del código (qué puede tocar el agente)
4. **SOLO la capa SEO.** Zona permitida: `services/seo-pages.js` (meta, titles, descriptions, JSON-LD, internal linking, umbrales de indexación, sitemap/robots), y estrictamente las etiquetas `<head>`/SEO de `index.html`.
5. **PROHIBIDO tocar:** auth y sesiones (`services/auth-service.js`, login/registro), moderación/admin, pagos/tienda, lógica de backend de datos (`services/backend-store.js` salvo consultas de solo-lectura para armar páginas SEO), reducers/estado, y cualquier flujo de producto. Esos cambios los decide un humano, no el cron.
6. **NUNCA exponer datos privados en el SSR.** No indexar emails, sesiones, ni contenido de usuarios que no sea ya público en la app. Recordatorio legal: los DMs se retiraron por riesgo legal — no reintroducir superficies privadas por la puerta de atrás del SEO.

### Internal linking / anchors
7. **No usar anchor text exact-match repetido en masa.** Distribución objetivo de anclas hacia una misma página: exact-match 15–25 %, parcial 30–40 %, marca/entidad 20–30 %, genérico/contextual 10–20 %. Un template que pone el mismo anchor exacto en N páginas es patrón antinatural.
8. **No crear páginas huérfanas ni granjas de enlaces.** Todo lo que entra al sitemap debe recibir al menos un enlace interno real.

### Proceso
9. **Un solo cambio significativo por iteración.** Si metés cinco cosas a la vez no vas a saber cuál movió la aguja (ni cuál te penalizó). Cambios triviales agrupables (ej. corregir 3 titles del mismo tipo) cuentan como uno.
10. **Gate de tests obligatorio:** correr `npm run qa` (= `tests/run.mjs` + `tests/smoke.mjs`) **antes** de desplegar. Si fallan, **abortar el deploy**, dejar el cambio en un branch y registrar el fallo. Nunca desplegar con tests en rojo.
11. **Todo cambio debe ser reversible:** un commit atómico con mensaje claro (imperativo, en español, estilo del repo). Anotar el hash en el log para poder revertir.
12. **No sabotear la medición.** Después de aplicar un cambio, esperar al menos **una iteración completa** antes de juzgar su efecto. No revertir a la primera semana por ruido.

---

## 2. Baseline (rellenar al cerrar precondiciones)

Snapshot del punto de partida, para medir contra esto. Actualizar solo si se rebasea a propósito.

| Métrica (GSC, últimos 28 d) | Valor baseline | Fecha |
|---|---|---|
| Impresiones | _pendiente_ | — |
| Clicks | _pendiente_ | — |
| CTR medio | _pendiente_ | — |
| Posición media | _pendiente_ | — |
| Páginas indexadas | _pendiente_ | — |
| Queries con impresiones | _pendiente_ | — |

Negocio (fuente aparte, no GSC): new users/día, % que crea ≥1 tema, retención D1/D7 → estos los cubre el **loop de producto**, no este. Pero anotalos aquí para tener contexto, porque en TOPYKLY el contenido = actividad de usuarios: si la retención cae, este loop se queda sin materia prima.

---

## 3. Protocolo de cada corrida

1. Chequear precondiciones (§0). Si alguna falla → registrar y salir sin tocar nada.
2. Traer datos de GSC (últimos 28 d + comparación con período anterior).
3. Revisar el **efecto del cambio de la iteración anterior** (§4): ¿mejoró, empeoró, neutro? Anotar veredicto.
4. **Detectar señales**, en este orden de prioridad:
   - Caídas bruscas de impresiones/indexación → posible penalización o bug. **Prioridad máxima: diagnosticar antes de optimizar nada.**
   - Queries subiendo (posición 5–20, impresiones altas, CTR bajo) → oportunidad de empujar con title/description/internal linking.
   - Páginas con impresiones pero sin clicks → problema de CTR (snippet/schema).
   - Contenido thin generando soft-404 → ajustar umbral (subir, nunca bajar por debajo de la política).
5. Elegir **un** cambio de mayor impacto/menor riesgo dentro del alcance permitido (§1).
6. Aplicarlo. Correr `npm run qa`. Si falla → abortar deploy, dejar branch, registrar.
7. Desplegar (§5).
8. **Actualizar este archivo:** nueva entrada en §4, mover ítems en §6, anotar lo que no funcionó en §7.

---

## 4. Log de iteraciones

> Formato por entrada. La más reciente arriba.

### Iteración 0 — 2026-07-20 — Setup
- **Estado:** loop armado, BLOQUEADO por precondiciones (§0). Sin cambios aplicados.
- **Contexto:** andamiaje SEO ya existe en código (SSR de temas en `/tema/:id/:slug`, `/temas`, `/archivo`, perfiles `/u/:nickname`, sitemap, robots, JSON-LD `DiscussionForumPosting`, thin-content a `noindex`, internal linking vía `relatedTopics`).
- **Hipótesis:** el modelo UGC/foro rankea bien; la palanca del loop es estructura (meta, anchors, indexación), no generación de contenido.
- **Cambio aplicado:** ninguno.
- **Veredicto próxima corrida:** N/A.

<!-- Plantilla para copiar:
### Iteración N — YYYY-MM-DD — <título corto>
- **Datos (28 d):** impresiones X (Δ%), clicks Y (Δ%), CTR Z, pos. media P, indexadas I.
- **Veredicto del cambio anterior:** mejoró / empeoró / neutro / pronto para juzgar. Detalle.
- **Señal detectada:** ...
- **Hipótesis:** si hago X, espero Y porque Z.
- **Cambio aplicado:** ... (commit `<hash>`, archivo `<file>`).
- **Tests:** `npm run qa` → OK / FALLÓ (si falló: no se desplegó).
- **Deploy:** sí/no.
-->

---

## 5. Deploy

> **TODO al cerrar precondiciones:** documentar aquí el comando/script exacto de deploy de TOPYKLY (git pull + arranque de `local-server.cjs`/`preview-server.js` en el server casero por SSH, o lo que aplique). Hasta que esté probado a mano una vez, el loop no despliega.

Reglas de deploy:
- Solo desplegar con `npm run qa` en verde.
- Deploy = commit atómico ya pusheado; el hash queda en el log (§4) para rollback.
- Rollback: `git revert <hash>` + redeploy. Si una corrida ve una caída brusca atribuible al cambio anterior, revertir es la primera acción, no seguir optimizando encima.

---

## 6. Backlog / action items para la próxima iteración

Ordenado por prioridad. El agente toma de acá o de una señal nueva de los datos.

1. **[bloqueante]** Cerrar precondiciones de §0 (hosting, prod, 301, alta en GSC). Sin esto el loop no arranca.
2. Definir y probar el comando de deploy (§5).
3. Al haber datos: capturar baseline (§2).
4. Primera optimización de bajo riesgo candidata: revisar titles/descriptions de las páginas de tema con más impresiones y CTR bajo.

---

## 7. Cosas que NO funcionaron (para no repetirlas)

> Registrar acá cada experimento con veredicto negativo, con fecha y por qué. Empieza vacío.

- _(sin entradas todavía)_
