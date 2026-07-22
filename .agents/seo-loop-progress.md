# Loop de SEO — Estado y guardrails

> **Qué es este archivo.** Es la memoria persistente del cron de SEO. Se inyecta *completo* al inicio de cada corrida. El agente lee el estado, los datos de Search Console y este historial; decide **un** cambio; lo aplica sobre la **capa SEO**; corre los tests; despliega; y **antes de terminar actualiza este mismo archivo** (nueva entrada en el log + backlog + qué falló).
>
> Regla de oro: si al terminar no actualizaste este archivo, la corrida no cuenta.

---

## 0. Precondiciones (no correr el loop hasta cumplirlas)

El loop **no debe ejecutar cambios** hasta que TODO esto sea cierto. Si alguna falla, la corrida solo registra "bloqueado por precondición X" y termina sin tocar nada.

- [x] `topykly.com` sirviendo en hosting real de producción (`NODE_ENV=production`). *Render + Cloudflare desde el 2026-07-21.*
- [x] Redirect 301 `www` → apex (o apex → `www`) consistente y una sola canónica. *Apex → `www`; canónica única `https://www.topykly.com/`.*
- [x] Propiedad dada de alta y verificada en Google Search Console. *Propiedad de **Dominio**, verificada por registro TXT en Cloudflare. Comprobado el 2026-07-22: `topykly.com` sirve `google-site-verification=vvDhVs-AvnXMFPO-MZqt9GMpmom4eZP6KeumIsOAi0g`.*
- [ ] Al menos **21 días** de datos acumulados en GSC (menos que eso es ruido, no señal). *Estado desconocido: no se sabe desde cuándo está verificada la propiedad. **Confirmar en `Rendimiento` qué rango de fechas tiene datos** — puede estar ya cumplida.*
- [ ] Acceso de **lectura programática** a los datos de GSC (MCP u otra vía). *No confundir con la verificación de la propiedad, que ya está hecha: esto es que el agente pueda **consultar** impresiones, clics, CTR y queries por su cuenta. Hoy no hay conector de Search Console disponible en el entorno.*
- [x] Comando de deploy definido y probado a mano una vez (ver §5). *Ejercitado el 2026-07-22.*

> Estado actual (2026-07-22): **BLOQUEADO por acceso a los datos, no por el alta.** La app está en producción, el 301 y la canónica resueltos, el deploy probado y la propiedad de GSC **verificada**. Lo que falta es una vía para *leer* esos datos y confirmar que haya suficiente historial.
>
> **Corrección respecto de versiones anteriores de este archivo:** hasta el 2026-07-22 acá decía que faltaba el alta en GSC. Era falso. La verificación se hizo por DNS, que no deja ningún rastro en el repo, y la ausencia de una meta `google-site-verification` en `index.html` se interpretó erróneamente como prueba de que no existía. Antes de declarar bloqueada esta precondición, **consultar el TXT del dominio**, no el código.
>
> Salida del bloqueo: no requiere necesariamente el MCP. Si un humano opera el loop pasando los números del panel a mano, la precondición de lectura se considera cumplida para esa corrida. El MCP es lo que permite que el loop corra **sin** intervención, no un requisito técnico rígido.

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

> **Al leer la analítica propia (p. ej. para cruzar `retentionBySource`): usar `uniqueSubjects`, nunca `total`.** `total` cuenta filas crudas y **una recarga (F5) suma una**, así que infla las visitas. `uniqueSubjects` cuenta personas. Detalle completo y límites conocidos en la [regla de lectura del loop de producto](./product-loop-progress.md#regla-de-lectura-uniquesubjects-nunca-total).

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

### Correccion — 2026-07-22 — La propiedad de GSC ya estaba verificada

- **Estado:** sigue BLOQUEADO (§0), pero por un motivo distinto del que este archivo venía afirmando.
- **Qué se corrigió:** la entrada anterior y las precondiciones daban por pendiente el alta en Search Console. Es falso: la propiedad de **Dominio** está verificada por TXT en Cloudflare (`google-site-verification=vvDhVs-...`), comprobado por consulta DNS.
- **Por qué se había concluido mal:** se infirió "no hay alta" de la ausencia de una meta `google-site-verification` en `index.html`. La verificación por DNS no toca el repo, así que esa ausencia no probaba nada. **Lección para próximas corridas: el estado de GSC se comprueba contra el TXT del dominio o el propio panel, nunca contra el código.**
- **Bloqueo real, ya rectificado en §0:** falta una vía de **lectura programática** de los datos (o que un humano los pase a mano) y confirmar cuánto historial hay acumulado.
- **Cambio SEO aplicado:** ninguno.

### Infra — 2026-07-22 — Lanzamiento cerrado; queda solo GSC

- **Estado:** sigue BLOQUEADO (§0), pero el bloqueo se redujo a **Search Console**. No es una iteración de SEO: no se aplicó ningún cambio de la capa SEO.
- **Qué cambió respecto de la entrada anterior:** la app ya está en producción real (Render + Cloudflare, desde el 2026-07-21), con `NODE_ENV=production`, apex → `www` por 301 y canónica única `https://www.topykly.com/`. Verificado en vivo el 2026-07-22.
- **Deploy resuelto:** §5 dejó de ser un TODO. El deploy es `git push origin main` con auto-deploy de Render, ejercitado y verificado hoy (commit `01bf3fb`, run de QA en `success`, endpoints públicos en 200).
- **Riesgo nuevo documentado:** Render despliega al commit sin esperar a CI, así que el gate local de `npm run qa` antes del push es la única barrera real. Anotado en §5.
- **Lo que falta para desbloquear:** alta y verificación de la propiedad en GSC (manual, la hace un humano), conexión del MCP y 21 días de datos. No hay meta `google-site-verification` en el repo todavía.
- **Cambio SEO aplicado:** ninguno.

### Infra — 2026-07-21 — Señal de acoplamiento lista (retención por fuente)
- **Estado:** sigue BLOQUEADO por precondiciones (§0); esto no es una iteración de SEO, es infraestructura que el loop necesita.
- **Qué se construyó:** analítica de producto por fuente de adquisición, con retención cruzada por fuente. Commits (locales, sin pushear):
  - `17153e3` — `retentionBySource` en el reporte (`buildProductAnalyticsReport`) + sección "Regreso por fuente" en el panel admin + tests.
  - `3850697` — detector de fuente en el cliente (`getProductSourceGroup` → `search`/`social`/`referral`/`campaign`/`email`/`internal`/`direct`), enviado en `trackProductEvent`.
- **Para qué sirve a ESTE loop:** permite responder *"¿el tráfico de búsqueda que traigo retiene distinto que el directo?"*. Si el SEO sube impresiones pero esa fuente no vuelve, el problema es intención/calidad de la keyword (palanca de este loop), no del producto. Cruzar esta señal antes de dar por bueno un crecimiento de tráfico.
- **Cambio SEO aplicado:** ninguno.

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

**Resuelto (2026-07-22).** El hosting es **Render** (aplicación) detrás de **Cloudflare** (edge), sirviendo `https://www.topykly.com/`.

- Servicio Render: `srv-d92ilsa8qa3s73dg0msg` · repo `kiamchomi-hash/topykly` · rama `main`.
- **No hay paso de build ni script de deploy en el repo** (no hay `render.yaml`, Dockerfile ni Procfile; la config vive en el panel de Render). El server arranca con `node local-server.cjs` y sirve los archivos directo del fuente.
- **El comando de deploy es literalmente:**
  ```
  git push origin main
  ```
  Render detecta el commit y redespliega solo. Probado a mano el 2026-07-22 (commit `01bf3fb`): deploy sano y verificado en producción.

> **Advertencia — Render despliega al commit, no espera a CI.** El workflow `qa.yml` corre *en paralelo* al deploy, así que un push con tests rojos llega igual a producción. Por eso el gate de `npm run qa` **local y previo al push** (§1, regla 10) no es opcional: es la única barrera real.

Cómo verificar un deploy (lo que se comprobó el 2026-07-22):
- `gh run list --limit 1` → el run de QA debe cerrar en `success`.
- `GET /` , `/api/auth/status`, `/api/bootstrap`, `/sitemap.xml` → 200.
- Confirmar que el HTML servido corresponde al commit nuevo (no basta el 200: comparar algún marcador del cambio).

> **Nota de entorno.** Existe una variable `GH_TOKEN` inválida que pisa la sesión válida de `gh` guardada en el keyring y hace fallar `git push` y los comandos `gh`. Si una corrida automatizada falla autenticando, es esto. Se limpia con `setx GH_TOKEN ""`.

Reglas de deploy:
- Solo desplegar con `npm run qa` en verde **antes** del push (ver advertencia arriba).
- Deploy = commit atómico ya pusheado; el hash queda en el log (§4) para rollback.
- Rollback: `git revert <hash>` + push. Alternativa más rápida sin tocar el repo: redesplegar el deploy anterior desde el panel de Render.
- Si una corrida ve una caída brusca atribuible al cambio anterior, revertir es la primera acción, no seguir optimizando encima.

---

## 6. Backlog / action items para la próxima iteración

Ordenado por prioridad. El agente toma de acá o de una señal nueva de los datos.

1. **[humano, rápido]** Abrir GSC → `Rendimiento` y anotar **desde qué fecha hay datos**. Define si la precondición de los 21 días ya está cumplida; hoy es la incógnita que decide si el loop puede arrancar.
2. **[humano]** Confirmar que `https://www.topykly.com/sitemap.xml` esté enviado en GSC → `Sitemaps`. El sitemap existe y responde 200; falta saber si está dado de alta ahí.
3. **[bloqueante]** Resolver la lectura de datos: conectar un MCP de Search Console **o** decidir que el loop se opera a mano con los números del panel (§0).
4. Al haber datos: capturar baseline (§2).
5. Al haber datos: cruzar la **retención por fuente** (ya implementada, ver Log/Infra) para validar que el tráfico de búsqueda retiene, no solo que sube en volumen.
6. Primera optimización de bajo riesgo candidata: revisar titles/descriptions de las páginas de tema con más impresiones y CTR bajo.

---

## 7. Cosas que NO funcionaron (para no repetirlas)

> Registrar acá cada experimento con veredicto negativo, con fecha y por qué. Empieza vacío.

- _(sin entradas todavía)_
