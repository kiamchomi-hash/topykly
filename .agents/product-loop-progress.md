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
> **Nota de entorno (bloquea el mecanismo de PR).** Hay una variable `GH_TOKEN` inválida que pisa la sesión válida de `gh` del keyring y hace fallar `git push` y los comandos `gh`. Mientras siga ahí, una corrida automatizada no puede abrir el branch/PR que exige la regla 1. Se limpia con `setx GH_TOKEN ""`.

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

| Métrica | Valor baseline | Fecha |
|---|---|---|
| Visitantes únicos / semana | _pendiente_ | — |
| Conversión visita → abre tema | _pendiente_ | — |
| Conversión `auth_open` → registro | _pendiente_ | — |
| Conversión → primer post | _pendiente_ | — |
| Retención (regreso ≥12 h) total | _pendiente_ | — |
| Retención por fuente (search / direct / social…) | _pendiente_ | — |
| New users / día | _pendiente_ | — |

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

1. **[medible ya]** Consultar la analítica propia (`/api/admin/analytics` o la SQLite) y anotar cuántos visitantes únicos y usuarios nuevos por día hay hoy. Es un dato que **ya se puede obtener** y define cuán lejos está la precondición de volumen. No depende de GSC.
2. **[bloqueante, espera]** Acumular volumen suficiente por cohorte. Semanas, no días.
3. **[entorno]** Limpiar la `GH_TOKEN` inválida para que el mecanismo de branch/PR funcione (§0).
4. Al haber datos: capturar baseline (§3).
5. Cruzar `retentionBySource` con las fuentes que trae el loop de SEO — responder si el tráfico de búsqueda retiene distinto ANTES de proponer cambios de producto.
6. Primer foco candidato de bajo costo: el drop-off `auth_open` → `registration_complete` (gente que abre el modal de registro y no completa). Ya está medido; una hipótesis de copy/fricción del formulario es barata y reversible.

---

## 8. Cosas que NO funcionaron (para no repetirlas)

> Registrar cada experimento con veredicto negativo, con fecha y por qué. Empieza vacío.

- _(sin entradas todavía)_
