export const DEFAULT_PALETTE_ID = "default";
export const CUSTOM_PALETTE_ID = "custom";
export const DEFAULT_CUSTOM_PALETTE_HEX = "#B25B33";

const CUSTOM_PALETTE_VAR_NAMES = [
  "--bg",
  "--bg-soft",
  "--surface",
  "--surface-strong",
  "--surface-muted",
  "--text",
  "--text-soft",
  "--line",
  "--line-strong",
  "--accent",
  "--accent-strong",
  "--accent-soft",
  "--ranking-badge-border"
];

export const PALETTE_OPTIONS = [
  {
    id: DEFAULT_PALETTE_ID,
    name: "Default",
    previews: {
      light: {
        bg: "#f5efe5",
        surface: "rgba(255, 251, 245, 0.96)",
        accent: "#b25b33",
        text: "#1f1a17"
      },
      dark: {
        bg: "#0e1116",
        surface: "#12161d",
        accent: "#8f5a45",
        text: "#f3efe8"
      }
    }
  },
  {
    id: "coast",
    name: "Turquesa",
    previews: {
      light: {
        bg: "#eaf2f3",
        surface: "rgba(197, 221, 226, 0.95)",
        accent: "#2d6f73",
        text: "#152428"
      },
      dark: {
        bg: "#0d1418",
        surface: "rgba(17, 27, 32, 0.96)",
        accent: "#4f8c91",
        text: "#edf4f5"
      }
    }
  },
  {
    id: "forest",
    name: "Bosque",
    previews: {
      light: {
        bg: "#edf1e8",
        surface: "rgba(207, 220, 198, 0.95)",
        accent: "#55733b",
        text: "#1c2416"
      },
      dark: {
        bg: "#11160f",
        surface: "rgba(23, 29, 20, 0.96)",
        accent: "#698c4f",
        text: "#eef3e9"
      }
    }
  },
  {
    id: "ember",
    name: "Terracota",
    previews: {
      light: {
        bg: "#f4ece8",
        surface: "rgba(221, 201, 193, 0.95)",
        accent: "#a44b45",
        text: "#251917"
      },
      dark: {
        bg: "#17100f",
        surface: "rgba(33, 23, 21, 0.96)",
        accent: "#8a4d45",
        text: "#f6eeeb"
      }
    }
  },
  {
    id: "cobalt",
    name: "Azul",
    previews: {
      light: {
        bg: "#eceff6",
        surface: "rgba(199, 210, 232, 0.95)",
        accent: "#4668a8",
        text: "#171d28"
      },
      dark: {
        bg: "#0f131a",
        surface: "rgba(22, 29, 40, 0.96)",
        accent: "#5d78b3",
        text: "#eef2fb"
      }
    }
  }
];

function clampChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hexToRgb(hexValue) {
  const normalized = normalizeHexColor(hexValue);
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16)
  };
}

function rgbToHex(rgb) {
  return `#${[rgb.r, rgb.g, rgb.b]
    .map((channel) => clampChannel(channel).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

function rgba(rgb, alpha) {
  return `rgba(${clampChannel(rgb.r)}, ${clampChannel(rgb.g)}, ${clampChannel(rgb.b)}, ${alpha})`;
}

function mixRgb(left, right, ratio) {
  return {
    r: left.r + (right.r - left.r) * ratio,
    g: left.g + (right.g - left.g) * ratio,
    b: left.b + (right.b - left.b) * ratio
  };
}

function buildLightPaletteVars(hexValue) {
  const accentBase = hexToRgb(hexValue);
  const accent = mixRgb(accentBase, hexToRgb("#FFFFFF"), 0.04);
  const accentStrong = mixRgb(accentBase, hexToRgb("#20110A"), 0.18);
  const bg = mixRgb(accentBase, hexToRgb("#FFFFFF"), 0.88);
  const bgSoft = mixRgb(accentBase, hexToRgb("#FFFFFF"), 0.8);
  const surface = mixRgb(accentBase, hexToRgb("#FFFFFF"), 0.8);
  const surfaceStrong = mixRgb(accentBase, hexToRgb("#FFFFFF"), 0.76);
  const surfaceMuted = mixRgb(accentBase, hexToRgb("#FFFFFF"), 0.72);
  const text = mixRgb(accentBase, hexToRgb("#101114"), 0.82);
  const textSoft = mixRgb(accentBase, hexToRgb("#23252C"), 0.6);
  const badgeBorder = rgbToHex(mixRgb(accentBase, hexToRgb("#FFFFFF"), 0.38));

  return {
    "--bg": rgbToHex(bg),
    "--bg-soft": rgbToHex(bgSoft),
    "--surface": rgba(surface, 0.86),
    "--surface-strong": rgba(surfaceStrong, 0.95),
    "--surface-muted": rgba(surfaceMuted, 0.72),
    "--text": rgbToHex(text),
    "--text-soft": rgbToHex(textSoft),
    "--line": rgba(text, 0.12),
    "--line-strong": rgba(text, 0.38),
    "--accent": rgbToHex(accent),
    "--accent-strong": rgbToHex(accentStrong),
    "--accent-soft": rgba(accent, 0.12),
    "--ranking-badge-border": `color-mix(in srgb, ${badgeBorder} 62%, var(--line))`
  };
}

function buildDarkPaletteVars(hexValue) {
  const accentBase = hexToRgb(hexValue);
  const accent = mixRgb(accentBase, hexToRgb("#FFFFFF"), 0.14);
  const accentStrong = mixRgb(accentBase, hexToRgb("#FFFFFF"), 0.32);
  const bg = mixRgb(hexToRgb("#0E1116"), accentBase, 0.14);
  const bgSoft = mixRgb(hexToRgb("#141922"), accentBase, 0.2);
  const surface = mixRgb(hexToRgb("#12161D"), accentBase, 0.16);
  const surfaceStrong = mixRgb(hexToRgb("#12161D"), accentBase, 0.2);
  const text = mixRgb(hexToRgb("#F3EFE8"), accentBase, 0.08);
  const textSoft = mixRgb(hexToRgb("#B4A99F"), accentBase, 0.16);
  const badgeBorder = rgbToHex(mixRgb(accentStrong, hexToRgb("#FFFFFF"), 0.18));

  return {
    "--bg": rgbToHex(bg),
    "--bg-soft": rgbToHex(bgSoft),
    "--surface": rgba(surface, 0.82),
    "--surface-strong": rgba(surfaceStrong, 0.96),
    "--surface-muted": "rgba(255, 255, 255, 0.05)",
    "--text": rgbToHex(text),
    "--text-soft": rgbToHex(textSoft),
    "--line": "rgba(255, 255, 255, 0.1)",
    "--line-strong": "rgba(255, 255, 255, 0.16)",
    "--accent": rgbToHex(accent),
    "--accent-strong": rgbToHex(accentStrong),
    "--accent-soft": rgba(accent, 0.12),
    "--ranking-badge-border": `color-mix(in srgb, ${badgeBorder} 62%, var(--line))`
  };
}

function buildPreviewFromVars(paletteVars) {
  return {
    bg: paletteVars["--bg"],
    surface: paletteVars["--surface-strong"],
    accent: paletteVars["--accent"],
    text: paletteVars["--text"]
  };
}

export function normalizeHexColor(value, fallback = DEFAULT_CUSTOM_PALETTE_HEX) {
  const parsed = parseHexColor(value);
  return parsed || fallback;
}

export function parseHexColor(value) {
  if (typeof value !== "string") {
    return null;
  }

  const raw = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    const expanded = raw
      .split("")
      .map((channel) => channel + channel)
      .join("");
    return `#${expanded.toUpperCase()}`;
  }

  if (!/^[0-9a-f]{6}$/i.test(raw)) {
    return null;
  }

  return `#${raw.toUpperCase()}`;
}

export function getCustomPaletteVars(hexValue, theme) {
  const normalized = normalizeHexColor(hexValue);
  return theme === "dark" ? buildDarkPaletteVars(normalized) : buildLightPaletteVars(normalized);
}

export function buildCustomPaletteOption(hexValue) {
  const normalized = normalizeHexColor(hexValue);
  const lightVars = buildLightPaletteVars(normalized);
  const darkVars = buildDarkPaletteVars(normalized);

  return {
    id: CUSTOM_PALETTE_ID,
    name: "Personalizada",
    hex: normalized,
    previews: {
      light: buildPreviewFromVars(lightVars),
      dark: buildPreviewFromVars(darkVars)
    }
  };
}

export function clearCustomPaletteVars(rootElement) {
  if (!rootElement?.style) {
    return;
  }

  for (const propertyName of CUSTOM_PALETTE_VAR_NAMES) {
    rootElement.style.removeProperty(propertyName);
  }
}

export function applyPaletteToDocument(rootElement, theme, paletteId, customHex = DEFAULT_CUSTOM_PALETTE_HEX) {
  if (!rootElement) {
    return;
  }

  rootElement.dataset.theme = theme;
  rootElement.dataset.palette = paletteId || DEFAULT_PALETTE_ID;
  clearCustomPaletteVars(rootElement);

  if ((paletteId || DEFAULT_PALETTE_ID) !== CUSTOM_PALETTE_ID) {
    return;
  }

  const paletteVars = getCustomPaletteVars(customHex, theme);
  for (const [propertyName, propertyValue] of Object.entries(paletteVars)) {
    rootElement.style.setProperty(propertyName, propertyValue);
  }
}

export function isPaletteId(value) {
  return value === CUSTOM_PALETTE_ID || PALETTE_OPTIONS.some((option) => option.id === value);
}
