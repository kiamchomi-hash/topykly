import { CUSTOM_PALETTE_ID } from "../palettes.js";

export function createPalettePickerController(dom, handlers, scheduleOpen) {
  let pickerReopenLockUntil = 0;
  let pickerTriggerUnlockTimer = 0;
  let pickerPointerStartedInside = false;

  function lockPickerReopen() {
    pickerReopenLockUntil = Date.now() + 220;

    const pickerTrigger = dom.paletteOptionGrid?.querySelector("[data-open-custom-palette-picker]");
    const pickerInput = dom.paletteOptionGrid?.querySelector("[data-custom-palette-picker]");
    if (pickerTrigger instanceof HTMLElement) {
      pickerTrigger.dataset.pickerReopenLocked = "true";
    }

    if (pickerInput instanceof HTMLInputElement) {
      pickerInput.disabled = true;
    }

    globalThis.clearTimeout?.(pickerTriggerUnlockTimer);
    pickerTriggerUnlockTimer = globalThis.setTimeout?.(() => {
      if (pickerTrigger instanceof HTMLElement) {
        delete pickerTrigger.dataset.pickerReopenLocked;
      }
      if (pickerInput instanceof HTMLInputElement) {
        pickerInput.disabled = false;
      }
      pickerTriggerUnlockTimer = 0;
    }, 240) ?? 0;
  }

  function isPickerReopenLocked() {
    return Date.now() < pickerReopenLockUntil;
  }

  function sanitizeHexDraft(value) {
    const digits = String(value || "")
      .replace(/[^0-9a-f]/gi, "")
      .slice(0, 6)
      .toUpperCase();

    return digits ? `#${digits}` : "#";
  }

  function syncCustomPickerDraft(nextValue, { commit = false } = {}) {
    const normalized = sanitizeHexDraft(nextValue);
    const hexInput = dom.paletteOptionGrid?.querySelector("[data-custom-palette-hex]");
    const pickerInput = dom.paletteOptionGrid?.querySelector("[data-custom-palette-picker]");
    const preview = dom.paletteOptionGrid?.querySelector(".palette-option__color-preview");

    if (hexInput instanceof HTMLInputElement) {
      hexInput.value = normalized;
      if (commit) {
        hexInput.defaultValue = normalized;
        hexInput.dataset.lastValid = normalized;
      }
    }

    if (pickerInput instanceof HTMLInputElement) {
      pickerInput.value = normalized;
      if (commit) {
        pickerInput.dataset.committedHex = normalized;
      }
    }

    if (preview instanceof HTMLElement) {
      preview.style.setProperty("--palette-custom-preview", normalized);
    }

    return normalized;
  }

  function setPickerOpenState(isOpen) {
    if (typeof document === "undefined") {
      return;
    }

    document.documentElement.dataset.customPickerOpen = String(isOpen);
  }

  function applyPickerClose(commit) {
    setPickerOpenState(false);

    const pickerInput = dom.paletteOptionGrid?.querySelector("[data-custom-palette-picker]");
    if (!(pickerInput instanceof HTMLInputElement)) {
      return;
    }

    const committedHex = sanitizeHexDraft(pickerInput.dataset.committedHex || pickerInput.defaultValue || pickerInput.value);
    const livePickerField = document.querySelector("#clr-color-value");
    const draftHex = sanitizeHexDraft(
      livePickerField instanceof HTMLInputElement && livePickerField.value
        ? livePickerField.value
        : pickerInput.value
    );

    pickerInput.blur();

    if (commit && draftHex.length === 7) {
      const applied = handlers.updateCustomPaletteHex(draftHex, { render: false, focus: false });
      if (applied) {
        syncCustomPickerDraft(draftHex, { commit: true });
      } else {
        syncCustomPickerDraft(committedHex, { commit: true });
      }
    } else {
      syncCustomPickerDraft(committedHex);
    }
  }

  function requestPickerClose(commit) {
    const pickerInput = dom.paletteOptionGrid?.querySelector("[data-custom-palette-picker]");
    if (pickerInput instanceof HTMLInputElement) {
      pickerInput.dataset.pendingCommit = commit ? "true" : "false";
    }

    const Coloris = globalThis.Coloris;
    if (typeof Coloris?.close === "function") {
      Coloris.close();
      if (!(pickerInput instanceof HTMLInputElement)) {
        setPickerOpenState(false);
      }
      return;
    }

    applyPickerClose(commit);
  }

  function markPendingPickerCommit() {
    const pickerInput = dom.paletteOptionGrid?.querySelector("[data-custom-palette-picker]");
    if (pickerInput instanceof HTMLInputElement) {
      pickerInput.dataset.pendingCommit = "true";
    }
  }

  function bindPickerLifecycle(pickerInput) {
    if (!(pickerInput instanceof HTMLInputElement) || pickerInput.dataset.pickerLifecycleBound === "true") {
      return;
    }

    pickerInput.dataset.pickerLifecycleBound = "true";
    pickerInput.addEventListener("open", () => {
      scheduleOpen(() => {
        bindPickerActionButtons();
        setPickerOpenState(true);
        if (typeof globalThis.Coloris?.updatePosition === "function") {
          globalThis.Coloris.updatePosition();
        }
      });
    });
    pickerInput.addEventListener("close", () => {
      const shouldCommit = pickerInput.dataset.pendingCommit === "true";
      delete pickerInput.dataset.pendingCommit;
      applyPickerClose(shouldCommit);
    });
  }

  function bindPickerActionButtons() {
    const picker = document.querySelector(".clr-picker");
    if (!(picker instanceof HTMLElement)) {
      return;
    }

    const clearButton = picker.querySelector(".clr-clear");
    if (clearButton instanceof HTMLElement) {
      clearButton.remove();
    }

    const closeButton = picker.querySelector(".clr-close");
    if (!(closeButton instanceof HTMLButtonElement)) {
      return;
    }

    closeButton.textContent = "Aceptar";

    let actions = picker.querySelector(".palette-picker__actions");
    if (!(actions instanceof HTMLElement)) {
      actions = document.createElement("div");
      actions.className = "palette-picker__actions";
      picker.append(actions);
    }

    let dismissButton = actions.querySelector("[data-dismiss-custom-palette-picker]");
    if (!(dismissButton instanceof HTMLButtonElement)) {
      dismissButton = document.createElement("button");
      dismissButton.type = "button";
      dismissButton.className = "palette-picker__dismiss-button";
      dismissButton.textContent = "Cerrar";
      dismissButton.dataset.dismissCustomPalettePicker = "";
      actions.append(dismissButton);
    }

    if (closeButton.parentElement !== actions) {
      actions.append(closeButton);
    }

    if (dismissButton.dataset.palettePickerDismissBound !== "true") {
      dismissButton.dataset.palettePickerDismissBound = "true";
      const handleDismiss = (event) => {
        if (dismissButton.dataset.palettePickerDismissInFlight === "true") {
          return;
        }

        dismissButton.dataset.palettePickerDismissInFlight = "true";
        event.preventDefault();
        event.stopImmediatePropagation();
        scheduleOpen(() => {
          requestPickerClose(false);
          delete dismissButton.dataset.palettePickerDismissInFlight;
        });
      };
      dismissButton.addEventListener("pointerdown", handleDismiss, true);
      dismissButton.addEventListener("mousedown", handleDismiss, true);
      dismissButton.addEventListener("click", handleDismiss, true);
    }

    if (closeButton.dataset.palettePickerAcceptBound !== "true") {
      closeButton.dataset.palettePickerAcceptBound = "true";
      closeButton.addEventListener("pointerdown", markPendingPickerCommit, true);
      closeButton.addEventListener("mousedown", markPendingPickerCommit, true);
      closeButton.addEventListener("click", markPendingPickerCommit, true);
    }
  }

  function isCustomPickerEventTarget(target) {
    return target instanceof Element && Boolean(
      target.closest(".clr-picker") ||
        target.closest("[data-open-custom-palette-picker]") ||
        target.closest("[data-custom-palette-hex]")
    );
  }
  function dismissPaletteModal() {
    requestPickerClose(false);
    handlers.closePaletteModal();
  }

  function handleDocumentPointerDown(event) {
    pickerPointerStartedInside = isCustomPickerEventTarget(event.target);
  }

  function handleDocumentClick(event) {
    if (!(event.target instanceof Element)) {
      pickerPointerStartedInside = false;
      return;
    }

    const dismissTarget = event.target.closest("[data-dismiss-custom-palette-picker]");
    if (dismissTarget) {
      lockPickerReopen();
      event.preventDefault();
      event.stopImmediatePropagation();
      scheduleOpen(() => requestPickerClose(false));
      return;
    }

    const acceptTarget = event.target.closest(".clr-close");
    if (acceptTarget) {
      lockPickerReopen();
      event.preventDefault();
      event.stopImmediatePropagation();
      markPendingPickerCommit();
      scheduleOpen(() => requestPickerClose(true));
      return;
    }

    const picker = document.querySelector(".clr-picker");
    const pickerIsOpen = picker instanceof HTMLElement && picker.classList.contains("clr-open");
    if (pickerIsOpen && !pickerPointerStartedInside && !isCustomPickerEventTarget(event.target)) {
      requestPickerClose(false);
    }
    pickerPointerStartedInside = false;
  }

  function handlePaletteGridClick(event) {
    const hexInputTarget = event.target instanceof Element ? event.target.closest("[data-custom-palette-hex]") : null;
    if (hexInputTarget instanceof HTMLInputElement) {
      hexInputTarget.focus();
      return;
    }

    const randomizeTarget = event.target instanceof Element ? event.target.closest("[data-randomize-custom-palette]") : null;
    if (randomizeTarget instanceof HTMLElement) {
      requestPickerClose(false);
      handlers.randomizeCustomPalette();
      return;
    }

    const pickerTarget = event.target instanceof Element ? event.target.closest("[data-open-custom-palette-picker]") : null;
    if (pickerTarget instanceof HTMLElement) {
      if (isPickerReopenLocked()) {
        return;
      }

      const openPicker = () => {
        const pickerInput = dom.paletteOptionGrid?.querySelector("[data-custom-palette-picker]");
        const hexInput = dom.paletteOptionGrid?.querySelector("[data-custom-palette-hex]");
        if (pickerInput instanceof HTMLInputElement) {
          pickerInput.disabled = false;
          bindPickerLifecycle(pickerInput);
          const committedHex = sanitizeHexDraft(
            hexInput instanceof HTMLInputElement
              ? hexInput.dataset.lastValid || hexInput.value
              : pickerInput.value
          );
          syncCustomPickerDraft(committedHex, { commit: true });
          pickerInput.focus();
          pickerInput.dispatchEvent(new MouseEvent("click", {
            bubbles: false,
            cancelable: true,
            view: window
          }));
        } else {
          dom.paletteOptionGrid?.querySelector("[data-custom-palette-hex]")?.focus();
        }
      };

      scheduleOpen(openPicker);
      return;
    }

    const customCardTarget = event.target instanceof Element ? event.target.closest("[data-custom-palette-card]") : null;
    const customControlTarget = event.target instanceof Element
      ? event.target.closest(".palette-option__controls, .palette-option__status--button")
      : null;
    if (customCardTarget instanceof HTMLElement && !(customControlTarget instanceof HTMLElement)) {
      requestPickerClose(false);
      handlers.selectPalette(CUSTOM_PALETTE_ID);
      return;
    }

    const target = event.target instanceof Element ? event.target.closest("[data-palette-option]") : null;
    if (target instanceof HTMLElement) {
      requestPickerClose(false);
      handlers.selectPalette(target.dataset.paletteOption);
    }
  }

  function handlePaletteGridChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.matches("[data-custom-palette-picker]")) {
      syncCustomPickerDraft(target.value);
      return;
    }

    if (target.matches("[data-custom-palette-hex]")) {
      const applied = handlers.updateCustomPaletteHex(target.value, { focus: false });
      if (!applied) {
        target.value = target.dataset.lastValid || target.defaultValue;
      }
    }
  }

  function handlePaletteGridInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.matches("[data-custom-palette-picker]")) {
      syncCustomPickerDraft(target.value);
      return;
    }

    if (target.matches("[data-custom-palette-hex]")) {
      const nextValue = sanitizeHexDraft(target.value);
      target.value = nextValue;
      if (nextValue.length === 4 || nextValue.length === 7) {
        const applied = handlers.updateCustomPaletteHex(nextValue, { render: false, focus: false });
        if (applied) {
          target.dataset.lastValid = nextValue;
        }
      }
    }
  }

  return {
    applyPickerClose,
    bindPickerActionButtons,
    bindPickerLifecycle,
    dismissPaletteModal,
    handleDocumentPointerDown,
    handleDocumentClick,
    handlePaletteGridChange,
    handlePaletteGridClick,
    handlePaletteGridInput,
    requestPickerClose
  };
}
