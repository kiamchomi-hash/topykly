// Catálogo de la tienda. Los emotes usan assets de Noto Emoji (Google,
// Apache 2.0 — ver assets/emotes/LICENSE.txt), PNG 128x128 con fondo
// transparente. Los accesorios siguen como placeholders: para activar uno,
// colocar el archivo en assets/store/ y completar assetUrl (WebP cuadrado
// 128x128 transparente, animados en WebP animado, < 50 KB por archivo).

function createEmote(index, name, price) {
  const id = `emote-${String(index).padStart(2, "0")}`;
  return {
    id,
    name,
    assetUrl: `assets/emotes/${id}.png`,
    price
  };
}

function createAccessoryPlaceholder(categoryId, index, name) {
  return {
    id: `${categoryId}-${String(index).padStart(2, "0")}`,
    name,
    assetUrl: null,
    price: null
  };
}

export const STORE_CATEGORIES = [
  {
    id: "emotes",
    label: "Emotes",
    description: "Emotes para usar en tus mensajes.",
    layout: "emotes",
    items: [
      createEmote(1, "Risa", 150),
      createEmote(2, "Corazón", 100),
      createEmote(3, "Fuego", 150),
      createEmote(4, "Pulgar arriba", 100),
      createEmote(5, "Cool", 150),
      createEmote(6, "Fiesta", 200),
      createEmote(7, "Llanto", 150),
      createEmote(8, "Calavera", 200),
      createEmote(9, "Ojos", 150),
      createEmote(10, "Brillos", 200),
      createEmote(11, "Pensando", 150),
      createEmote(12, "Enojado", 150),
      createEmote(13, "Tierno", 200),
      createEmote(14, "Corona", 400),
      createEmote(15, "Cien", 200),
      createEmote(16, "Cohete", 300)
    ]
  },
  {
    id: "marcos",
    label: "Marcos",
    description: "Marcos decorativos para tu avatar.",
    layout: "accessories",
    items: [
      createAccessoryPlaceholder("marcos", 1, "Marco clásico"),
      createAccessoryPlaceholder("marcos", 2, "Marco neón"),
      createAccessoryPlaceholder("marcos", 3, "Marco dorado"),
      createAccessoryPlaceholder("marcos", 4, "Marco pixel")
    ]
  },
  {
    id: "insignias",
    label: "Insignias",
    description: "Insignias que se muestran junto a tu nombre.",
    layout: "accessories",
    items: [
      createAccessoryPlaceholder("insignias", 1, "Insignia fundador"),
      createAccessoryPlaceholder("insignias", 2, "Insignia estrella"),
      createAccessoryPlaceholder("insignias", 3, "Insignia rayo"),
      createAccessoryPlaceholder("insignias", 4, "Insignia corona")
    ]
  },
  {
    id: "burbujas",
    label: "Burbujas",
    description: "Estilos de burbuja para tus mensajes en el chat.",
    layout: "accessories",
    items: [
      createAccessoryPlaceholder("burbujas", 1, "Burbuja degradé"),
      createAccessoryPlaceholder("burbujas", 2, "Burbuja retro"),
      createAccessoryPlaceholder("burbujas", 3, "Burbuja mínima")
    ]
  }
];

export const DEFAULT_STORE_CATEGORY_ID = STORE_CATEGORIES[0].id;

export function isStoreCategoryId(categoryId) {
  return STORE_CATEGORIES.some((category) => category.id === categoryId);
}

export function getStoreCategory(categoryId) {
  return STORE_CATEGORIES.find((category) => category.id === categoryId) ?? STORE_CATEGORIES[0];
}
