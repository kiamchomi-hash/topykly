# Task

Implementacion del frontend de chat social tipo Cafe/IRC.

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
- Estado local sin tiempo real.
- Boton manual de `Actualizar` con SVG.
- 20 temas visibles por defecto.
- Cada tema conserva solo los ultimos 30 mensajes.
- Ranking unico por tema.
- Variante de marca neutral para convivir con `Chetrend` como segunda pagina.

## Notas

- Implementado como frontend autocontenido en HTML, CSS y JS puros.
- No se adiciono backend ni sincronizacion en tiempo real.

## Pendientes

- Panel de admin.
- Espacio reservado para publicidad.
- Boton de reporte.
