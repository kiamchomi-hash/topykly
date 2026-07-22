import {
  applyPaletteToDocument,
  DEFAULT_CUSTOM_PALETTE_HEX,
  DEFAULT_PALETTE_ID,
  isPaletteId,
  normalizeHexColor,
  updateDocumentFavicon
} from "./palettes.js";

const DEFAULT_THEME = "dark";
const STORAGE_KEYS = {
  theme: "topykly-theme",
  palette: "topykly-palette",
  customPalette: "topykly-custom-palette-hex"
};
const LEGACY_STORAGE_KEYS = {
  theme: "chetrend-theme",
  palette: "chetrend-palette",
  customPalette: "chetrend-custom-palette-hex"
};
export function applyStoredTheme(state) {
  const hasStorage = typeof localStorage !== "undefined";
  const hasDocument = typeof document !== "undefined";
  let rootTheme = null;
  let rootPalette = null;
  let rootCustomPalette = null;

  if (hasStorage) {
    rootTheme =
      localStorage.getItem(STORAGE_KEYS.theme) || localStorage.getItem(LEGACY_STORAGE_KEYS.theme);
    rootPalette =
      localStorage.getItem(STORAGE_KEYS.palette) ||
      localStorage.getItem(LEGACY_STORAGE_KEYS.palette);
    rootCustomPalette =
      localStorage.getItem(STORAGE_KEYS.customPalette) ||
      localStorage.getItem(LEGACY_STORAGE_KEYS.customPalette);
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
