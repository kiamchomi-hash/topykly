# Loop de producto — Estado y guardrails

> **Qué es este archivo.** Es la memoria persistente del cron de producto/retención. Se inyecta *completo* al inicio de cada corrida. El agente lee el estado, la analítica de producto y este historial; identifica el mayor punto de fuga; formula **una** hipótesis con su regla de decisión; y **propone** el experimento en un branch/PR. **No despliega.** Antes de terminar actualiza este mismo archivo.
>
> Diferencia central con el [loop de SEO](./seo-loop-progress.md): aquél puede desplegar solo cambios estructurales; **este NO despliega nada de producto por su cuenta.** El costo de un error acá (auth, registro, pagos, UX para todos los usuarios) es mucho mayor. El agente es un analista que propone; el humano aprueba y despliega.

---

## 0. Precondiciones (no correr el loop hasta cumplirlas)

Si alguna falla, la corrida solo registra "bloqueado por precondición X" y termina sin proponer nada.

- [ ] App en **producción real con usuarios reales llegando**. *La app corre en producción desde el 2026-07-21 (`https://www.topykly.com/`) y la propiedad de GSC **ya está verificada** (por DNS). Lo que falta medir es el **tráfico real**: verificar la propiedad no genera visitas por sí solo. La fuente de verdad acá es la analítica propia (`product_events`), no GSC.*
- [x] Analítica de producto instrumentada y registrando (`product_events`, funnel completo, retención por fuente). *Hecho en código.*
- [ ] **Volumen mínimo por cohorte** para que un experimento no sea ruido (ver §1, rigor estadístico). Con ~10 usuarios/día todavía es chico: un experimento de retención tarda semanas en acumular señal.
- [ ] Mecanismo de despliegue **con aprobación humana** (branch/PR). Este loop nunca hace `git push` a `main` por su cuenta. *Ver la nota de `GH_TOKEN` abajo antes de asumir que `gh pr create` va a funcionar.*

> Estado actual (2026-07-22): **BLOQUEADO.** El lanzamiento técnico ya ocurrió, pero eso no mueve este loop: lo que le falta no es infraestructura sino **usuarios**. Sigue siendo el **más prematuro de los dos** — necesita que primero entre tráfico (GSC) y después que ese tráfico acumule volumen suficiente para que un experimento sea concluyente. Contá varias semanas después del alta en GSC, no días.
>
> **Cuidado con el atajo tentador:** que la app esté publicada puede leerse como "ya se puede experimentar". No. Con el volumen actual cualquier lectura de retención es ruido, y §1 regla 7 lo prohíbe explícitamente.
>
> **Nota de entorno — resuelta el 2026-07-22.** `GH_TOKEN` y `GITHUB_TOKEN` tapaban el token del keyring y hacían fallar `git push` y los comandos `gh`. Ambas fueron eliminadas del entorno de usuario y el push quedó verificado, así que el mecanismo de branch/PR de la regla 1 ya no está bloqueado por esto. Detalle del diagnóstico en el ítem 3 de §7.

---

## 1. Guardrails (reglas duras — NUNCA violar)

### Humano en el loop (la regla que define este loop)
1. **NUNCA desplegar un cambio de producto de forma autónoma.** El agente analiza, propone UNA hipótesis y abre un branch/PR. Ahí se detiene. El humano revisa, aprueba y despliega.
2. **Separar tajantemente lo automatizable de lo que requiere aprobación.** Automatizable sin permiso: leer la analítica, detectar fugas, escribir hipótesis y priorizar en este archivo. Requiere aprobación: *cualquier* modificación del producto.

### Alcance (qué puede proponer / qué está prohibido)
3. **PROHIBIDO tocar (ni proponer cambios de riesgo alto):** auth y sesiones, moderación/admin, pagos y tienda (Mercado Pago), modelo de datos/backend. Esos cambios los decide un humano desde cero, no salen de una hipótesis de retención.
4. **NUNCA reintroducir mensajería privada / DMs.** Se retiraron por riesgo legal. No importa cuánto "mejoraría la retención": está fuera de la mesa, punto.
5. **Lo que SÍ puede proponer** (siempre en branch, bajo revisión): copy, orden y fricción del onboarding, textos/posición de CTA, empujones de activación (ej. sugerir primer post), estados vacíos, y ajustes de UX de bajo riesgo.

### Rigor estadístico (crítico por el bajo volumen)
6. **Definir la regla de decisión ANTES de correr el experimento:** métrica objetivo + umbral de mejora + tamaño de muestra mínimo + ventana temporal. Sin regla previa, no hay experimento.
7. **No concluir con cohortes chicas.** Con el volumen actual, un cambio que "sube la retención un 5 %" sobre 40 usuarios es ruido. Si no se alcanzó el N mínimo, el veredicto es "seguir midiendo", no "funcionó".
8. **Un experimento a la vez** sobre una misma superficie, para poder atribuir el efecto. (Igual que el loop de SEO.)

### Ética y medición
9. **Nada de dark patterns.** El objetivo es valor real y retención genuina, no inflar métricas de vanidad (registros forzados, obstáculos para irse, notificaciones abusivas).
10. **Los cambios de producto cortan la serie histórica.** Anotar la fecha de cada cambio desplegado para poder segmentar antes/después. No encimar un experimento nuevo sobre una superficie cuyo experimento anterior todavía se está midiendo.
11. **Todo experimento debe ser reversible:** un branch/PR por hipótesis, con plan de rollback.

---

## 2. Fuentes de datos

El loop lee la analítica de producto **first-party** (sin dependencias externas):

- **Cómo:** endpoint `/api/admin/analytics` (rol moderador) o consulta directa a la SQLite (`TOPYKLY_DB_PATH`). El agente corre en el server casero, así que la consulta directa es lo más simple.
- **Reporte** (`buildProductAnalyticsReport`): resumen de eventos, serie diaria, rutas de entrada, fuentes de adquisición, retención por cohorte y **retención por fuente**.
- **Eventos del funnel:** `page_view` → `topic_open` → `auth_open` → `registration_complete` / `login_complete` → `publish_attempt` → `topic_created` / `comment_created`; más `return_visit` (derivado a ≥12 h).
- **El puente con el [loop de SEO](./seo-loop-progress.md):** `retentionBySource` responde *"¿el tráfico de búsqueda vuelve a distinto ritmo que el directo?"*. Si el SEO trae mucha gente que no retiene, el problema puede ser intención/calidad del tráfico (lo arregla el loop de SEO ajustando a qué keywords apunta), no el producto. **Diagnosticar esto antes de rediseñar features.**

### Regla de lectura: `uniqueSubjects`, nunca `total`

Cada evento del reporte trae dos números y **elegir mal invalida la conclusión**:

- `total` — filas crudas. **Una recarga (F5) suma una fila.** Inflado por definición.
- `uniqueSubjects` — `COUNT(DISTINCT subject_key)`. Es el número de **personas**.

> **Usar siempre `uniqueSubjects`, tanto en numeradores como en denominadores.** Mezclar los dos produce tasas de conversión sin sentido. Si una corrida reporta "visitas" con `total`, el resultado se descarta.

Por qué `uniqueSubjects` resiste el F5: `subject_key` es un HMAC de `registered:<userId>` o `guest:<sessionId>`, y la cookie de sesión dura 30 días. Veinte recargas de la misma persona son veinte filas con **un** `subject_key`.

Límites conocidos de esa deduplicación — anotarlos al interpretar, no "corregirlos":

- **Un invitado que se registra cambia de `subject_key`** (`guest:sesión` → `registered:id`) y se cuenta como dos personas. El sesgo pega justo en el tramo de conversión que más interesa: infla el denominador de registro.
- **Borrar cookies o cambiar de navegador crea un sujeto nuevo.** Inevitable sin fingerprinting, que está descartado por privacidad.
- **`return_visit` es inmune al F5**: exige ≥12 h entre visitas del mismo sujeto. Es la métrica más confiable del set.
- **Publicaciones (`topic_created` + `comment_created`) es el único caso donde `total` es correcto**: publicar dos veces son dos publicaciones. Pero entonces su tasa **no es comparable** con las demás, que están en personas. No ponerlas en la misma tabla sin aclararlo.

---

## 3. Baseline (rellenar al cerrar precondiciones)

Snapshot del punto de partida, para medir contra esto.

**Capturado el 2026-07-22** (`/api/admin/analytics?days=30`). El pedido era de 30 días pero **solo hay 7 días de datos**: el primer evento es del 2026-07-16. Todo en `uniqueSubjects`.

| Métrica | Valor baseline | Fecha |
|---|---|---|
| Visitantes únicos / semana | **51** — de los cuales ~37 son sospechosos (ver abajo); humanos plausibles ~14 | 2026-07-16 → 07-22 |
| Conversión visita → abre tema | 7 / 51 = **13,7 %** (≈50 % si se excluyen los sospechosos) | ídem |
| Conversión `auth_open` → registro | **0 / 1** — un solo sujeto abrió el modal en toda la ventana | ídem |
| Conversión → primer post | 2 sujetos publicaron, ambos **ya registrados de antes** | ídem |
| Retención (regreso ≥12 h) total | 3 / 51 = **5,9 %** | ídem |
| Retención por fuente | `direct` 3 / 51. **No hay otra fuente**: 0 search, 0 social, 0 referral | ídem |
| New users / día | **0 registros y 0 logins** en los 7 días | ídem |

Rutas de entrada: **el 100 % de los 94 `page_view` cayó en `/`**. Cero visitas a cualquier página SEO (`/tema/…`, `/temas`, `/archivo`, `/u/…`).

### Advertencias de lectura (no borrar)

1. **El pico del 18 y 19 de julio (37 de 51 sujetos, el 73 %) no parece tráfico humano.** Firma: ~1,0 `page_view` por sujeto, 1 solo `topic_open` entre los dos días, y **0 regresos de ambas cohortes**. Además es *anterior* al lanzamiento en producción del 2026-07-21, así que llegó por la URL de Render o por el dominio recién apareciendo en los logs de Certificate Transparency — que es exactamente lo que rastrean los escáneres automáticos. Hipótesis principal: rastreadores con JS. **Sin confirmar.**
2. **`product_events` no filtra bots.** `page_view` se emite desde el cliente (`controller-app.js:324`), así que cualquier rastreador que ejecute JS cuenta como visitante y cada visita estrena `subject_key`. Mientras siga así, **todo denominador está inflado y toda tasa de conversión subestimada.** Arreglarlo antes de correr cualquier experimento; si no, una mejora real puede quedar enterrada bajo tráfico automático.
3. **El 0 de registros es real, no un fallo de medición.** Verificado en código: `registration_complete` y `login_complete` se emiten (`controller-actions.js:207,225,257,814`) y están en la lista blanca de eventos (`backend-store.js:74-75`).
4. **Estos 7 días son de *antes* de los cambios del 2026-07-22.** Este baseline mide el producto viejo: sin estado vacío, con la ventana fija de 20 y con el archivo rebotando a quien llegaba. Sirve como punto de partida, no como término de comparación limpio con lo que venga.

---

## 4. Protocolo de cada corrida

1. Chequear precondiciones (§0). Si alguna falla → registrar y salir sin proponer nada.
2. Traer la analítica (últimos 30 d + comparación con el período anterior).
3. Revisar el **experimento anterior contra su regla de decisión** (§5): ¿alcanzó el N mínimo? ¿movió la métrica más allá del umbral? Veredicto: **adoptar / revertir / seguir midiendo**. Anotarlo.
4. **Detectar el mayor punto de fuga**, por prioridad:
   - Caída brusca de una métrica core → diagnosticar primero (¿bug? ¿cambio reciente?).
   - Mayor drop-off del funnel (dónde se cae más gente).
   - Peor cohorte/fuente de retención — y cruzar con el loop de SEO antes de asumir "problema de producto".
5. Formular **una** hipótesis: *si cambio X, espero que la métrica M mejore ≥ U, medido sobre N usuarios / T tiempo*.
6. **Proponer** el experimento en un branch/PR. **No desplegar.**
7. **Actualizar este archivo** (entrada en §6, backlog en §7, lo que no funcionó en §8) y dejar el PR para aprobación humana.

---

## 5. Modelo de decisión (en lugar de "deploy autónomo")

- El agente **abre branch/PR**; el humano revisa, aprueba y despliega. Nunca al revés.
- Cada experimento lleva su **regla de decisión escrita antes** de correr (métrica, umbral, N, ventana).
- Al cierre del experimento: adoptar (merge), revertir (cerrar PR / `git revert`), o extender la ventana si no se alcanzó el N mínimo.
- Rollback siempre disponible: un PR por experimento, atómico.

---

## 6. Log de iteraciones

> La más reciente arriba.

### Baseline — 2026-07-22 — Primera lectura real: el problema es adquisición, no producto

- **Estado:** sigue BLOQUEADO (§0), y ahora con números que lo demuestran en vez de suponerlo. Baseline cargado en §3.
- **Datos (7 días reales, no 30):** 51 visitantes únicos, 94 `page_view`, 100 % directos, 100 % sobre `/`.
- **Veredicto del experimento anterior:** no había ninguno.
- **Fuga detectada — y no es la que veníamos suponiendo.** El backlog apuntaba al drop-off `auth_open` → `registration_complete` como primer foco. **Los datos lo descartan por ahora:** en 7 días **un solo sujeto** abrió el modal de registro. No se puede tener un problema de conversión en un paso al que no llega nadie. La fuga real está mucho más arriba: no entra gente. Cero búsqueda, cero social, cero referidos, cero visitas a páginas SEO.
- **Qué queda confirmado:** la tesis del plan de crecimiento era correcta. El SEO no puede traer a los primeros usuarios —hoy aporta exactamente 0— y el único canal disponible es la siembra manual ([`SIEMBRA_FASE2.md`](../SIEMBRA_FASE2.md)). Todo trabajo de producto adicional antes de tener tráfico es optimizar un embudo vacío.
- **Hipótesis:** ninguna formulable. Con ~14 humanos plausibles en 7 días, cualquier lectura de retención es ruido (§1 regla 7).
- **Experimento propuesto:** **ninguno**, y no debe proponerse ninguno hasta que entre tráfico real y se filtren los bots (§3, advertencia 2).
- **Acción que sí corresponde:** ejecutar la Fase 2 de siembra manual, en tandas chicas y separadas para poder atribuir.

### ⚠️ Fecha de corte — 2026-07-22 — Cuatro cambios de producto desplegados juntos

**Toda serie histórica anterior al 2026-07-22 no es comparable con la posterior.** Segmentar por esta fecha antes de leer cualquier métrica que la cruce (regla 10 de §1).

- **Estado:** sigue BLOQUEADO (§0). Esto no es una iteración ni un experimento: es el registro de un corte, exigido por la regla 10.
- **Qué se desplegó** (push `5d86ddd..e25858d`, CI en `success`, producción verificada en vivo):
  - `da39a61` + `daf7b87` — se quitó la autorredirección hacia la app en las páginas SEO de tema y de perfil. Antes, quien llegaba desde Google a un **tema archivado** era rebotado a la SPA sobre una conversación de solo lectura, sin llegar a leer nada; y para Googlebot cada URL indexada parecía una redirección. Afecta adquisición orgánica y el embudo de entrada.
  - `f094361` — ventana visible de temas adaptativa a la población conectada (5 visibles con menos de 8 conectados, subiendo hasta los 20 de siempre con 40+). **Cambia qué ve todo el mundo al entrar**, así que corta las series de `topic_open` y de profundidad de navegación. El conjunto activo de 40 y la expulsión no se tocaron.
  - `aa0a455` + `ab6f53f` — contador de presencia real en el panel de usuarios, contando personas y no filas.
  - `aa3e234` — estado vacío en la lista de temas. Antes, con cero temas no se renderizaba nada y la app se leía como rota: es lo que veía cualquiera que entrara a producción.
  - `3193b14` + `e25858d` — título y descripción del sitio reescritos (`<title>`, `og`, `twitter`, `h1` y el `BASE_TITLE` de runtime). Afecta el snippet de Google y las tarjetas al compartir, con semanas de retraso hasta reindexar.
- **Limitación de atribución, explícita:** salieron **juntos** y tocan superficies distintas. Si alguna métrica se mueve, **no se puede atribuir a ninguno en particular**. No escribir en una iteración futura que "la ventana adaptativa mejoró X": el diseño no lo permite. Es una violación consciente de la regla 8 (un experimento a la vez), aceptada porque con el volumen actual no había ninguna señal que preservar — pero deja de ser aceptable en cuanto entre tráfico.
- **Sin ejercitar en producción:** el arreglo del archivo está desplegado pero **no hay ningún tema archivado todavía** (hacen falta 40 temas activos desplazándose). Verificado en local forzando expulsiones; sin dato de producción hasta que exista el primer archivado. **Revisar cuando aparezca.**
- **Qué NO cambió:** el volumen. Este loop sigue bloqueado por lo mismo de siempre.
- **Experimento propuesto:** ninguno.

### Correccion — 2026-07-22 — GSC ya estaba verificado; el bloqueo es volumen

- **Estado:** sigue BLOQUEADO (§0), sin experimentos propuestos.
- **Qué se corrigió:** la entrada de más abajo daba el alta en Search Console como pendiente y la trataba como "el grifo del tráfico". La propiedad ya está verificada (por DNS; ver el [loop de SEO](./seo-loop-progress.md)), así que esa dependencia no existe.
- **Qué implica para este loop:** menos de lo que parece. Verificar una propiedad en GSC **no genera visitas**; solo habilita medir las que haya. El bloqueo de este loop nunca fue el alta sino el **volumen de usuarios**, y eso sigue igual.
- **Acción concreta que sí se puede hacer hoy:** este loop no depende de GSC para nada — su fuente es la analítica propia (`product_events`). Se puede consultar ya mismo cuántos usuarios hay por día y dejar de especular sobre si el volumen alcanza. Movido al tope del backlog (§7).
- **Experimento propuesto:** ninguno (falta volumen).

### Infra — 2026-07-22 — Producción lista, sin usuarios todavía

- **Estado:** sigue BLOQUEADO (§0). Ningún experimento propuesto.
- **Qué cambió:** la app pasó a producción real el 2026-07-21 (Render + Cloudflare, `https://www.topykly.com/`), con deploy probado y verificado. Eso cierra la parte de *infraestructura* de la primera precondición.
- **Qué NO cambió:** el tráfico. Sin alta en Search Console no hay adquisición orgánica, así que la analítica sigue sin cohortes de tamaño útil. La precondición de volumen sigue tan lejos como antes.
- **Consecuencia práctica:** este loop no se desbloquea con el lanzamiento; se desbloquea varias semanas *después* de que el [loop de SEO](./seo-loop-progress.md) empiece a traer gente.
- **Riesgo detectado:** la variable `GH_TOKEN` inválida del entorno impide que una corrida automatizada abra el branch/PR exigido por §1 regla 1. Si el loop se activara hoy, no podría entregar su propuesta. Anotado en §0.
- **Experimento propuesto:** ninguno (falta volumen).

### Iteración 0 — 2026-07-21 — Setup
- **Estado:** loop armado, BLOQUEADO por precondiciones (§0). Sin experimentos propuestos.
- **Contexto:** la analítica de producto por fuente quedó completa en código (commits `17153e3` + `3850697`): funnel, cohortes y `retentionBySource`, visibles en el panel admin.
- **Hipótesis marco:** el crecimiento de SEO trae usuarios que quizás no retienen; hay que distinguir "problema de retención" de "tráfico de baja intención" usando `retentionBySource`.
- **Experimento propuesto:** ninguno (falta volumen).

<!-- Plantilla para copiar:
### Iteración N — YYYY-MM-DD — <título corto>
- **Datos (30 d):** funnel, retención total y por fuente, Δ vs período anterior.
- **Veredicto del experimento anterior:** adoptar / revertir / seguir midiendo. ¿Alcanzó N mínimo? Detalle.
- **Fuga detectada:** ...
- **Hipótesis:** si cambio X, espero M ≥ U sobre N usuarios / T tiempo, porque Z.
- **Regla de decisión:** métrica M, umbral U, N mínimo, ventana T.
- **Experimento propuesto:** branch/PR `<link>` (NO desplegado). Espera aprobación humana.
-->

---

## 7. Backlog / action items para la próxima iteración

Ordenado por prioridad.

1. **[HECHO el 2026-07-22]** Baseline capturado y cargado en §3. Resultado: ~51 visitantes en 7 días, la mayoría probablemente automáticos, y 0 registros.
2. **[nuevo, bloqueante para medir]** **Filtrar tráfico automático en `product_events`.** Hoy no hay ningún filtro y `page_view` se dispara desde el cliente, así que cualquier rastreador con JS entra al denominador. Mientras siga así, ninguna tasa de conversión es confiable y un experimento real puede quedar tapado por ruido. Es lo primero a resolver **antes** del primer experimento, no después.
3. **[bloqueante, espera]** Acumular volumen suficiente por cohorte. Semanas, no días. La vía es la siembra manual de [`SIEMBRA_FASE2.md`](../SIEMBRA_FASE2.md); el SEO hoy aporta 0.
4. **[entorno, RESUELTO el 2026-07-22]** Las variables `GH_TOKEN` y `GITHUB_TOKEN` fueron eliminadas del entorno de usuario. `gh` y `git push` usan el token del keyring (`gho_…`, scopes `gist, read:org, repo, workflow`) y funcionan sin workaround; verificado con `git push --dry-run`. El mecanismo de branch/PR de la regla 1 ya no está bloqueado por esto.

   Detalle por si reaparece, porque el diagnóstico fácil es engañoso: **eran dos tokens distintos, no una variable duplicada.** `GH_TOKEN` estaba lisa y llanamente vencida (401). `GITHUB_TOKEN` era un PAT fine-grained **válido** que autenticaba bien y devolvía `permissions.push: true` al consultar el repo — pero igual daba 403 al pushear. Ese campo de la API describe el rol de **la cuenta** en el repositorio, no lo que el token fine-grained tiene concedido; no sirve para decidir si un token puede escribir. La única prueba que vale es intentar la operación (`git push --dry-run`). Como `gh` prioriza `GH_TOKEN` sobre `GITHUB_TOKEN` y ambas sobre el keyring, cualquiera de las dos presente tapaba al token que sí servía.
5. **[pendiente de dato real]** Revisar el arreglo del puente archivo → chat vivo cuando exista el **primer tema archivado** en producción. Está desplegado y verificado en local, pero nunca se ejercitó con datos reales (ver la fecha de corte en §6).
6. **[en espera de que exista tráfico de búsqueda]** Cruzar `retentionBySource` con lo que traiga el loop de SEO. Hoy es **imposible**: el reporte tiene una sola fila, `direct`. No hay con qué comparar.
7. **[despriorizado por los datos del 2026-07-22]** El drop-off `auth_open` → `registration_complete` venía como primer foco candidato. **Los datos lo descartan por ahora:** hubo *un* `auth_open` en 7 días. No se optimiza un paso al que no llega nadie; primero tiene que haber tráfico. Cuando lo haya, la advertencia de alcance sigue vigente: participar exige cuenta por decisión de producto (2026-07-22), así que la palanca se busca **adentro** del registro —por ejemplo evitar el viaje al correo con `registerWithPassword`, que ya existe— y nunca abriendo la participación a invitados.

---

## 8. Cosas que NO funcionaron (para no repetirlas)

> Registrar cada experimento con veredicto negativo, con fecha y por qué. Empieza vacío.

- _(sin entradas todavía)_
