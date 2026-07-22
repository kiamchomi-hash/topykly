import {
  CUSTOM_PALETTE_ID,
  DEFAULT_CUSTOM_PALETTE_HEX,
  DEFAULT_PALETTE_ID,
  isPaletteId,
  normalizeHexColor,
  parseHexColor
} from "../../palettes.js";

const PALETTE_ACTION_TYPES = {
  toggleTheme: "palette/toggleTheme",
  openModal: "palette/openModal",
  closeModal: "palette/closeModal",
  selectPalette: "palette/selectPalette",
  ensureCustomPalette: "palette/ensureCustomPalette",
  setCustomHex: "palette/setCustomHex"
};

export function toggleThemeAction() {
  return { type: PALETTE_ACTION_TYPES.toggleTheme };
}

export function openPaletteModalAction() {
  return { type: PALETTE_ACTION_TYPES.openModal };
}

export function closePaletteModalAction() {
  return { type: PALETTE_ACTION_TYPES.closeModal };
}

export function selectPaletteAction(paletteId) {
  return {
    type: PALETTE_ACTION_TYPES.selectPalette,
    payload: { paletteId }
  };
}

export function ensureCustomPaletteAction() {
  return { type: PALETTE_ACTION_TYPES.ensureCustomPalette };
}

export function setCustomPaletteHexAction(nextHexValue) {
  return {
    type: PALETTE_ACTION_TYPES.setCustomHex,
    payload: { nextHexValue }
  };
}

export function isPaletteStateAction(action) {
  return Object.values(PALETTE_ACTION_TYPES).includes(action?.type);
}

export function reducePaletteState(state, action) {
  switch (action.type) {
    case PALETTE_ACTION_TYPES.toggleTheme:
      return {
        changed: true,
        theme: state.theme === "light" ? "dark" : "light",
        nextState: { ...state, theme: state.theme === "light" ? "dark" : "light" }
      };

    case PALETTE_ACTION_TYPES.openModal:
      if (state.isPaletteModalOpen) {
        return { changed: false, reason: "already-open" };
      }
      return {
        changed: true,
        nextState: { ...state, isPaletteModalOpen: true }
      };

    case PALETTE_ACTION_TYPES.closeModal:
      if (!state.isPaletteModalOpen) {
        return { changed: false, reason: "already-closed" };
      }
      return {
        changed: true,
        nextState: { ...state, isPaletteModalOpen: false }
      };

    case PALETTE_ACTION_TYPES.selectPalette: {
      const paletteId = action.payload?.paletteId;
      if (!isPaletteId(paletteId)) {
        return { changed: false, reason: "invalid-palette" };
      }

      const nextPaletteId = paletteId || DEFAULT_PALETTE_ID;
      if (state.paletteId === nextPaletteId) {
        return { changed: false, reason: "same-palette" };
      }

      return {
        changed: true,
        paletteId: nextPaletteId,
        nextState: { ...state, paletteId: nextPaletteId }
      };
    }

    case PALETTE_ACTION_TYPES.ensureCustomPalette:
      if (state.paletteId === CUSTOM_PALETTE_ID) {
        return { changed: false, reason: "already-custom" };
      }

      return {
        changed: true,
        paletteId: CUSTOM_PALETTE_ID,
        nextState: { ...state, paletteId: CUSTOM_PALETTE_ID }
      };

    case PALETTE_ACTION_TYPES.setCustomHex: {
      const parsedHex = parseHexColor(action.payload?.nextHexValue);
      if (!parsedHex) {
        return { changed: false, reason: "invalid-hex" };
      }

      const nextCustomPaletteHex = normalizeHexColor(
        parsedHex,
        state.customPaletteHex || DEFAULT_CUSTOM_PALETTE_HEX
      );
      if (
        state.paletteId === CUSTOM_PALETTE_ID &&
        state.customPaletteHex === nextCustomPaletteHex
      ) {
        return { changed: false, reason: "same-hex" };
      }

      return {
        changed: true,
        paletteId: CUSTOM_PALETTE_ID,
        customPaletteHex: nextCustomPaletteHex,
        nextState: {
          ...state,
          paletteId: CUSTOM_PALETTE_ID,
          customPaletteHex: nextCustomPaletteHex
        }
      };
    }

    default:
      return { changed: false, reason: "unknown-action" };
  }
}
