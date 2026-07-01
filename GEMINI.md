# Proyecto TOPYKLY - Arquitectura Frontend

## Descripción General
TOPYKLY utiliza una arquitectura modular basada en **características (Features)**, **servicios** y una **gestión de estado centralizada e inmutable**, inspirada en estándares de industria como Mastodon y Zulip.

## Pilares de la Arquitectura

### 1. Gestión de Estado (The Store)
- **Localización**: `features/shared/store.js` y `app-store.js`.
- **Patrón**: Implementación simplificada de Redux/Flux.
- **Normalización**: Los datos se almacenan en objetos `byId` y arrays `allIds` para maximizar la eficiencia de búsqueda ($O(1)$) y facilitar el re-ordenamiento dinámico (ranking).
- **Inmutabilidad**: Los Reducers devuelven un nuevo objeto de estado (`nextState`), asegurando actualizaciones predecibles y sin efectos secundarios.

### 2. Flujo de Datos
- **Action -> Reducer -> Store -> Renderer**.
- La UI se suscribe al Store (`store.subscribe`) y se re-renderiza automáticamente ante cualquier cambio de estado.

### 3. Smart Rendering (DOM Diffing)
- **Utilidad**: `ui/render-utils.js`.
- En lugar de limpiar el DOM con `innerHTML = ""`, el sistema compara los IDs de los elementos actuales con los nuevos y solo modifica, añade o elimina los nodos necesarios. Esto mejora el rendimiento y evita parpadeos visuales.

### 4. Capa de Servicios (API & Services)
- **API Service**: `services/api.js`. Encapsula todas las llamadas de datos. Actualmente simula carga, pero está preparado para integración directa con backend.
- **Servicios de UI**: `services/drawer-service.js`, `services/palette-service.js`. Separan la lógica de manipulación del DOM global de los controladores.

### 5. Reglas de Negocio Implementadas
- **Ranking Activo**: Al comentar, un post sube automáticamente al primer puesto.
- **Ventana de Visibilidad**: Solo los primeros 20 (o 40) posts son visibles.
- **Buffer de Mensajes**: Solo se guardan los últimos 30 comentarios por post, protegiendo siempre el mensaje original (índice 0).

## Estructura de Carpetas
- `features/`: Lógica de negocio segmentada por funcionalidad (chat, rankings, topics, users).
- `services/`: Capas de abstracción para API y utilidades globales.
- `ui/`: Componentes base y utilidades de renderizado.
- `controller-*.js`: Orquestación de eventos y bootstrap del sistema.
