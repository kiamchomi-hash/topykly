# Siembra manual — material para los primeros 100 usuarios

> Material de la Fase 2 del plan de crecimiento. La invitación la hace un humano, a mano.
> Nada de acá se automatiza y nada se publica en nombre de TOPYKLY sin leerlo antes.

---

## 0. Dos bloqueos previos (leer antes de mandar a nadie)

El recurso escaso no es el tráfico: es **la gente que estás dispuesto a invitar a mano**. Cada
persona que llega y rebota no vuelve. Estos dos problemas hacen rebotar a casi todos.

### 0.1 La app está vacía y no lo dice

Producción no siembra datos de demo (`services/preview-server.js:1897`, `shouldSeedDemoData(process.env, false)`)
— correcto, porque contenido fabricado sería comunidad falsa. Pero `ui/topics.js:14` hace
`if (!topics.length) return []`: con cero temas la lista renderiza **nada**. Ni estado vacío, ni
"creá el primero". El primero que entre ve una interfaz muerta y se va.

**Antes de invitar a nadie:** que haya conversación real en curso (§4) o un estado vacío que
invite a abrir el primer tema. Es un cambio chico y lo puedo hacer cuando digas.

### 0.2 Un invitado no puede participar: solo leer

Este es el bloqueo grande, y hay que entenderlo bien antes de invitar a nadie.

Un invitado **no puede comentar, ni crear temas, ni dar likes**. No es que tenga límites más
estrictos: no puede, y punto. `addMessage` (`services/backend-store.js:5890`) y `createTopic`
(`:5828`) llaman a `assertRegisteredContextCanPost`, que devuelve `403 LOGIN_REQUIRED` a cualquiera
que no esté registrado (`:3403-3411`). Los likes y dislikes tienen su propio corte equivalente
(`:5943`, `:5960`).

Lo único que puede hacer un invitado es leer y reportar.

**Lo que hay entre alguien que llega y su primera palabra:** elegir nickname, dar email, dar edad,
elegir contraseña, aceptar términos, resolver Turnstile si está configurado, **salir de la app a
buscar un código en el correo** y volver a pegarlo antes de que expiren los 10 minutos.

Esa es la verdadera pared. Para tráfico sembrado —gente que entró por curiosidad, desde un enlace,
sin intención previa— es enorme: hay que pagar el costo completo de una cuenta antes de recibir
absolutamente nada a cambio.

> **Nota técnica.** Los límites de invitado que existen en `getRateLimitConfig` (1 comentario cada
> 5 min, 1 tema cada 2 h) y lo que dice `task.md:73-74` son **historia del diseño**, no una tarea
> pendiente: el corte por registro se evalúa antes y los vuelve inalcanzables.

### Que los invitados no participen es una decisión tomada, no un pendiente

Decidido el 2026-07-22: **los invitados leen, no participan.** No está en discusión y no hay que
volver sobre eso al analizar el embudo.

Hay dos motivos por los que alguien podría querer "arreglarlo" por error, y los dos son falsos:
`task.md` describe invitados que crean temas y comentan, y el backend conserva sus límites escritos.
Ninguna de las dos cosas es un pendiente.

Además, técnicamente hoy no se podría sin más: todos los invitados comparten la fila de usuario
`guest-anonymous` (`getOrCreateGuestUser`), así que no son distinguibles entre sí como autores ni
moderables de a uno. Mientras solo lean, eso no genera ningún problema.

**Entonces la palanca está adentro del registro, no afuera.** Si el drop-off de
`auth_open` → `registration_complete` resulta ser el mayor punto de fuga, la opción a evaluar es
sacar el viaje al correo: `registerWithPassword` ya existe en el backend y crea la cuenta directo,
pero el modal de registro hoy no lo usa. Es una decisión de producto y de riesgo, así que se propone
y la aprobás vos; no se aplica sola.

**Mientras siga así**, todo el material de abajo asume que hay que registrarse para participar, y lo
dice de frente en vez de esconderlo.

---

## 1. Qué es TOPYKLY, en una frase

Todo lo de acá abajo es verdad verificable en el producto. No usar nada que no lo sea.

**Corta (para una bio o un mensaje suelto):**

> Un chat público por temas donde la conversación es efímera: los temas van rotando y, cuando salen,
> quedan archivados para leer.

**Media (para presentarlo en una comunidad):**

> TOPYKLY es un chat público organizado por temas. Solo hay una ventana chica de conversaciones
> activas a la vez, y cada tema guarda las últimas respuestas nada más. Cuando un tema sale de la
> ventana no se borra: queda archivado y se puede leer, pero ya no admite respuestas. La idea es que
> lo que está abierto esté vivo, y que lo viejo no se acumule encima.

**Larga (para un posteo donde se permite explicar):**

> Hice TOPYKLY porque me cansé de los foros donde todo queda abierto para siempre y de los chats
> donde todo se pierde. Es un punto intermedio: hay una cantidad limitada de temas activos a la vez,
> cada uno guarda solo las últimas respuestas, y los temas se ordenan por actividad reciente — si
> alguien responde algo viejo, vuelve arriba. Cuando un tema queda desplazado, pasa al archivo: se
> puede leer, no se puede seguir respondiendo.

**El diferencial en una línea, para cuando te preguntan "¿en qué se diferencia de X?":**

> No compite por acumular contenido. Compite por que lo que está abierto tenga gente adentro.

### Lo que NO hay que prometer

- No decir "comunidad activa", "miles de usuarios" ni nada sobre tamaño hasta que sea cierto.
- No hablar de mensajes privados: no existen y no van a existir.
- No prometer la tienda ni cosméticos: todavía no están implementados.
- No decir "en tiempo real": la sincronización es por polling de 1 segundo. "Se actualiza solo" es
  verdad; "tiempo real" es una exageración innecesaria.
- **No decir que se puede participar sin cuenta.** Es falso hoy (§0.2): sin registrarse solo se
  puede leer. Prometerlo garantiza que la persona llegue, escriba, choque contra el muro y se vaya
  con la sensación de que la engañaron. Es la peor forma posible de gastar una invitación.

---

## 2. Dónde sembrar

Ordenado por probabilidad de que funcione, no por tamaño.

1. **Comunidades donde ya participás.** Un mensaje tuyo en un Discord donde te conocen vale más que
   cien impresiones frías. Es el único canal con conversión decente al principio.
2. **Comunidades de gente que construye cosas** (indie hackers, desarrollo, side projects en
   español). Toleran y hasta buscan proyectos nuevos. Ojo: te van a dar feedback de producto, no
   usuarios recurrentes. Sirve para arreglar, no para crecer.
3. **Comunidades temáticas chicas** sobre lo que vos realmente quieras conversar en TOPYKLY. Si abrís
   temas de música, buscá gente de música. La coincidencia de interés es lo que hace que vuelvan.
4. **Círculo cercano.** Rápido, con techo bajo, y sesga la lectura: tus conocidos entran por vos, no
   por el producto. No saques conclusiones de retención con ellos.

**Regla no negociable:** leer las reglas de cada comunidad antes de postear. Casi todas prohíben la
autopromoción sin permiso. Donde esté prohibida, se pide permiso a un moderador o no se postea. Un
proyecto que arranca quemando comunidades no se recupera.

---

## 3. Textos por comunidad

No copiar y pegar el mismo en todos lados. Adaptar siempre la primera línea al contexto.

### 3.1 Discord / grupo donde ya participás

> Hice una cosa y me sirve que la rompan un poco. Es un chat por temas, `topykly.com`.
>
> La particularidad es que hay pocos temas abiertos a la vez y cada uno guarda solo las últimas
> respuestas. Cuando un tema se cae de la lista queda archivado para leer, pero ya no se puede
> responder.
>
> Ahora mismo hay poca gente, así que si entran de a varios se nota mucho más. Aviso: para escribir
> hay que crear cuenta, leer se puede sin nada. Si algo se siente raro, decímelo directamente.

_Por qué funciona:_ no oculta que está vacío ni que hay que registrarse. Convierte la escasez en
motivo para entrar juntos, que es lo que necesita un chat en vivo, y avisa del costo antes de que la
persona lo descubra sola —que es la diferencia entre una fricción y un engaño.

### 3.2 Comunidad de proyectos / indie

> **TOPYKLY — chat público por temas, con ventana activa limitada**
>
> Lo construí sin frameworks, JS puro con backend en Node y SQLite. La decisión de producto que me
> interesa discutir: solo hay una cantidad chica de temas activos a la vez y cada tema conserva
> únicamente las últimas respuestas. Lo que se desplaza queda archivado, legible pero cerrado.
>
> La apuesta es que un espacio con límite duro se mantiene más vivo que uno que acumula todo. No sé
> si es cierto todavía. Está recién abierto: `topykly.com`
>
> Lo que más me sirve escuchar: si el límite se siente como una restricción molesta o como algo que
> le da ritmo.

_Por qué funciona:_ pide algo concreto en vez de pedir usuarios. La gente responde mejor a una
pregunta que a un anuncio.

### 3.3 Comunidad temática (adaptar el tema)

> ¿Alguien tiene ganas de una conversación sobre [tema] fuera de acá? Abrí un tema en TOPYKLY, que es
> un chat público donde las conversaciones duran mientras hay gente respondiendo y después se
> archivan.
>
> El tema está acá: [enlace directo al tema]
>
> Se puede leer sin cuenta; para responder hay que registrarse.

_Por qué funciona:_ invita a **una conversación concreta**, no a una plataforma. Enlace directo al
tema, nunca a la home — que alguien caiga en una lista vacía es el peor primer segundo posible. Y
como acá el registro es un costo real, el tema tiene que valer el precio: una pregunta tibia no lo
paga.

### 3.4 Mensaje a una persona (WhatsApp / DM)

> Armé un chat por temas y estoy juntando las primeras personas. Abrí un tema sobre [algo que le
> interese a esa persona]: [enlace]. ¿Le tirás una respuesta? Te va a pedir crear cuenta, es un
> minuto. Con poca gente cada respuesta se nota.

_Por qué funciona:_ pide una acción única y chica ("una respuesta"), no un compromiso, y pone el
costo del registro por delante en vez de dejar que lo descubra a mitad de camino.

> **Ojo con este canal mientras el registro siga como está.** Es el único donde tenés crédito
> personal suficiente para que alguien pague el costo de una cuenta por hacerte un favor. Eso lo
> hace el más efectivo hoy —y el que peor mide: están respondiendo por vos, no por el producto. No
> saques conclusiones de retención de acá.

---

## 4. Guion de arranque

El problema del bar vacío no se resuelve con copy. Se resuelve con que haya algo pasando.

**Lo que sí podés hacer:** abrir temas vos mismo, con tu cuenta, sobre cosas que genuinamente querés
conversar. Sos un usuario real de tu propio producto.

**Lo que no se hace nunca:** crear cuentas falsas, personajes, o responderte a vos mismo simulando
gente. Además de ser comunidad falsa, para Google es _scaled content abuse_ y hunde justo el canal
de archivo que sostiene el crecimiento. Está fuera de la mesa, sin excepción.

### Antes de mandar el primer enlace

1. **Abrí entre 3 y 5 temas, no 20.** Cinco temas con una pregunta real se ven como un lugar que
   arranca. Veinte temas de una sola persona se ven como un decorado.
2. **Que sean preguntas abiertas, no anuncios.** "¿Qué estás escuchando ahora?" recibe respuestas.
   "Bienvenidos a TOPYKLY" no recibe ninguna.
3. **Que sean sobre cosas distintas entre sí**, para que quien llegue encuentre al menos una que le
   toque.
4. **Ninguno sobre TOPYKLY.** Un espacio cuyo único tema es el espacio mismo no da ganas de entrar.

### Durante la ventana de siembra

- **Estate adentro cuando mandes el enlace.** El valor prometido es que haya alguien. Si invitás y no
  estás, la promesa falla en el primer segundo.
- **Respondé rápido a todo lo que entre.** En esta etapa cada respuesta tuya es la diferencia entre
  una conversación y un mensaje huérfano.
- **Sembrá en tandas chicas**, una comunidad por vez, con días de diferencia. Así sabés cuál trajo
  gente. Si mandás a cinco lados el mismo día, `retentionBySource` no te va a poder decir nada.

### Después

Anotá para cada tanda: dónde, qué día, cuántas personas entraron, cuántas volvieron. Eso es lo que
alimenta el baseline del [loop de producto](.agents/product-loop-progress.md) y lo que decide dónde
insistir. Sin ese registro, la siembra es anécdota.

---

## 5. Primer impacto: lo que se lee al llegar

La descripción actual del sitio dice:

> "TOPYKLY es una comunidad social para conversar por temas, descubrir rankings, conectar con
> usuarios y personalizar tu perfil."

El problema: describe **funcionalidades** y podría ser cualquier red social. No dice qué tiene de
distinto ni por qué entrar ahora.

Propuesta:

> "Chat público por temas. Pocas conversaciones abiertas a la vez, cada una viva mientras haya gente
> respondiendo. Lo que se cierra queda archivado para leer."

Es un cambio en `index.html` y en `services/seo-pages.js` (afecta también el snippet de Google y las
tarjetas al compartir). No lo apliqué: es una decisión de marca y la aprobás vos.

---

## 6. Cómo saber si funcionó

Sin esto, la siembra no enseña nada.

- **La métrica que importa es `return_visit`** (regreso a las ≥12 h). Es la única difícil de
  engañar: no la infla un F5 ni la curiosidad del primer día.
- **Leer siempre `uniqueSubjects`, nunca `total`** — `total` cuenta filas y cada recarga suma una.
  Detalle en la [regla de lectura](.agents/product-loop-progress.md#regla-de-lectura-uniquesubjects-nunca-total).
- **No concluir con cohortes chicas.** Con 15 personas, una diferencia del 20 % es ruido. El
  veredicto honesto casi siempre va a ser "seguir midiendo".
- **Una tanda por vez.** Es lo único que permite atribuir.
- **Mirá primero `auth_open` → `registration_complete`.** Participar exige cuenta y así queda
  (§0.2), con lo cual ese paso es el cuello de botella de todo: cada persona que se cae ahí es
  alguien que quiso escribir y no pudo. Si esa tasa es muy baja, el problema no es el copy de la
  siembra ni los temas que abriste, es el registro. Se trabaja adentro del registro —no abriendo la
  participación a invitados— y no se rediseña nada más hasta descartarlo.

**Señal de éxito real de esta fase:** no "entraron 100 personas", sino que **dos personas que no se
conocen sostengan una conversación sin que vos participes**. Ese es el momento en que el producto
empieza a existir por su cuenta. Todo lo anterior es andamiaje.
