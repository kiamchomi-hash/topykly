# Emotes de la tienda

Los emotes base (`emote-01.png` … `emote-16.png`) son de **Noto Emoji**
(Google, Apache 2.0 — ver `LICENSE.txt`), PNG cuadrados de 128×128 px con
fondo transparente. Cada archivo se referencia desde `store-catalog.js`
vía `assetUrl`.

Para agregar o reemplazar emotes propios:

- **WebP** (preferido) o PNG con fondo transparente; los animados en WebP animado.
- Cuadrado **128×128 px** (se muestran a ~24–64 px, así que 128 alcanza y escala nítido).
- Peso objetivo: **< 50 KB** por emote (animados < 200 KB).
- Nombre de archivo igual al `id` del catálogo: `emote-17.webp`, `emote-18.webp`, …
- Registrar el item en `store-catalog.js` (`id`, `name`, `assetUrl`, `price`).
