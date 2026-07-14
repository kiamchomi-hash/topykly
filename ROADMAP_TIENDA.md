# Roadmap de la tienda de TOPYKLY

## Recomendación principal

Continuar con una tienda MVP de productos cosméticos mediante compras únicas. No comenzar todavía con suscripciones, monedas virtuales ni un mercado entre usuarios.

La tienda debe sumar opciones de personalización sin quitar ni convertir en premium funciones que actualmente son gratuitas. Tampoco debe vender ventajas en rankings, moderación, alcance, visibilidad o límites de participación.

## Orden recomendado

1. Definir un catálogo inicial de entre 6 y 10 productos.
2. Implementar primero el modelo y los flujos del backend.
3. Integrar Mercado Pago Checkout Pro.
4. Construir la interfaz de la tienda y la sección "Mis artículos".
5. Probar todos los estados de compra y recuperación.
6. Completar la revisión legal y fiscal antes de comenzar a cobrar.

## Catálogo para el MVP

- Paquetes de dos o tres paletas nuevas.
- Marcos cosméticos para el avatar y el perfil público.
- Estilos adicionales de perfil con contraste y legibilidad validados.
- Una insignia opcional de apoyo, visible en el perfil y sin efecto sobre el ranking.

Todos los artículos iniciales deberían venderse mediante una compra única. La membresía mensual de apoyo puede evaluarse más adelante, cuando exista demanda comprobada y estén resueltos los flujos de cancelación y cobros fallidos.

## Backend necesario

- Catálogo de productos controlado por el servidor.
- Órdenes con estados `pending`, `approved`, `rejected`, `refunded` y `cancelled`.
- Registro de los derechos adquiridos por cada usuario.
- Creación de preferencias de pago únicamente desde el backend.
- Webhook con firma validada y consulta del pago al proveedor.
- Idempotencia por evento y pago para impedir entregas duplicadas.
- Activación del producto únicamente después de una confirmación entre servidores.
- Flujo administrativo para reembolsar, revocar y conciliar compras.
- Secretos almacenados solo en variables de entorno.
- Registros técnicos sin datos sensibles ni información de tarjetas.

## Frontend necesario

- Modal o vista de tienda conectada al botón existente.
- Catálogo con precio final, detalle y vista previa de cada artículo.
- Indicación clara de artículos adquiridos.
- Pantallas para pagos aprobados, pendientes, rechazados y cancelados.
- Sección "Mis artículos" para aplicar o quitar cosméticos.
- Historial básico de compras.
- Acceso visible a soporte, términos, reembolsos y arrepentimiento.

## Integración de pagos

Para la primera versión se recomienda Mercado Pago Checkout Pro. El comprador paga en el entorno de Mercado Pago y luego regresa a TOPYKLY. La redirección del navegador no debe considerarse una confirmación de compra: el backend debe validar la notificación y consultar el estado real del pago antes de entregar el artículo.

Referencias oficiales:

- [Mercado Pago Checkout Pro](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/overview)
- [Notificaciones y validación de webhooks](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/payment-notifications)
- [Configuración de URLs de retorno](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/configure-back-urls)

## Pruebas obligatorias antes del lanzamiento

- Compra aprobada.
- Compra rechazada.
- Pago pendiente que posteriormente se aprueba.
- Notificación webhook duplicada.
- Notificación con firma inválida.
- Redirección manipulada por el usuario.
- Reembolso y revocación del artículo.
- Eliminación de una cuenta con compras.
- Reintento después de un fallo de red.
- Conciliación entre las órdenes locales y los pagos del proveedor.

## Aspectos que deben posponerse

- Ventajas pagas en rankings o publicaciones.
- Loot boxes o artículos obtenidos al azar.
- Monedas virtuales y saldos internos.
- Regalos entre usuarios sin controles antifraude.
- Mercado de reventa entre usuarios.
- Publicidad conductual o venta de datos.
- Suscripciones antes de validar la intención de compra.

## Revisión legal y operativa

El inicio de cobros requiere una nueva revisión legal y fiscal. Antes del lanzamiento se deben actualizar los términos, la información de privacidad, la política de reembolsos, el mecanismo de arrepentimiento y los datos legalmente exigibles del proveedor.

Las tareas internas relacionadas están documentadas en [`LEGAL_OPERATIONS.md`](./LEGAL_OPERATIONS.md).

## Métricas mínimas

- Visitas a la tienda.
- Vistas de cada producto.
- Inicios de checkout.
- Pagos aprobados y rechazados.
- Ingreso neto después de comisiones y reembolsos.
- Tasa de reembolso.
- Uso real de los artículos comprados.

## Estado técnico al 14 de julio de 2026

La revisión local no detectó errores reproducibles:

- `npm test`: aprobado.
- `node tests/smoke.mjs`: 12 comprobaciones aprobadas.
- Validación de sintaxis de los archivos JavaScript modificados: aprobada.
- `git diff --check`: aprobado.

El siguiente paso concreto es diseñar el modelo de productos, órdenes y derechos adquiridos antes de implementar la interfaz de la tienda.
