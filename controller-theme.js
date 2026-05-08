import {
  applyPaletteToDocument,
  DEFAULT_CUSTOM_PALETTE_HEX,
  DEFAULT_PALETTE_ID,
  isPaletteId,
  normalizeHexColor,
  updateDocumentFavicon
} from "./palettes.js";

const DEFAULT_THEME = "dark";

export function applyStoredTheme(state) {
  const hasStorage = typeof localStorage !== "undefined";
  const hasDocument = typeof document !== "undefined";
  let rootTheme = null;
  let rootPalette = null;
  let rootCustomPalette = null;

  if (hasStorage) {
    rootTheme = localStorage.getItem("chetrend-theme");
    rootPalette = localStorage.getItem("chetrend-palette");
    rootCustomPalette = localStorage.getItem("chetrend-custom-palette-hex");
  }

  state.theme = rootTheme === "dark" || rootTheme === "light" ? rootTheme : DEFAULT_THEME;
  state.paletteId = isPaletteId(rootPalette) ? rootPalette : DEFAULT_PALETTE_ID;
  state.customPaletteHex = normalizeHexColor(rootCustomPalette, DEFAULT_CUSTOM_PALETTE_HEX);

  if (hasDocument) {
    applyPaletteToDocument(
      document.documentElement,
      state.theme,
      state.paletteId || DEFAULT_PALETTE_ID,
      state.customPaletteHex
    );
    updateDocumentFavicon(
      document,
      state.theme,
      state.paletteId || DEFAULT_PALETTE_ID,
      state.customPaletteHex
    );
  }
}
