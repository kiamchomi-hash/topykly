# Operación legal mínima de TOPYKLY

Este documento es una guía operativa interna. No se sirve públicamente y no reemplaza asesoramiento jurídico profesional.

## Bloqueo previo al despliegue

1. Incorporar en la sección "Operación y contacto" de `privacy.html` los datos legalmente exigibles del responsable cuando el titular decida regularizar esta información:
   - nombre y apellido o razón social del titular;
   - CUIT, cuando corresponda;
   - domicilio legal completo en el que puedan recibirse notificaciones.
   - La versión pública actual omite estos datos por decisión del titular; el correo de soporte no sustituye la identificación y el domicilio del responsable.
2. Mantener operativo `soporte@topykly.com`.
   - Estado al 14 de julio de 2026: Cloudflare Email Routing habilitado, destino privado verificado y regla activa para `soporte@topykly.com`.
   - Los registros MX de Cloudflare y el SPF correspondiente están publicados en DNS.
   - Se verificó el circuito con un mensaje externo enviado mediante Resend: Cloudflare lo reenvió y el mensaje llegó a la bandeja privada.
   - La dirección privada no se muestra al público por recibir mensajes reenviados.
   - Pendiente: configurar un remitente de salida con el dominio antes de responder; una respuesta directa desde la casilla privada revelaría esa dirección.
3. Guardar una copia inalterable de cada versión publicada de `terms.html` y `privacy.html`.
4. Desplegar juntos el frontend y el backend. La versión legal `2026-07-14` debe coincidir en ambos.

## Obligaciones externas prioritarias

- Inscribir al titular como responsable y consultar/registrar las bases correspondientes ante el Registro Nacional de Bases de Datos Personales de la AAIP: <https://www.argentina.gob.ar/aaip/datospersonales/tramites>.
- Inventariar país, función y contrato de cada proveedor: alojamiento/base de datos, copias de seguridad, Resend, Google y Cloudflare.
- Para destinos no adecuados, verificar con un profesional o con la AAIP si el DPA del proveedor incorpora un mecanismo válido o si hacen falta las cláusulas contractuales modelo: <https://www.argentina.gob.ar/transferencias-internacionales>.
- Conservar comprobantes de inscripción, contratos/DPA, inventario de datos, versiones legales y medidas de seguridad en una carpeta privada.

## Solicitudes de datos personales

Usar una planilla privada con: número, fecha de recepción, solicitante, derecho, verificación de identidad, responsable interno, vencimiento, acción y fecha de respuesta. No guardar documentos de identidad más tiempo del necesario para verificar la solicitud.

- Acceso o información: responder dentro de 10 días corridos.
- Rectificación, actualización, bloqueo o supresión: completar dentro de 5 días hábiles.
- Si no puede suprimirse algo, explicar por escrito la razón legal o técnica y bloquearlo mientras se revisa cuando corresponda.
- Guardar prueba de recepción y respuesta.

Fuente: <https://www.argentina.gob.ar/aaip/datospersonales/derechos>.

## Denuncias de contenido

1. Registrar fecha, denunciante, URL o identificador, categoría, explicación y pruebas.
2. Priorizar amenazas creíbles, explotación sexual, datos personales, material íntimo, fraude y órdenes de autoridad.
3. Preservar solo la evidencia necesaria antes de retirar contenido; limitar su acceso.
4. Documentar la decisión, la regla aplicada y quién la tomó.
5. Ofrecer revisión por `soporte@topykly.com` y controlar abusos del sistema de denuncias.
6. Ante peligro inmediato, preservar evidencia y escalar a las autoridades competentes; no investigar por cuenta propia.

## Incidentes de seguridad

1. Contener el acceso, rotar secretos y preservar registros técnicos.
2. Determinar datos, personas, período y proveedores afectados.
3. Documentar decisiones y medidas correctivas.
4. Consultar de inmediato las obligaciones vigentes de notificación a titulares, AAIP y otras autoridades antes de comunicar públicamente.
5. Nunca incluir contraseñas, tokens, emails completos o IP en repositorios, capturas públicas o tickets abiertos.

## Cambios que exigen una nueva revisión legal

- aceptar personas menores de 16 años o cambiar las protecciones iniciales de las cuentas de 16 y 17 años;
- cobrar, vender membresías, recibir donaciones con beneficios o entregar premios;
- incorporar publicidad, analítica, seguimiento o newsletters;
- usar contenido o datos para entrenar modelos de IA;
- vender o compartir datos, cambiar de proveedor o país de alojamiento;
- habilitar mensajes privados, contenido sexual, apuestas, sorteos o mercados entre usuarios;
- cambiar de titular, domicilio, país o finalidad del tratamiento.

## Rutina mensual de bajo costo

- probar eliminación de cuenta y recuperación de contraseña;
- comprobar que la purga de sesiones y desafíos vencidos aparece en logs sin datos sensibles;
- revisar reportes abiertos, administradores y accesos a producción;
- probar restauración de una copia de seguridad en un entorno aislado;
- revisar cambios de proveedores, incidentes y solicitudes legales pendientes;
- verificar que los enlaces legales, email de soporte y versión aceptada funcionen.
