import { buildCustomPaletteOption, CUSTOM_PALETTE_ID, PALETTE_OPTIONS } from "../palettes.js";

function syncCustomPalettePicker(state, dom, option) {
  const Coloris = globalThis.Coloris;
  if (typeof Coloris !== "function" || !state.isPaletteModalOpen || !dom.paletteModal) {
    return;
  }

  const pickerInput = dom.paletteOptionGrid?.querySelector("[data-custom-palette-picker]");
  if (!(pickerInput instanceof HTMLInputElement)) {
    return;
  }

  const pickerParent = dom.paletteModal.querySelector(".palette-modal__body") || dom.paletteModal;
  const themeMode = state.theme === "dark" ? "dark" : "light";
  const pickerConfigSignature = `theme:${themeMode}`;
  const activePicker = typeof document !== "undefined" ? document.querySelector(".clr-picker.clr-open") : null;

  if (typeof document !== "undefined" && document.documentElement.dataset.customPickerOpen !== "true") {
    document.documentElement.dataset.customPickerOpen = "false";
  }

  if (activePicker || pickerInput.dataset.colorisSignature === pickerConfigSignature) {
    return;
  }

  pickerInput.dataset.colorisSignature = pickerConfigSignature;

  Coloris({
    el: pickerInput,
    parent: pickerParent,
    wrap: false,
    theme: "pill",
    themeMode,
    margin: 10,
    format: "hex",
    formatToggle: false,
    alpha: false,
    focusInput: true,
    selectInput: true,
    closeButton: true,
    closeLabel: "Aceptar"
  });
}

function getPaletteGridSignature(state, option) {
  return [
    state.theme,
    state.paletteId,
    option.hex,
    state.isPaletteModalOpen ? "open" : "closed"
  ].join("|");
}

function isCustomPaletteEditing() {
  if (typeof document === "undefined") {
    return false;
  }

  if (document.documentElement?.dataset?.customPickerOpen === "true") {
    return true;
  }

  const activeElement = document.activeElement;
  if (typeof Element === "undefined" || !(activeElement instanceof Element)) {
    return false;
  }

  return Boolean(
    activeElement.closest("[data-custom-palette-hex]") ||
      activeElement.closest("[data-custom-palette-picker]") ||
      activeElement.closest(".clr-picker")
  );
}

function createPreviewMarkup(mode, preview, { inlineStyles = true } = {}) {
  const styleAttribute = inlineStyles
    ? `
      style="
        --palette-preview-bg: ${preview.bg};
        --palette-preview-surface: ${preview.surface};
        --palette-preview-accent: ${preview.accent};
        --palette-preview-text: ${preview.text};
      "`
    : "";

  return `
    <span
      class="palette-option__mode"
      data-mode="${mode}"${styleAttribute}
    >
      <span class="palette-option__mode-label">${mode === "light" ? "Light" : "Dark"}</span>
      <span class="palette-option__sample" aria-hidden="true">
        <span class="palette-option__sample-surface">
          <span class="palette-option__sample-header">
            <span class="palette-option__sample-brand"></span>
            <span class="palette-option__sample-toggle"></span>
          </span>
          <span class="palette-option__sample-layout">
            <span class="palette-option__sample-panel palette-option__sample-panel--topics">
              <span class="palette-option__sample-chip"></span>
              <span class="palette-option__sample-line"></span>
              <span class="palette-option__sample-line palette-option__sample-line--short"></span>
            </span>
            <span class="palette-option__sample-panel palette-option__sample-panel--chat">
              <span class="palette-option__sample-bubble"></span>
              <span class="palette-option__sample-bubble palette-option__sample-bubble--accent"></span>
            </span>
            <span class="palette-option__sample-panel palette-option__sample-panel--rankings">
              <span class="palette-option__sample-rank"></span>
              <span class="palette-option__sample-rank palette-option__sample-rank--active"></span>
            </span>
          </span>
        </span>
      </span>
    </span>
  `;
}

function createPaletteOptionMarkup(option, active) {
  return `
    <button
      class="palette-option${active ? " is-active" : ""}"
      type="button"
      data-palette-option="${option.id}"
      aria-pressed="${active}"
      aria-label="${active ? `Paleta activa: ${option.name}` : `Usar paleta ${option.name}`}"
    >
      <span class="palette-option__header">
        <span class="palette-option__title-group">
          <span class="palette-option__name">${option.name}</span>
        </span>
        <span class="palette-option__status">${active ? "Actual" : "Aplicar"}</span>
      </span>
      <span class="palette-option__modes">
        ${createPreviewMarkup("light", option.previews.light)}
        ${createPreviewMarkup("dark", option.previews.dark)}
      </span>
    </button>
  `;
}

function createCustomPaletteMarkup(option, active) {
  return `
    <section
      class="palette-option palette-option--custom${active ? " is-active" : ""}"
      aria-label="Paleta personalizada"
      data-custom-palette-card
    >
      <div class="palette-option__header">
        <span class="palette-option__title-group">
          <span class="palette-option__name">${option.name}</span>
        </span>
        <button
          class="palette-option__status palette-option__status--button"
          type="button"
          data-palette-option="${CUSTOM_PALETTE_ID}"
          aria-pressed="${active}"
          aria-label="${active ? "Paleta personalizada activa" : "Aplicar paleta personalizada"}"
        >
          ${active ? "Actual" : "Aplicar"}
        </button>
      </div>
      <div class="palette-option__controls">
        <button
          class="palette-option__color-preview"
          type="button"
          aria-label="Abrir selector hexadecimal"
          data-open-custom-palette-picker
        >
          <span class="palette-option__color-swatch"></span>
          <input
            class="palette-option__color-picker-input"
            type="text"
            value="${option.hex}"
            spellcheck="false"
            tabindex="-1"
            aria-hidden="true"
            data-custom-palette-picker
          />
        </button>
        <label class="palette-option__hex-field">
          <span class="sr-only">Color hexadecimal personalizado</span>
          <span class="palette-option__hex-label" aria-hidden="true">HEX</span>
          <input
            class="palette-option__hex-input"
            type="text"
            value="${option.hex}"
            maxlength="7"
            inputmode="text"
            spellcheck="false"
            autocapitalize="characters"
            data-last-valid="${option.hex}"
            data-custom-palette-hex
          />
        </label>
      </div>
      <span class="palette-option__modes">
        ${createPreviewMarkup("light", option.previews.light, { inlineStyles: false })}
        ${createPreviewMarkup("dark", option.previews.dark, { inlineStyles: false })}
      </span>
    </section>
  `;
}

function createRandomPaletteMarkup() {
  return `
    <button
      class="palette-option palette-option--action"
      type="button"
      data-randomize-custom-palette
      aria-label="Generar paleta personalizada al azar"
    >
      <span class="palette-option__action-mark">Al azar</span>
    </button>
  `;
}

export function renderPaletteModal(state, dom) {
  if (dom.paletteModalBackdrop) {
    dom.paletteModalBackdrop.hidden = !state.isPaletteModalOpen;
  }

  if (dom.paletteModal) {
    dom.paletteModal.setAttribute("aria-hidden", String(!state.isPaletteModalOpen));
  }

  if (dom.paletteButton) {
    dom.paletteButton.setAttribute("aria-expanded", String(state.isPaletteModalOpen));
  }

  if (!dom.paletteOptionGrid) {
    return;
  }

  const [defaultOption, ...remainingOptions] = PALETTE_OPTIONS;
  const customOption = buildCustomPaletteOption(state.customPaletteHex);
  const defaultMarkup = createPaletteOptionMarkup(defaultOption, defaultOption.id === state.paletteId);
  const customMarkup = createCustomPaletteMarkup(customOption, state.paletteId === CUSTOM_PALETTE_ID);
  const randomMarkup = createRandomPaletteMarkup();
  const remainingMarkup = remainingOptions
    .map((option) => createPaletteOptionMarkup(option, option.id === state.paletteId))
    .join("");
  const gridDataset = dom.paletteOptionGrid.dataset || (dom.paletteOptionGrid.dataset = {});
  const nextSignature = getPaletteGridSignature(state, customOption);

  if (gridDataset.paletteRenderSignature === nextSignature) {
    syncCustomPalettePicker(state, dom, customOption);
    return;
  }

  if (isCustomPaletteEditing()) {
    gridDataset.paletteRenderPendingSignature = nextSignature;
    syncCustomPalettePicker(state, dom, customOption);
    return;
  }

  dom.paletteOptionGrid.innerHTML = `
    <div class="palette-grid__featured">
      ${customMarkup}
      ${randomMarkup}
    </div>
    ${defaultMarkup}
    ${remainingMarkup}
  `;
  gridDataset.paletteRenderSignature = nextSignature;
  delete gridDataset.paletteRenderPendingSignature;

  syncCustomPalettePicker(state, dom, customOption);
}
