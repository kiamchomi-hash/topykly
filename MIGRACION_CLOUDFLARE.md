# Evaluación de migración de Render a Cloudflare

Fecha de evaluación: 14 de julio de 2026.

## Conclusión

La migración es técnicamente viable y probablemente Cloudflare resulte más económico para una carga baja o moderada. Sin embargo, el proyecto no se puede trasladar directamente a Cloudflare Workers sin adaptar una parte importante del backend.

La migración tiene sentido principalmente por escalabilidad, distribución global, ausencia de cold starts y reducción futura de costos. Si actualmente se utiliza solamente una instancia Render Starter con un disco pequeño, el ahorro mensual inmediato probablemente no compense por sí solo el trabajo de migración.

## Arquitectura actual relevante

El proyecto actualmente depende de:

- Un servidor HTTP persistente de Node en `services/preview-server.js`.
- SQLite mediante `node:sqlite` y `DatabaseSync` en `services/backend-store.js`.
- Escritura de avatares en el filesystem local.
- Tareas periódicas ejecutadas mediante `setInterval`.
- Variables de entorno y secretos para sesiones, autenticación, Turnstile, OIDC y Resend.

## Equivalencias en Cloudflare

| Implementación actual en Render            | Equivalente propuesto en Cloudflare |
| ------------------------------------------ | ----------------------------------- |
| Servidor Node                              | Cloudflare Worker                   |
| HTML, CSS, JavaScript e imágenes estáticas | Workers Static Assets               |
| SQLite local                               | Cloudflare D1                       |
| Avatares guardados en disco                | Cloudflare R2                       |
| Tareas con `setInterval`                   | Cron Triggers                       |
| Variables de entorno                       | Workers Secrets y variables         |

No parece necesario introducir Durable Objects inicialmente. Se podrían evaluar más adelante si se incorporan conexiones en tiempo real, WebSockets o coordinación estricta entre solicitudes concurrentes.

## Cambios necesarios

### Base de datos

Cloudflare Workers no permite reutilizar la implementación actual basada en `node:sqlite`: ese módulo figura como un stub no funcional en el runtime de Workers.

Será necesario:

- Reemplazar `DatabaseSync` por el binding asíncrono de D1.
- Adaptar los métodos síncronos del store para que trabajen con promesas.
- Revisar transacciones, batches, consultas e índices.
- Convertir el archivo SQLite a un dump SQL compatible.
- Importar el esquema y los datos existentes en D1.
- Ejecutar pruebas de concurrencia y consistencia antes del cambio definitivo.

D1 es compatible con gran parte de la sintaxis de SQLite, por lo que debería ser posible conservar una porción importante del esquema y de las consultas SQL.

### Avatares y archivos persistentes

El filesystem de Workers solamente ofrece almacenamiento temporal por solicitud. No reemplaza el Persistent Disk de Render.

Los avatares deberían almacenarse en R2. La base D1 guardaría la clave o URL del objeto correspondiente.

### Servidor HTTP

Cloudflare ofrece compatibilidad con partes de `node:http`, por lo que podría reutilizarse parte del enrutamiento actual. Aun así, conviene evaluar si resulta más simple exponer las rutas mediante el handler `fetch()` de Workers.

El mayor bloqueo no es el servidor HTTP, sino la capa de persistencia síncrona y el uso del filesystem.

### Tareas periódicas

Los procesos actuales basados en `setInterval`, como limpieza de invitados y reinicio de reacciones, deberían convertirse en handlers `scheduled()` asociados a Cron Triggers.

## Costos orientativos

Los precios pueden cambiar; deben comprobarse nuevamente antes de iniciar la migración.

### Render

- Web Service Starter: aproximadamente USD 7 por mes.
- Persistent Disk: aproximadamente USD 0,25 por GB al mes.
- Plan Hobby: 5 GB de ancho de banda incluidos y luego aproximadamente USD 0,15 por GB.
- Una configuración Starter con 1 GB de disco cuesta aproximadamente USD 7,25 por mes, sin contar excedentes.

### Cloudflare

Workers Paid tiene un mínimo aproximado de USD 5 por mes por cuenta e incluye:

- 10 millones de solicitudes dinámicas mensuales.
- 30 millones de milisegundos de CPU mensuales.
- Solicitudes a assets estáticos gratuitas e ilimitadas.
- Una cantidad amplia de lecturas, escrituras y almacenamiento D1 incluidos.

R2 incluye un nivel gratuito de almacenamiento y operaciones, sin cargos de egreso directo a Internet. Para una aplicación pequeña, los avatares probablemente entren inicialmente en ese nivel gratuito.

También podría probarse Workers Free, pero sus límites diarios y el límite de CPU por invocación son más estrictos. Para producción, Workers Paid ofrece un margen más seguro.

### Lectura económica

Si Render cuesta aproximadamente USD 7,25 mensuales y Cloudflare Paid queda en USD 5, el ahorro sería de unos USD 2,25 por mes o USD 27 al año.

Ese ahorro aislado no justifica una reescritura importante. La migración se vuelve más atractiva si:

- Se está pagando Render Standard o instancias superiores.
- Existen cargos relevantes de transferencia.
- Se necesitan varios servicios.
- Está creciendo el tráfico internacional.
- Se busca eliminar cold starts o mejorar la distribución geográfica.

Si actualmente se utiliza Render Free, Cloudflare no será más barato en términos absolutos, aunque podría ofrecer otras ventajas de rendimiento y arquitectura.

## Estrategia recomendada

No realizar una migración completa de una sola vez.

1. Configurar Cloudflare como DNS, proxy y CDN delante de Render.
2. Mover el frontend y los assets estáticos a Workers Static Assets.
3. Mantener temporalmente `/api/*`, SQLite y los avatares en Render.
4. Diseñar una interfaz de persistencia que permita usar el store actual y D1 durante la transición.
5. Portar las tablas y operaciones de base de datos a D1 por grupos funcionales.
6. Mover los avatares a R2.
7. Reemplazar los intervalos por Cron Triggers.
8. Ejecutar pruebas unitarias, smoke tests y pruebas de concurrencia contra el entorno Cloudflare.
9. Preparar un procedimiento de exportación, importación y rollback.
10. Ejecutar ambos backends en paralelo durante una ventana controlada.
11. Cambiar el tráfico a Cloudflare y mantener Render disponible para rollback.
12. Retirar Render únicamente después de verificar datos, autenticación, moderación y tareas programadas.

## Información que se debe recopilar antes de decidir

- Factura mensual actual de Render.
- Tipo de instancia contratada.
- Tamaño del Persistent Disk y del archivo SQLite.
- Transferencia mensual saliente.
- Cantidad de solicitudes diarias y mensuales.
- Picos de solicitudes concurrentes.
- Cantidad diaria de lecturas y escrituras de base de datos.
- Tamaño y cantidad de avatares.
- Tiempo medio y máximo de respuesta de la API.
- Frecuencia y duración de las tareas periódicas.

Con esos datos se podrá preparar una comparación de costos más precisa y decidir si conviene una migración total o una arquitectura híbrida.

## Documentación de referencia

- [Precios de Render](https://render.com/pricing)
- [Persistent Disks de Render](https://render.com/docs/disks)
- [Precios de Cloudflare Workers](https://developers.cloudflare.com/workers/platform/pricing/)
- [Compatibilidad con Node.js en Workers](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)
- [Filesystem de Workers](https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/)
- [Precios de Cloudflare D1](https://developers.cloudflare.com/d1/platform/pricing/)
- [Límites de Cloudflare D1](https://developers.cloudflare.com/d1/platform/limits/)
- [Importación y exportación de D1](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [Precios de Cloudflare R2](https://developers.cloudflare.com/r2/pricing/)
- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
