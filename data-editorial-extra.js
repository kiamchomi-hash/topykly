// Segundo conjunto editorial de TOPYKLY, pensado para que /archivo tenga paginas
// con conversacion suficiente (SEO_THIN_TOPIC_COMMENT_COUNT exige 3+ comentarios).
//
// Reglas que cumple este contenido y hay que sostener si se amplia:
// - Las cuentas llevan role "Cuenta editorial" y lo dicen en su descripcion. No se
//   presentan como personas reales (mismo criterio que initialUsers en data.js).
// - Los temas son atemporales: nada de noticias, fechas ni personas reales, para no
//   quedar desactualizado ni afirmar hechos que despues haya que verificar.
//
// Formato de cada tema: [titulo, bajada, [respuestas], idAutor].
export const extendedEditorialUsers = [
  {
    id: "s1",
    name: "Lumen",
    nickname: "lumen",
    role: "Cuenta editorial",
    score: 64,
    description: "Perfil editorial ficticio de TOPYKLY sobre rutinas, orden y vida cotidiana."
  },
  {
    id: "s2",
    name: "Tarco",
    nickname: "tarco",
    role: "Cuenta editorial",
    score: 61,
    description:
      "Perfil editorial ficticio de TOPYKLY con temas de casa, mudanzas y arreglos simples."
  },
  {
    id: "s3",
    name: "Salix",
    nickname: "salix",
    role: "Cuenta editorial",
    score: 59,
    description:
      "Perfil editorial ficticio de TOPYKLY dedicado a plantas, balcones y espacios verdes chicos."
  },
  {
    id: "s4",
    name: "Nubla",
    nickname: "nubla",
    role: "Cuenta editorial",
    score: 57,
    description: "Perfil editorial ficticio de TOPYKLY sobre descanso, pausas y habitos de sueno."
  },
  {
    id: "s5",
    name: "Ferro",
    nickname: "ferro",
    role: "Cuenta editorial",
    score: 55,
    description:
      "Perfil editorial ficticio de TOPYKLY con conversaciones sobre bicicleta y movilidad urbana."
  },
  {
    id: "s6",
    name: "Grava",
    nickname: "grava",
    role: "Cuenta editorial",
    score: 53,
    description:
      "Perfil editorial ficticio de TOPYKLY sobre presupuesto, compras y decisiones de gasto."
  },
  {
    id: "s7",
    name: "Merlo",
    nickname: "merlo",
    role: "Cuenta editorial",
    score: 51,
    description: "Perfil editorial ficticio de TOPYKLY con temas de lectura, estudio y aprendizaje."
  },
  {
    id: "s8",
    name: "Ondas",
    nickname: "ondas",
    role: "Cuenta editorial",
    score: 49,
    description: "Perfil editorial ficticio de TOPYKLY sobre musica, series y consumo cultural."
  },
  {
    id: "s9",
    name: "Prisa",
    nickname: "prisa",
    role: "Cuenta editorial",
    score: 47,
    description:
      "Perfil editorial ficticio de TOPYKLY sobre organizacion del tiempo y trabajo remoto."
  },
  {
    id: "s10",
    name: "Quilo",
    nickname: "quilo",
    role: "Cuenta editorial",
    score: 45,
    description: "Perfil editorial ficticio de TOPYKLY con ideas de cocina simple para poca gente."
  },
  {
    id: "s11",
    name: "Ramal",
    nickname: "ramal",
    role: "Cuenta editorial",
    score: 43,
    description:
      "Perfil editorial ficticio de TOPYKLY sobre transporte, viajes cortos y rutinas de traslado."
  },
  {
    id: "s12",
    name: "Sauce",
    nickname: "sauce",
    role: "Cuenta editorial",
    score: 41,
    description: "Perfil editorial ficticio de TOPYKLY sobre vinculos, amistades y vida en comun."
  },
  {
    id: "s13",
    name: "Tempo",
    nickname: "tempo",
    role: "Cuenta editorial",
    score: 39,
    description: "Perfil editorial ficticio de TOPYKLY sobre concentracion, foco y pantallas."
  },
  {
    id: "s14",
    name: "Urbel",
    nickname: "urbel",
    role: "Cuenta editorial",
    score: 37,
    description:
      "Perfil editorial ficticio de TOPYKLY con temas de barrio, ciudad y espacio publico."
  },
  {
    id: "s15",
    name: "Valko",
    nickname: "valko",
    role: "Cuenta editorial",
    score: 35,
    description: "Perfil editorial ficticio de TOPYKLY sobre primeros trabajos y vida laboral."
  },
  {
    id: "s16",
    name: "Wenda",
    nickname: "wenda",
    role: "Cuenta editorial",
    score: 33,
    description:
      "Perfil editorial ficticio de TOPYKLY sobre ropa, cuidado de objetos y consumo responsable."
  },
  {
    id: "s17",
    name: "Xilma",
    nickname: "xilma",
    role: "Cuenta editorial",
    score: 31,
    description:
      "Perfil editorial ficticio de TOPYKLY sobre mascotas y convivencia en departamento."
  },
  {
    id: "s18",
    name: "Yerba",
    nickname: "yerba",
    role: "Cuenta editorial",
    score: 29,
    description:
      "Perfil editorial ficticio de TOPYKLY sobre rituales cotidianos y encuentros informales."
  },
  {
    id: "s19",
    name: "Zafir",
    nickname: "zafir",
    role: "Cuenta editorial",
    score: 27,
    description:
      "Perfil editorial ficticio de TOPYKLY sobre memoria, notas y metodos para no olvidar."
  },
  {
    id: "s20",
    name: "Botia",
    nickname: "botia",
    role: "Cuenta editorial",
    score: 25,
    description: "Perfil editorial ficticio de TOPYKLY sobre habitos chicos y cambios sostenibles."
  }
];

export const extendedEditorialTopicSeedData = [
  [
    "Compras del mes: ¿cómo haces para que no sobre ni falte comida?",
    "Listas, congelador, compras semanales o una sola grande: cuenta qué método te funciona y cuánto te dura.",
    [
      "A mí lo que más me cambió fue anotar durante dos semanas lo que efectivamente tiraba. Casi todo era verdura comprada de más, no las cosas caras que creía.",
      "Compra grande una vez al mes para lo seco y limpieza, y una vuelta corta cada semana para lo fresco. Mezclar las dos cosas en un solo viaje es lo que me hacía comprar de más.",
      "Antes de salir abro la heladera y saco una foto. Suena tonto, pero elimina las tres compras repetidas de siempre.",
      "El congelador es la pieza clave. Si compras fresco pensando en congelar la mitad el mismo día, deja de importar que la oferta sea por cantidad.",
      "Yo armo la lista por sectores del supermercado en vez de por tipo de comida. Camino menos, tardo menos y agarro menos cosas que no iba a buscar.",
      "Un detalle que subestimaba: comprar con hambre. La diferencia entre ir después de almorzar o antes se nota en el ticket.",
      "Nosotros pasamos a planificar solo cuatro cenas por semana en vez de siete. Las otras tres salen de lo que quedó, y eso solo bajó bastante el desperdicio.",
      "Si vives cerca de una verdulería conviene comprar poco y seguido aunque parezca menos eficiente. Lo que se pudre siempre sale más caro que el viaje extra."
    ],
    "s6"
  ],
  [
    "No poder dormir: ¿qué te terminó funcionando de verdad?",
    "Sin recetas mágicas ni consejos médicos: qué probaste, qué descartaste y qué sostienes hoy.",
    [
      "Lo único que me sirvió de forma sostenida fue levantarme siempre a la misma hora, incluso cuando dormí mal. Acostarme temprano nunca funcionó por sí solo.",
      "Salir de la cama después de veinte minutos dando vueltas. Quedarme peleando ahí adentro me hacía asociar la cama con la frustración.",
      "Bajar la luz de toda la casa una hora antes, no solo la del celular. La lámpara del techo encendida hasta el último segundo me despertaba más que la pantalla.",
      "A mí me ordenó tener un lugar donde anotar lo pendiente antes de acostarme. Buena parte del insomnio era repasar cosas por miedo a olvidarlas.",
      "El café después del mediodía me afectaba mucho más de lo que creía. Lo descubrí recién cuando corté una semana entera para probar.",
      "Ojo con los ruidos que uno ya no registra. Puse el teléfono en otra habitación y desapareció un despertar que tenía siempre a la misma hora.",
      "La temperatura del cuarto me importó más que cualquier otra cosa. Con calor no hay rutina que alcance.",
      "Dejé de mirar el reloj de noche. Saber que eran las tres agregaba una capa de ansiedad que no aportaba nada.",
      "Una caminata a la tarde, aunque sea corta. Entrenar fuerte de noche me dejaba peor, así que la hora importa tanto como la actividad.",
      "Si el problema aparece todas las semanas y ya probaste lo básico, en algún momento conviene consultarlo en serio en vez de seguir sumando trucos.",
      "Algo que ayuda a bajarle el drama: una noche mala no arruina el día siguiente tanto como uno cree. Pensar eso me quitó presión y, de rebote, dormí mejor."
    ],
    "s4"
  ],
  [
    "Trabajo remoto: ¿cómo separas la casa del trabajo si es el mismo lugar?",
    "Horarios, rincones fijos, rituales de cierre: qué usas para que el día termine en algún momento.",
    [
      "Un ritual de cierre corto y siempre igual. Cierro todo, anoto tres cosas para mañana y guardo la notebook en un cajón. Sin ese último paso el día no termina nunca.",
      "Si puedes, que el lugar de trabajo no sea donde después descansas. Trabajar en el sillón me arruinó el sillón, no me mejoró el trabajo.",
      "Salir a la calle antes de empezar, aunque sean diez minutos a la vuelta de la manzana. Funciona como el viaje que ya no haces.",
      "Cambiarme de ropa. Parece superficial y a mí me resultó lo más efectivo de todo.",
      "Tener horarios visibles para los demás ayuda más que tenerlos para uno mismo. Si en casa saben cuándo terminas, dejan de aparecer consultas a cualquier hora.",
      "Yo dejé de contestar mensajes fuera de horario y el equipo se acomodó solo en dos semanas. La expectativa la había creado yo.",
      "Los descansos hay que agendarlos igual que las reuniones. Si no, no existen o duran toda la tarde.",
      "Lo más difícil no fue empezar a la mañana sino frenar. Puse una alarma para el final del día, no para el principio.",
      "Cuidado con hacer tareas de casa entre medio para aprovechar. Termina mezclando todo y a la noche sientes que ni trabajaste ni descansaste."
    ],
    "s9"
  ],
  [
    "¿Qué libro te sacó de una racha larga sin leer?",
    "No hace falta que sea bueno ni importante: alcanza con que te haya enganchado cuando nada lo lograba.",
    [
      "A mí me destrabó volver a algo que ya había leído. Sin la exigencia de entender nada nuevo, la lectura dejó de ser una tarea.",
      "Algo corto. Un libro de cuentos me sirvió porque cada noche terminaba una cosa entera, y eso da una sensación de avance que un tomo largo no da.",
      "Cambiar de formato también vale. Volví leyendo en el celular en el transporte, que era el único momento donde igual iba a estar mirando una pantalla.",
      "Abandonar sin culpa. Arrastré un libro que no me gustaba durante meses y ese fue el motivo real de la racha, no la falta de tiempo.",
      "Una novela policial. No es lo que suelo leer, pero necesitaba algo que tirara de mí en vez de pedirme esfuerzo.",
      "Me funcionó fijar un horario mínimo y ridículo: diez minutos antes de dormir. Casi siempre terminaban siendo cuarenta, pero el compromiso era chico."
    ],
    "s7"
  ],
  [
    "Vivir solo por primera vez: ¿qué te hubiera servido saber antes?",
    "Gastos que no se ven, cosas que se compran una sola vez y errores del primer mes.",
    [
      "El gasto que no había calculado no fue el alquiler sino todo lo que se compra una vez: trapos, ollas, una escoba, cortinas. Se va un sueldo en cosas chicas.",
      "Pregunta por las expensas antes de firmar y pedí ver los últimos meses. Hay edificios donde son casi otro alquiler.",
      "Averigua cómo se corta la luz, el agua y el gas el primer día. No cuando ya hay agua en el piso.",
      "Compra lo mínimo el primer mes y espera a ver cómo usas el lugar. La mitad de lo que compré al principio terminó estorbando.",
      "Cocinar de más a propósito y congelar en porciones. Es lo que evita que los días malos terminen siempre en delivery.",
      "Ten un juego de llaves con alguien de confianza. Es barato y evita una noche muy cara.",
      "Anota los números de los medidores el día que entras, con foto. Sirve para discutir cualquier factura rara después.",
      "La soledad de la primera semana es real y pasa. No tomes decisiones sobre la mudanza dentro de esos primeros días.",
      "Pon plata aparte para arreglos desde el primer mes, aunque sea poca. Algo se rompe siempre, y nunca en un momento cómodo.",
      "Aprender a usar bien el lavarropas me ahorró más ropa que cualquier consejo de compra.",
      "Conocer a los vecinos temprano, aunque no seas de hablar. Cuando necesitas algo urgente ya es tarde para presentarse.",
      "Revisa la presión del agua y el estado del calefón antes de mudarte. Son las dos cosas que peor se arreglan después.",
      "Yo subestimé el ruido. Visita el departamento un día de semana a la noche, no un domingo a la mañana."
    ],
    "s2"
  ],
  [
    "¿Cómo eliges qué aprender cuando te interesa todo?",
    "Estrategias para no empezar cinco cosas y terminar ninguna.",
    [
      "Me sirvió preguntarme qué quiero poder hacer, no qué quiero saber. La respuesta suele descartar la mitad de la lista sola.",
      "Una cosa por vez y con fecha de revisión. A los dos meses decido si sigo o cierro, y cerrar cuenta como terminar.",
      "Elegir lo que tenga un uso cercano. Aprendí cosas hermosas que no volví a tocar, y lo que quedó fue siempre lo que usé dentro de la misma semana.",
      "Escribo las ideas nuevas en una lista de espera en vez de empezarlas. Casi ninguna sobrevive a leerla un mes después, y eso ya es información.",
      "Si puedes, busca algo donde alguien te vea. Un curso con entregas o un grupo hace más por la constancia que la motivación.",
      "Yo alterno una cosa exigente con una liviana. Sostener dos cosas difíciles a la vez no me funcionó nunca.",
      "Empezar por el proyecto más chico posible que ya sirva para algo. Terminar algo mínimo enseña más que la mitad de un curso largo."
    ],
    "s7"
  ],
  [
    "Presupuesto en pareja: ¿cuentas juntas, separadas o mixtas?",
    "Cómo se reparten los gastos comunes y qué conviene conversar antes de mezclar todo.",
    [
      "Nosotros usamos el esquema mixto: una cuenta común para lo compartido y cada uno lo suyo aparte. Fue lo único que sobrevivió a más de un año.",
      "Lo importante no es el esquema sino haber hablado de números antes de convivir. Nos evitamos discusiones que en realidad no eran sobre plata.",
      "Si los ingresos son muy distintos, dividir a la mitad puede ser injusto en la práctica. Aportar en proporción nos sacó una tensión de encima.",
      "Definan qué es gasto común y qué no, por escrito. La mayoría de los conflictos que vi eran por categorías, no por montos.",
      "Una revisión corta una vez por mes, con fecha. Hablarlo solo cuando algo molesta garantiza que se hable siempre enojado.",
      "Que cada uno conserve algo propio que no tenga que justificar. Chico, pero propio.",
      "Cuidado con que uno solo administre todo. Es cómodo hasta que esa persona no está o se cansa.",
      "Nosotros anotamos los gastos comunes en una nota compartida en el celular. Nada sofisticado, pero al mes se ve clarísimo dónde se va.",
      "Antes de una compra grande, acordamos un monto a partir del cual se consulta. Saber el número evita adivinar qué le va a molestar al otro.",
      "Si hay deudas previas de alguno, conviene ponerlas sobre la mesa temprano. Enterarse después es lo que hace daño, no la deuda."
    ],
    "s6"
  ],
  [
    "¿Qué método usas para acordarte de las cosas sin depender del celular?",
    "Papel, cuadernos, listas en la puerta o repetir en voz alta: qué te funciona y qué te falló.",
    [
      "Un cuaderno chico en el bolsillo. Lo escrito a mano se me queda mucho mejor que lo tipeado, aunque después no vuelva a mirarlo.",
      "Yo dejo los objetos en el camino. Si tengo que llevar algo mañana, lo pongo contra la puerta y listo.",
      "Una sola lista, no cinco. El problema nunca fue la herramienta sino tener lo pendiente repartido en cuatro lugares distintos.",
      "Decirlo en voz alta cuando lo hago. Suena raro pero corta esa duda de si cerré la puerta o no.",
      "Pizarra en la cocina. Es el único lugar por donde paso todos los días sí o sí.",
      "Asociar la tarea a algo que ya hago siempre. Tomar la pastilla cuando pongo la pava funciona mejor que cualquier alarma."
    ],
    "s19"
  ],
  [
    "Cocinar para una persona: ¿cómo evitas comer siempre lo mismo?",
    "Porciones, sobras, congelado y compras chicas: qué resuelves y qué te sigue costando.",
    [
      "Cocinar una base neutra grande y variarla durante la semana. Arroz o legumbres el domingo, y después cambia solo lo que le pongo encima.",
      "El problema no es cocinar, es lavar. Desde que uso una sola sartén para casi todo, cocino mucho más seguido.",
      "Congelar en porciones individuales desde el principio, no cuando ya sobró. Cambia por completo qué tan probable es que lo comas.",
      "Comprar verdura ya cortada o congelada cuando el día viene difícil. Sale un poco más caro que tirarla entera a la basura, que era lo que pasaba antes.",
      "Tener tres o cuatro recetas que salgan en quince minutos y que te gusten de verdad. No hace falta un repertorio grande.",
      "A mí me ayudó dejar de intentar que cada comida sea una comida completa. A veces son dos cosas simples y está bien.",
      "Los huevos y las latas de legumbres son el piso. Con eso siempre hay algo, incluso cuando no compraste nada.",
      "Cocinar dos porciones y comer la segunda al día siguiente al mediodía. Ni sobra ni se repite tanto como cocinar para cuatro días.",
      "Las especias son lo más barato que cambia más. El mismo pollo con tres condimentos distintos ya no se siente igual.",
      "Yo compro poco y camino más seguido a la verdulería. Con una sola persona, comprar grande casi siempre termina en desperdicio.",
      "Un día fijo de cocinar para adelante, aunque sea una sola preparación. El resto de la semana se sostiene solo.",
      "Si vives solo, invitar a alguien cada tanto es la mejor excusa para cocinar algo distinto. Se aprende más en esa comida que en un mes de rutina."
    ],
    "s10"
  ],
  [
    "¿Cómo se sostiene una amistad cuando los dos están ocupados?",
    "Sin culpa y sin agenda imposible: qué funciona cuando verse seguido dejó de ser una opción.",
    [
      "Bajar la expectativa de la juntada larga. Un café de cuarenta minutos cada tanto sostiene más que la cena de tres horas que nunca sucede.",
      "Fijar una fecha recurrente aunque sea lejana. Una vez por mes, siempre el mismo día, y el que no puede avisa.",
      "Mandar cosas sueltas sin esperar conversación. Una foto o un audio corto mantienen el vínculo vivo sin pedirle tiempo a nadie.",
      "Aceptar que hay temporadas. Estuvimos casi un año sin vernos y no pasó nada; la amistad no se mide en frecuencia.",
      "Hacer cosas juntos que igual ibas a hacer solo. Hacer un trámite acompañado o ir al supermercado suena poco romántico y funciona muy bien.",
      "El que tiene más tiempo en ese momento pone más. Se va turnando y no hace falta llevar la cuenta.",
      "Decirlo de frente cuando extrañas a alguien. Muchas amistades se apagan porque los dos esperaban que escribiera el otro.",
      "Las llamadas mientras caminas. Es el único rato del día que tengo libre y terminó siendo el mejor momento para hablar largo."
    ],
    "s12"
  ],
  [
    "Bicicleta en la ciudad: ¿qué aprendiste después del primer mes?",
    "Rutas, horarios, mantenimiento y las cosas que nadie te cuenta hasta que ya estás pedaleando.",
    [
      "La ruta más corta casi nunca es la mejor. Perdí diez minutos y gané una calle tranquila, y ese cambio fue lo que me hizo seguir.",
      "Aprender a arreglar una pinchadura antes de necesitarlo. La primera vez que te pasa lejos de casa entiendes por qué todos lo repiten.",
      "Las luces no son para ver, son para que te vean. Es lo primero que compraría de nuevo.",
      "Salir quince minutos antes cambia todo. Apurado en bici se toman decisiones que no se toman tranquilo.",
      "Revisa la presión de las cubiertas una vez por semana. Es lo que más se descuida y lo que más cansancio explica.",
      "Guardala adentro si puedes. La bici que duerme en la calle dura mucho menos, aunque tenga buena traba.",
      "Al mes empecé a mirar el mapa distinto. Ahora sé qué calles tienen semáforos largos y cuáles suben, cosas que en auto ni registraba."
    ],
    "s5"
  ],
  [
    "¿Qué haces con la ropa que ya no usas pero no quieres tirar?",
    "Donación, arreglos, reventa o guardarla un tiempo más: qué te resultó y qué fue perder el tiempo.",
    [
      "La prueba que uso: si hace un año que no me la pongo, no me la voy a poner. Guardarla por si acaso me llenó dos cajones.",
      "Donar sirve, pero conviene averiguar antes qué reciben. Muchos lugares no aceptan cualquier cosa y la ropa termina siendo un problema para ellos.",
      "Arreglar un pantalón sale bastante menos que uno nuevo y queda a medida. Lo descubrí tarde.",
      "Vender ropa usada lleva más tiempo del que parece. Si son pocas prendas, no compensa.",
      "Separo por estado, no por gusto: lo que está impecable se dona o se vende, lo roto va a trapos y lo dudoso lo pruebo una vez más.",
      "Las prendas muy gastadas sirven como trapos de limpieza y ahorran comprarlos. Es lo único que hago con lo que ya no anda.",
      "A mí me funcionó la caja de espera: lo dudoso va ahí seis meses. Lo que no abrí en ese tiempo se va sin volver a mirarlo.",
      "Intercambiar con amigos. Se van cosas que a uno no le entran y vuelven cosas que sí, sin gastar nada.",
      "Ojo con acumular pensando en un cambio de talle futuro. Es el motivo por el que la mitad de la gente tiene un placard trabado.",
      "Fíjate si en tu zona hay contenedores de recolección textil. No siempre existen, pero cuando sí, resuelven la ropa que ya no sirve para nadie.",
      "Las zapatillas viejas casi nunca se pueden donar. Es mejor sacarlas del circuito que pasarle el problema a otro.",
      "Guardo por temporada, no todo junto. Ver solo la ropa de la estación hace mucho más fácil darse cuenta de qué no usas.",
      "Lo que compré por impulso es siempre lo primero que se va. Mirar eso me hizo comprar distinto, que era el problema de fondo.",
      "Una vuelta al placard cuando cambia la estación, con fecha en el calendario. Si espero a tener ganas, no pasa nunca."
    ],
    "s16"
  ],
  [
    "Estudiar de grande: ¿cómo lo acomodas con el trabajo?",
    "Horarios reales, materias que se cursan de a poco y cómo se sostiene cuando el día ya está lleno.",
    [
      "Menos materias por vez de las que crees que puedes. Es la diferencia entre avanzar despacio y abandonar.",
      "El horario que me funciona es temprano a la mañana, antes de que el día empiece a pedirme cosas. A la noche nunca me quedó energía.",
      "Avisar en el trabajo, si el ambiente lo permite. Cuando saben que estás cursando aparecen flexibilidades que no ibas a pedir.",
      "Estudiar en el mismo lugar siempre ayuda más de lo que parece. El cerebro entiende para qué está ahí.",
      "Aprovechar los ratos muertos para lo liviano y guardar el bloque largo para lo difícil. Leer en el transporte y hacer ejercicios en casa.",
      "No comparar tu ritmo con el de alguien de veinte que cursa a tiempo completo. Es una carrera distinta.",
      "Una semana mala no arruina el cuatrimestre. Lo que arruina es abandonar después de la semana mala.",
      "Busca un grupo, aunque sea de dos personas. Estudiar de grande es bastante solitario y eso pesa más que el contenido.",
      "Yo dejé de intentar recuperar el tiempo perdido. Sumar horas los fines de semana me quemó y ahí casi lo dejo."
    ],
    "s7"
  ],
  [
    "¿Cómo eliges una serie sin pasar una hora eligiendo?",
    "Métodos para cortar la parálisis del catálogo infinito.",
    [
      "Regla de los dos capítulos: si al segundo no me atrapó, la corto sin culpa. Antes arrastraba temporadas enteras por terquedad.",
      "Tengo una lista de tres cosas pendientes, no de treinta. Cuando se acaba, agrego. La lista larga es justamente el problema.",
      "Preguntarle a alguien en vez de al algoritmo. Las recomendaciones que más me gustaron nunca me las sugirió una plataforma.",
      "Decido antes de sentarme, no con el control en la mano. Elegir frente a la pantalla es donde se va la hora.",
      "Si estoy cansado voy a algo ya visto y listo. Aceptarlo me sacó la sensación de estar perdiendo el tiempo.",
      "Miniseries. Saber que termina en seis capítulos baja muchísimo el costo de empezar."
    ],
    "s8"
  ],
  [
    "Plantas de interior: ¿cuál aguanta a alguien que se olvida de regar?",
    "Qué sobrevive con poca luz, poca agua y poca atención, y qué es mejor no intentar.",
    [
      "El potus es el clásico por algo. Perdona el olvido y avisa cuando tiene sed en vez de morirse en silencio.",
      "La sansevieria aguanta casi todo. El error con esa planta no es olvidarse de regar, es regarla de más.",
      "Antes de comprar, mira cuánta luz tienes de verdad. La mayoría de las muertes que vi fueron por luz, no por agua.",
      "El zamioculcas es prácticamente indestructible y no necesita ventana buena. Es lo que le regalo a la gente que dice que mata todo.",
      "Meter el dedo en la tierra antes de regar. Si sale seco a dos centímetros, se riega; si no, se espera.",
      "Los cactus no son para principiantes distraídos, al revés de lo que se cree. Aguantan la sequía pero necesitan mucho sol.",
      "Menos plantas y mejor ubicadas. Tener quince en un ambiente oscuro es garantía de frustración.",
      "Regar el mismo día de la semana funciona hasta que cambia la estación. En invierno hay que espaciar bastante.",
      "Fíjate que la maceta tenga agujeros. Suena básico y es el error más común de todos.",
      "Yo empecé con esquejes que me regalaron en vez de comprar. Si se muere no duele, y si prende ya sabes que esa planta anda en tu casa."
    ],
    "s3"
  ],
  [
    "¿Qué cambió en tu día cuando silenciaste las notificaciones?",
    "Qué apagaste, qué dejaste prendido y si realmente se notó.",
    [
      "Dejé prendidas solo llamadas y mensajes de tres personas. Todo lo demás lo miro cuando yo decido, y no me perdí nada importante.",
      "Lo que más cambió no fue la concentración sino la sensación de urgencia permanente. Bajó mucho.",
      "Apagar el punto rojo de los íconos hizo más que silenciar el sonido. El número creciendo era lo que me arrastraba.",
      "Los primeros días revisaba el celular igual, por costumbre. Eso pasa a las dos semanas.",
      "Avisar a la gente cercana que ahora contesto más lento evitó malentendidos. El problema nunca fue técnico.",
      "Saqué las notificaciones del trabajo del celular personal. Fue el cambio con mayor efecto y el que más me costó decidir.",
      "Modo concentración en franjas fijas, no todo el día. Prohibirme todo terminaba en abandonar el sistema entero.",
      "El celular boca abajo o en otro cuarto. Silenciado pero a la vista sigue interrumpiendo igual.",
      "Yo noté la diferencia en cómo terminaba el día, no en cuánto producía. Menos cansado, mismo trabajo.",
      "Cuidado con reemplazarlo por revisar todo cada media hora a propósito. Ahí no ganaste nada.",
      "Después de un mes volví a habilitar algunas y me di cuenta de cuáles extrañaba de verdad: dos. Las otras veinte no."
    ],
    "s13"
  ],
  [
    "Primer trabajo: ¿qué le dirías a alguien que arranca la semana que viene?",
    "Lo que se aprende en los primeros meses y no está en ninguna inducción.",
    [
      "Preguntar temprano. La pregunta que da vergüenza la primera semana da mucha más vergüenza al tercer mes.",
      "Anota todo los primeros días, aunque parezca obvio. Nadie espera que te acuerdes, pero sí que no lo pregunten cuatro veces.",
      "Cuando no llegas con algo, avisa antes de la fecha y no después. Es lo que más rápido construye confianza.",
      "Aprende quién sabe qué. Saber a quién preguntarle vale casi tanto como saber la respuesta.",
      "No confundas ser nuevo con no poder opinar. Preguntar por qué se hace algo así suele ser bienvenido si es genuino.",
      "Los primeros errores importan menos de lo que sientes. Lo que se mira es cómo los resuelves y si los avisas.",
      "Cuida los horarios desde el principio. Lo que aceptas el primer mes se vuelve la expectativa después.",
      "Come con gente cuando puedas. La mitad de lo que entendí de cómo funcionaba el lugar lo aprendí en esos ratos."
    ],
    "s15"
  ],
  [
    "¿Cómo armas una lista de reproducción para concentrarte?",
    "Con letra o sin letra, larga o corta, siempre la misma o variada: qué te funciona.",
    [
      "Sin letra en el idioma que hablo. Con música en otro idioma me concentro igual, con letra en español no puedo.",
      "Siempre la misma lista. Después de unas semanas funciona como señal de que empieza el trabajo, más que como música.",
      "Larga, para no tener que elegir nada a mitad de camino. Cualquier interrupción para cambiar tema me cuesta diez minutos.",
      "Ruido ambiente en vez de música cuando tengo que escribir. La música me sirve para tareas mecánicas, no para pensar.",
      "Volumen bajo. Si la escucho de verdad, me estoy distrayendo con ella.",
      "Yo separo dos listas: una para arrancar, más movida, y otra para sostener, más plana. Cambiarlas a la hora de trabajo me marca las etapas.",
      "Probé el silencio y también funciona, pero solo si el lugar es silencioso. La música tapa ruido impredecible, que es lo que más rompe."
    ],
    "s8"
  ],
  [
    "Mascota en departamento: ¿qué se subestima antes de decidirse?",
    "Espacio, ruido, tiempo y costos: lo que conviene tener claro antes y no después.",
    [
      "El tiempo, no el espacio. Un perro en un departamento grande y solo diez horas por día está peor que en uno chico con alguien cerca.",
      "Los costos veterinarios no son un extra ocasional, son parte del presupuesto mensual. Es lo que más gente subestima.",
      "Averigua el reglamento del edificio antes, no después de tener el animal en casa.",
      "El ruido va en las dos direcciones: lo que hace tu mascota y lo que la asusta. Los vecinos ruidosos afectan más de lo que uno piensa.",
      "Piensa quién se hace cargo cuando viajas. Si no tienes respuesta a eso, todavía no estás listo.",
      "Los gatos necesitan altura, no metros cuadrados. Con repisas y un lugar junto a la ventana, un departamento chico les alcanza.",
      "Las salidas son innegociables y son todos los días, llueva o no. Ahí es donde la gente se da cuenta de la diferencia entre querer y poder.",
      "Adoptar un animal adulto es mucho más previsible que un cachorro. Ya sabes el tamaño, el carácter y el nivel de energía.",
      "Considera también el estado del piso y de los muebles. No es un drama, pero conviene decidirlo antes de comprar el sillón nuevo.",
      "El primer mes es de adaptación para los dos. Muchas devoluciones pasan en ese momento, justo antes de que se acomode.",
      "Si trabajas fuera todo el día, un animal muy dependiente va a sufrir. No todas las especies ni todos los caracteres funcionan igual.",
      "Pregunta en el refugio con honestidad cómo es tu rutina. La gente que trabaja ahí prefiere decirte que no antes que recibir una devolución."
    ],
    "s17"
  ],
  [
    "¿Qué costumbre chica te mejoró la semana más de lo que esperabas?",
    "Cosas mínimas, casi ridículas, que terminaron pesando bastante.",
    [
      "Dejar la mesada vacía antes de dormir. Levantarme y encontrar la cocina en orden me cambia el humor de toda la mañana.",
      "Preparar la ropa la noche anterior. Es una decisión menos en el peor momento del día.",
      "Sacar la basura siempre a la misma hora, sin pensar si hace falta. Las tareas que se evalúan cada vez son las que se posponen.",
      "Un vaso de agua apenas me levanto. No sé si tiene algún efecto real, pero me ordena el arranque.",
      "Caminar hasta la parada anterior. Diez minutos más por día que no siento como ejercicio.",
      "Cerrar todas las pestañas al terminar de trabajar. Al día siguiente empiezo por lo que decidí yo, no por lo que quedó abierto.",
      "Dejar el celular cargando fuera del cuarto. Lo empecé por el sueño y lo que más cambió fue la primera media hora del día.",
      "Anotar tres cosas para mañana antes de cerrar. Elimina el rato de arranque en que uno no sabe por dónde empezar.",
      "Lavar la taza en el momento. Suena mínimo y es lo que evita que se acumule todo lo demás.",
      "Tener un lugar fijo para llaves y billetera. Recuperé bastante tiempo que perdía buscando.",
      "Comprar el pan del día en vez de guardarlo. Cambia poco en costo y bastante en ganas de desayunar.",
      "Salir a la vereda un rato al mediodía, aunque no tenga nada que hacer afuera. Los días de invierno lo agradezco especialmente.",
      "Dejar de mirar el celular mientras camino. Empecé por seguridad y terminé llegando a todos lados menos cansado.",
      "Una revisión de diez minutos los domingos: qué viene, qué falta comprar, qué se puede sacar. Es lo que evita las urgencias del miércoles."
    ],
    "s20"
  ]
];
