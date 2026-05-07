import { CUSTOM_PALETTE_ID } from "../palettes.js";

const AUTH_STORAGE_KEY = "chetrend-auth-demo";

function readStoredAuthState() {
  if (typeof localStorage === "undefined") {
    return false;
  }

  return localStorage.getItem(AUTH_STORAGE_KEY) === "true";
}

function persistAuthState(isLoggedIn) {
  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.setItem(AUTH_STORAGE_KEY, String(isLoggedIn));
}

export function bindTopbarActionEvents(dom, handlers) {
  let pickerReopenLockUntil = 0;
  let pickerTriggerUnlockTimer = 0;
  let isLoggedIn = readStoredAuthState();
  let activeMobileDrawerPanel = null;
  syncAuthUi();
  setPickerOpenState(false);

  function addListener(node, type, listener, options) {
    node?.addEventListener?.(type, listener, options);
  }

  function scheduleOpen(task) {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(task);
      return;
    }

    setTimeout(task, 0);
  }

  function isMobileViewport() {
    return typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(max-width: 960px)").matches;
  }

  function applyDocumentAuthState() {
    if (typeof document === "undefined") {
      return;
    }

    document.documentElement.dataset.authState = isLoggedIn ? "logged-in" : "logged-out";
  }

  function syncThemeTogglePlacement() {
    const themeToggle = dom.themeToggle;
    const targetSlot = isMobileViewport() ? dom.themeToggleMobileSlot : dom.themeToggleDesktopSlot;
    if (!themeToggle || !targetSlot) {
      return;
    }

    if (themeToggle.parentElement !== targetSlot) {
      targetSlot.append(themeToggle);
    }

    themeToggle.dataset.themeTogglePlacement = isMobileViewport() ? "mobile" : "desktop";
  }

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

    clearTimeout(pickerTriggerUnlockTimer);
    pickerTriggerUnlockTimer = window.setTimeout(() => {
      if (pickerTrigger instanceof HTMLElement) {
        delete pickerTrigger.dataset.pickerReopenLocked;
      }
      if (pickerInput instanceof HTMLInputElement) {
        pickerInput.disabled = false;
      }
      pickerTriggerUnlockTimer = 0;
    }, 240);
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

  function dismissPaletteModal() {
    requestPickerClose(false);
    handlers.closePaletteModal();
  }

  function resolveEventElement(event) {
    if (event.target instanceof Element) {
      return event.target;
    }

    if (typeof event.composedPath === "function") {
      const composedTarget = event.composedPath().find((node) => node instanceof Element);
      if (composedTarget instanceof Element) {
        return composedTarget;
      }
    }

    return event.target?.parentElement ?? null;
  }

  function setMobileDrawerPanel(panelName) {
    activeMobileDrawerPanel = panelName;

    if (dom.mobileTopbarMenu) {
      dom.mobileTopbarMenu.hidden = Boolean(panelName);
    }

    if (dom.mobileDrawerPanels) {
      dom.mobileDrawerPanels.hidden = !panelName;
    }

    if (dom.drawerUsersSection) {
      dom.drawerUsersSection.hidden = panelName !== "users";
    }

    if (dom.drawerRankingsSection) {
      dom.drawerRankingsSection.hidden = panelName !== "ranking";
    }

    dom.mobileTopbarMenu
      ?.querySelectorAll?.("[data-mobile-drawer-panel]")
      ?.forEach((button) => {
        const isActive = button.dataset.mobileDrawerPanel === panelName;
        button.setAttribute("aria-pressed", String(isActive));
        button.classList?.toggle?.("is-active", isActive);
      });
  }

  function setLoggedIn(nextLoggedIn, { announce = true } = {}) {
    if (isLoggedIn === nextLoggedIn) {
      syncAuthUi();
      return;
    }

    isLoggedIn = nextLoggedIn;
    persistAuthState(isLoggedIn);

    if (!isLoggedIn) {
      setMobileDrawerPanel(null);
      handlers.closeDrawers?.();
    }

    syncAuthUi();

    if (announce) {
      handlers.flashTitle(isLoggedIn ? "Sesion iniciada" : "Sesion cerrada");
    }
  }

  function syncAuthUi() {
    const isMobile = isMobileViewport();
    const label = dom.authButton?.querySelector(".button-label");
    const privateDrawerActions = dom.mobileTopbarMenu?.querySelectorAll?.("[data-auth-private]") ?? [];
    applyDocumentAuthState();
    syncThemeTogglePlacement();
    const authLabel = isLoggedIn
      ? (isMobile ? "Cerrar sesión" : "Cerrar sesión")
      : "Iniciar sesión";

    if (label) {
      label.textContent = authLabel;
    }

    if (dom.authButton) {
      dom.authButton.className = isLoggedIn
        ? "text-button discreet-auth"
        : "text-button text-button--accent prominent-auth";
      dom.authButton.setAttribute("aria-label", authLabel);
      dom.authButton.hidden = isMobile && isLoggedIn;
    }

    if (dom.authTools) {
      dom.authTools.hidden = !isLoggedIn;
    }

    [dom.profileButton, dom.storeButton, dom.openRightDrawer].forEach((node) => {
      if (node) {
        node.hidden = node === dom.openRightDrawer ? false : !isLoggedIn;
      }
    });

    privateDrawerActions.forEach((node) => {
      if (node) {
        node.hidden = !isLoggedIn;
      }
    });
  }

  addListener(dom.themeToggle, "click", handlers.toggleTheme);
  addListener(dom.refreshButton, "click", handlers.refreshCurrentTopic);
  addListener(dom.messageForm, "submit", handlers.submitMessage);
  addListener(dom.profileButton, "click", () => {
    handlers.flashTitle("Perfil listo para conectar");
  });
  addListener(dom.backToTopics, "click", handlers.backToTopics);
  addListener(dom.openRightDrawer, "click", () => {
    setMobileDrawerPanel(null);
  });
  addListener(typeof window !== "undefined" ? window : null, "resize", syncAuthUi, { passive: true });

  syncAuthUi();
  addListener(dom.authButton, "click", () => {
    setLoggedIn(!isLoggedIn);
  });

  addListener(dom.friendRequestsButton, "click", () => {
    handlers.flashTitle("Solicitudes de amistad abiertas");
  });

  addListener(dom.notificationsButton, "click", () => {
    handlers.flashTitle("Notificaciones abiertas");
  });

  addListener(dom.messagesButton, "click", () => {
    handlers.flashTitle("Mensajes abiertos");
  });

  addListener(dom.storeButton, "click", () => {
    handlers.flashTitle("Tienda en preparacion");
  });
  addListener(dom.mobileTopbarMenu, "click", (event) => {
    const eventElement = resolveEventElement(event);
    const panelTarget = eventElement?.closest?.("[data-mobile-drawer-panel]") ?? null;
    if (panelTarget instanceof HTMLElement) {
      const nextPanel = activeMobileDrawerPanel === panelTarget.dataset.mobileDrawerPanel
        ? null
        : panelTarget.dataset.mobileDrawerPanel;
      setMobileDrawerPanel(nextPanel);
      return;
    }

    const target = eventElement?.closest?.("[data-mobile-topbar-action]") ?? null;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.dataset.mobileTopbarAction === "profile") {
      setMobileDrawerPanel(null);
      handlers.closeDrawers?.();
      handlers.flashTitle("Perfil listo para conectar");
      return;
    }

    if (target.dataset.mobileTopbarAction === "store") {
      setMobileDrawerPanel(null);
      handlers.closeDrawers?.();
      handlers.flashTitle("Tienda en preparacion");
      return;
    }

    if (target.dataset.mobileTopbarAction === "auth") {
      setMobileDrawerPanel(null);
      setLoggedIn(false);
      return;
    }

    if (target.dataset.mobileTopbarAction === "palette") {
      setMobileDrawerPanel(null);
      handlers.closeDrawers?.();
      scheduleOpen(() => {
        handlers.openPaletteModal();
      });
    }
  });
  addListener(dom.mobileDrawerPanels, "click", (event) => {
    const eventElement = resolveEventElement(event);
    const backTarget = eventElement?.closest?.("[data-mobile-drawer-back]") ?? null;
    if (backTarget instanceof HTMLElement) {
      setMobileDrawerPanel(null);
    }
  });
  addListener(dom.paletteButton, "click", handlers.openPaletteModal);
  addListener(dom.closePaletteModalButton, "click", dismissPaletteModal);
  addListener(dom.paletteModalBackdrop, "click", (event) => {
    if (event.target === dom.paletteModalBackdrop) {
      dismissPaletteModal();
    }
  });
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
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
    if (
      pickerIsOpen &&
      !event.target.closest(".clr-picker") &&
      !event.target.closest("[data-open-custom-palette-picker]")
    ) {
      requestPickerClose(false);
    }
  }, true);
  addListener(dom.paletteOptionGrid, "click", (event) => {
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
          setPickerOpenState(true);
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
  });
  addListener(dom.paletteOptionGrid, "change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.matches("[data-custom-palette-picker]")) {
      syncCustomPickerDraft(target.value);
      return;
    }

    if (target.matches("[data-custom-palette-hex]")) {
      const applied = handlers.updateCustomPaletteHex(target.value);
      if (!applied) {
        target.value = target.dataset.lastValid || target.defaultValue;
      }
    }
  });
  addListener(dom.paletteOptionGrid, "input", (event) => {
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
        const applied = handlers.updateCustomPaletteHex(nextValue);
        if (applied) {
          target.dataset.lastValid = nextValue;
        }
      }
    }
  });
  addListener(dom.createTopicButton, "click", handlers.createNewTopic);
}
