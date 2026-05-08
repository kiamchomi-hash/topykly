import { 
  applyPaletteToDocument, 
  DEFAULT_CUSTOM_PALETTE_HEX, 
  DEFAULT_PALETTE_ID, 
  CUSTOM_PALETTE_ID,
  updateDocumentFavicon
} from "../palettes.js";

export class PaletteService {
  constructor(state, dom) {
    this.state = state;
    this.dom = dom;
  }

  apply() {
    if (typeof document === "undefined") {
      return;
    }

    applyPaletteToDocument(
      document.documentElement,
      this.state.theme,
      this.state.paletteId || DEFAULT_PALETTE_ID,
      this.state.customPaletteHex || DEFAULT_CUSTOM_PALETTE_HEX
    );

    this.updateFavicon();
  }

  updateFavicon() {
    updateDocumentFavicon(
      document,
      this.state.theme,
      this.state.paletteId || DEFAULT_PALETTE_ID,
      this.state.customPaletteHex || DEFAULT_CUSTOM_PALETTE_HEX
    );
  }

  persist() {
    if (typeof localStorage === "undefined") {
      return;
    }

    localStorage.setItem("chetrend-theme", this.state.theme);
    localStorage.setItem("chetrend-palette", this.state.paletteId);
    if (this.state.paletteId === CUSTOM_PALETTE_ID) {
      localStorage.setItem("chetrend-custom-palette-hex", this.state.customPaletteHex || DEFAULT_CUSTOM_PALETTE_HEX);
    }
  }

  syncControls(hexValue) {
    const normalized = hexValue.toUpperCase();

    this.dom.paletteOptionGrid
      ?.querySelectorAll("[data-custom-palette-hex]")
      ?.forEach((input) => {
        input.value = normalized;
        input.defaultValue = normalized;
        input.dataset.lastValid = normalized;
      });

    this.dom.paletteOptionGrid
      ?.querySelectorAll("[data-custom-palette-picker]")
      ?.forEach((input) => {
        input.value = normalized;
      });

    this.dom.paletteOptionGrid
      ?.querySelectorAll(".palette-option__color-preview")
      ?.forEach((preview) => {
        preview.style.setProperty("--palette-custom-preview", normalized);
      });
  }
}
