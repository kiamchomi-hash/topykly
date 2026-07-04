import { CUSTOM_PALETTE_ID } from "../palettes.js";
import { dispatch, reducers } from "../store-logic.js";
const PROFILE_AVATAR_MAX_BYTES = 256 * 1024;
const PROFILE_AVATAR_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const FOCUSABLE_SELECTOR = [
  "button:not([disabled]):not([tabindex='-1'])",
  "[href]:not([tabindex='-1'])",
  "input:not([disabled]):not([type='hidden']):not([tabindex='-1'])",
  "textarea:not([disabled]):not([tabindex='-1'])",
  "select:not([disabled]):not([tabindex='-1'])",
  "[tabindex]:not([tabindex='-1'])"
].join(", ");

export function bindTopbarActionEvents(dom, handlers) {
  let pickerReopenLockUntil = 0;
  let pickerTriggerUnlockTimer = 0;
  let authPending = false;
  let authStatus = null;
  let authStatusPromise = null;
  let turnstileWidgetId = null;
  let authPasswordMode = "login";
  let turnstileRequired = false;
  let pendingTurnstileToken = null;
  let logoutConfirmUntil = 0;
  let activeMobileDrawerPanel = null;
  let lastMobilePanelTrigger = null;
  globalThis.__topyklyAuthControllerReady = true;
  syncAuthUi();
  setPickerOpenState(false);
  handlers.setAuthUiSync?.(syncAuthUi);

  function addListener(node, type, listener, options) {
    if (!node || typeof listener !== "function") {
      return;
    }

    node.addEventListener?.(type, listener, options);
  }

  function scheduleOpen(task) {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(task);
      return;
    }

    setTimeout(task, 0);
  }

  function getFirstFocusableElement(container) {
    if (!(container instanceof HTMLElement)) {
      return null;
    }

    return container.querySelector?.(FOCUSABLE_SELECTOR) ?? null;
  }

  function isFocusableTarget(node) {
    return node instanceof HTMLElement
      && !node.hidden
      && node.getAttribute?.("aria-hidden") !== "true"
      && !node.classList?.contains?.("is-search-hidden");
  }

  function focusNode(node) {
    if (!isFocusableTarget(node)) {
      return;
    }

    scheduleOpen(() => {
      node.focus?.();
    });
  }

  function getMobilePanelNode(panelName) {
    if (panelName === "users") {
      return dom.drawerUsersSection;
    }

    if (panelName === "ranking") {
      return dom.drawerRankingsSection;
    }

    return null;
  }

  function getMobileMenuSearchInput() {
    return dom.mobileTopbarMenu?.querySelector?.("#mobileDrawerSearch") ?? null;
  }

  function isMobileViewport() {
    return typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(max-width: 960px)").matches;
  }

  function isLoggedIn() {
    return handlers.state?.viewer?.type === "registered";
  }

  function isAdmin() {
    return Boolean(handlers.state?.viewer?.isAdmin);
  }

  function applyDocumentAuthState() {
    if (typeof document === "undefined") {
      return;
    }

    document.documentElement.dataset.authState = isLoggedIn() ? "logged-in" : "logged-out";
  }

  function syncProfileButtonAvatar() {
    const avatar = dom.profileButton?.querySelector?.(".profile-button__avatar");
    if (!(avatar instanceof HTMLElement)) {
      return;
    }

    const avatarUrl = handlers.state?.viewer?.avatarUrl || "";
    if (avatar.dataset.avatarUrl === avatarUrl) {
      return;
    }

    avatar.dataset.avatarUrl = avatarUrl;
    if (!avatarUrl) {
      avatar.innerHTML = `
        <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="4" y="4" width="40" height="40" rx="10"></rect>
          <circle cx="24" cy="18" r="7"></circle>
          <path d="M11.5 38c2.6-6.2 7.7-9.3 12.5-9.3S33.9 31.8 36.5 38"></path>
        </svg>`;
      return;
    }

    avatar.textContent = "";
    const image = document.createElement("img");
    image.src = avatarUrl;
    image.alt = "";
    image.loading = "lazy";
    avatar.append(image);
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

  function setMobileDrawerPanel(panelName, { trigger = null, restoreFocus = true } = {}) {
    if (trigger instanceof HTMLElement && trigger.dataset.mobileDrawerPanel) {
      lastMobilePanelTrigger = trigger;
    }

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

    syncMobileMenuSearch();

    if (!restoreFocus) {
      return;
    }

    if (panelName) {
      const panel = getMobilePanelNode(panelName);
      focusNode(getFirstFocusableElement(panel) || panel);
      return;
    }

    const focusTarget = isFocusableTarget(trigger)
      ? trigger
      : isFocusableTarget(lastMobilePanelTrigger)
        ? lastMobilePanelTrigger
        : getMobileMenuSearchInput();
    focusNode(focusTarget || getFirstFocusableElement(dom.mobileTopbarMenu));
  }

  function syncMobileMenuSearch() {
    const searchInput = getMobileMenuSearchInput();
    const buttons = dom.mobileTopbarMenu?.querySelectorAll?.(".drawer-action-button") ?? [];
    const query = typeof searchInput?.value === "string"
      ? searchInput.value.trim().toLowerCase()
      : "";

    buttons.forEach((button) => {
      if (!(button instanceof HTMLElement)) {
        return;
      }

      if (!query) {
        button.classList?.remove?.("is-search-hidden");
        return;
      }

      const label = button.textContent?.trim().toLowerCase() ?? "";
      button.classList?.toggle?.("is-search-hidden", !label.includes(query));
    });
  }

  function openProfileShortcut() {
    setMobileDrawerPanel(null, { restoreFocus: false });
    handlers.closeDrawers?.();
    handlers.openProfileModal?.();
  }

  async function loadAuthStatus() {
    if (authStatus) {
      return authStatus;
    }

    if (!authStatusPromise) {
      authStatusPromise = Promise.resolve(handlers.getAuthStatus?.())
        .then((status) => {
          authStatus = status || {};
          return authStatus;
        })
        .catch((error) => {
          console.error(error);
          authStatus = { turnstile: { configured: false, siteKey: null } };
          return authStatus;
        });
    }

    return authStatusPromise;
  }

  function resetTurnstileToken() {
    if (dom.authTurnstileToken) {
      dom.authTurnstileToken.value = "";
    }
  }

  function getTurnstileToken() {
    const storedToken = dom.authTurnstileToken?.value || "";
    if (storedToken) {
      return storedToken;
    }

    if (turnstileWidgetId !== null && typeof globalThis.turnstile?.getResponse === "function") {
      return globalThis.turnstile.getResponse(turnstileWidgetId) || "";
    }

    return "";
  }

  function settlePendingTurnstile(error, token = "") {
    if (!pendingTurnstileToken) {
      return;
    }

    const pending = pendingTurnstileToken;
    pendingTurnstileToken = null;
    clearTimeout(pending.timer);

    if (error) {
      pending.reject(error);
      return;
    }

    pending.resolve(token);
  }

  function storeTurnstileToken(token) {
    const normalizedToken = token || "";
    if (dom.authTurnstileToken) {
      dom.authTurnstileToken.value = normalizedToken;
    }

    if (normalizedToken) {
      settlePendingTurnstile(null, normalizedToken);
    }
  }

  async function syncTurnstile({ resetExisting = false } = {}) {
    const status = await loadAuthStatus();
    const siteKey = status?.turnstile?.siteKey || "";
    turnstileRequired = Boolean(status?.turnstile?.configured && siteKey);

    if (!dom.authTurnstile) {
      return;
    }

    dom.authTurnstile.hidden = !turnstileRequired;
    dom.authTurnstile.dataset.turnstileMode = turnstileRequired ? "silent" : "off";
    if (!turnstileRequired) {
      resetTurnstileToken();
      return;
    }

    if (!globalThis.turnstile?.render) {
      handlers.flashTitle?.("Preparando verificacion anti-bots");
      return;
    }

    if (turnstileWidgetId !== null) {
      if (resetExisting) {
        globalThis.turnstile.reset?.(turnstileWidgetId);
        resetTurnstileToken();
      }
      return;
    }

    turnstileWidgetId = globalThis.turnstile.render(dom.authTurnstile, {
      sitekey: siteKey,
      appearance: "interaction-only",
      execution: "execute",
      callback(token) {
        storeTurnstileToken(token);
      },
      "expired-callback"() {
        resetTurnstileToken();
        settlePendingTurnstile(new Error("La verificacion expiro. Intentalo de nuevo."));
      },
      "error-callback"() {
        resetTurnstileToken();
        settlePendingTurnstile(new Error("No pudimos verificarte. Intentalo de nuevo."));
      }
    });
  }

  async function requestTurnstileToken() {
    await syncTurnstile();
    if (!turnstileRequired) {
      return "";
    }

    const existingToken = getTurnstileToken();
    if (existingToken) {
      return existingToken;
    }

    if (turnstileWidgetId === null || typeof globalThis.turnstile?.execute !== "function") {
      throw new Error("La verificacion anti-bots todavia esta cargando.");
    }

    handlers.flashTitle?.("Verificando acceso...");
    setAuthStatusMessage("Verificando acceso...");
    return new Promise((resolve, reject) => {
      pendingTurnstileToken = {
        resolve,
        reject,
        timer: setTimeout(() => {
          pendingTurnstileToken = null;
          reject(new Error("La verificacion esta tardando. Intentalo de nuevo."));
        }, 12000)
      };
      globalThis.turnstile.execute(turnstileWidgetId);
    });
  }

  function setAuthButtonPending(button, pending, pendingText = "Verificando...") {
    if (!button) {
      return;
    }

    const label = button.querySelector?.("span:last-child") ?? button.querySelector?.("span") ?? button;
    if (label && !button.dataset.defaultAuthLabel) {
      button.dataset.defaultAuthLabel = label.textContent || "";
    }

    button.disabled = pending;
    button.setAttribute("aria-busy", String(pending));
    if (label) {
      label.textContent = pending ? pendingText : button.dataset.defaultAuthLabel || label.textContent;
    }
  }

  function setAuthStatusMessage(message = "", kind = "info") {
    if (!dom.authStatus) {
      return;
    }

    const normalized = String(message || "").trim();
    dom.authStatus.textContent = normalized;
    dom.authStatus.hidden = !normalized;
    dom.authStatus.dataset.statusKind = normalized ? kind : "off";
  }
  function syncAuthPasswordMode() {
    const isRegister = authPasswordMode === "register";
    [dom.authLoginModeButton, dom.authRegisterModeButton].forEach((button) => {
      if (!button) {
        return;
      }

      const active = button.dataset.authMode === authPasswordMode;
      button.classList?.toggle?.("is-active", active);
      button.setAttribute?.("aria-pressed", String(active));
    });

    dom.authModal?.querySelectorAll?.(".auth-register-only")?.forEach((node) => {
      node.hidden = !isRegister;
    });
    if (dom.authNicknameInput) {
      dom.authNicknameInput.required = isRegister;
      dom.authNicknameInput.disabled = !isRegister;
    }
    if (dom.authPasswordInput) {
      dom.authPasswordInput.autocomplete = isRegister ? "new-password" : "current-password";
    }
    const label = dom.authPasswordButton?.querySelector?.("span") ?? dom.authPasswordButton;
    if (label) {
      label.textContent = isRegister ? "Crear cuenta" : "Entrar con email";
    }
  }

  function setAuthPasswordMode(nextMode) {
    authPasswordMode = nextMode === "register" ? "register" : "login";
    resetTurnstileToken();
    setAuthStatusMessage();
    syncAuthPasswordMode();
  }
  function setAuthModalOpen(isOpen) {
    if (dom.authModalBackdrop) {
      dom.authModalBackdrop.hidden = !isOpen;
    }

    if (dom.authModal) {
      dom.authModal.setAttribute("aria-hidden", String(!isOpen));
    }

    if (isOpen) {
      syncAuthPasswordMode();
      dom.authGoogleButton?.focus?.();
      return;
    }

    dom.authButton?.focus?.();
  }

  async function openAuthModal() {
    if (authPending || isLoggedIn()) {
      return;
    }

    setAuthStatusMessage();
    setAuthModalOpen(true);
    await syncTurnstile();
  }

  function closeAuthModal() {
    resetTurnstileToken();
    setAuthStatusMessage();
    setAuthModalOpen(false);
  }

  function requestLogoutConfirmation() {
    const now = Date.now();
    if (now <= logoutConfirmUntil) {
      logoutConfirmUntil = 0;
      void setLoggedIn(false);
      return;
    }

    logoutConfirmUntil = now + 4500;
    handlers.flashTitle?.("Toca de nuevo para cerrar sesion");
  }
  async function setLoggedIn(nextLoggedIn, { announce = true } = {}) {
    const currentLoggedIn = isLoggedIn();
    if (currentLoggedIn === nextLoggedIn) {
      syncAuthUi();
      return;
    }

    if (!nextLoggedIn) {
      setMobileDrawerPanel(null, { restoreFocus: false });
      handlers.closeDrawers?.();
    }

    authPending = true;
    syncAuthUi();

    try {
      const turnstileToken = nextLoggedIn ? await requestTurnstileToken() : "";

      const authResult = nextLoggedIn
        ? await handlers.login?.({ turnstileToken })
        : await handlers.logout?.();

      if (authResult?.redirected) {
        closeAuthModal();
        return;
      }

      closeAuthModal();

      if (announce) {
        handlers.flashTitle(nextLoggedIn ? "Sesion iniciada" : "Sesion cerrada");
      }
    } catch (error) {
      console.error(error);
      if (announce) {
        const message = error?.message || (nextLoggedIn ? "No se pudo iniciar sesion" : "No se pudo cerrar sesion");
        setAuthStatusMessage(message, "error");
        handlers.flashTitle(message);
      }
    } finally {
      authPending = false;
      syncAuthUi();
    }
  }

  function syncAuthUi() {
    const loggedIn = isLoggedIn();
    const isMobile = isMobileViewport();
    const label = dom.authButton?.querySelector(".button-label");
    const privateDrawerActions = dom.mobileTopbarMenu?.querySelectorAll?.("[data-auth-private]") ?? [];
    const adminDrawerActions = dom.mobileTopbarMenu?.querySelectorAll?.("[data-admin-private]") ?? [];
    applyDocumentAuthState();
    syncThemeTogglePlacement();
    syncProfileButtonAvatar();
    const authLabel = loggedIn
      ? (isMobile ? "Cerrar sesión" : "Cerrar sesión")
      : "Iniciar sesión";

    if (label) {
      label.textContent = authLabel;
    }

    if (dom.authButton) {
      dom.authButton.className = loggedIn
        ? "text-button discreet-auth"
        : "text-button text-button--accent prominent-auth";
      dom.authButton.setAttribute("aria-label", authLabel);
      dom.authButton.hidden = isMobile && loggedIn;
      dom.authButton.disabled = authPending;
      dom.authButton.setAttribute("aria-busy", String(authPending));
    }

    if (dom.authTools) {
      dom.authTools.hidden = !loggedIn;
    }

    [dom.profileButton, dom.storeButton, dom.openRightDrawer].forEach((node) => {
      if (node) {
        node.hidden = node === dom.openRightDrawer ? false : !loggedIn;
      }
    });

    privateDrawerActions.forEach((node) => {
      if (node) {
        node.hidden = !loggedIn;
      }
    });

    if (dom.adminPanelButton) {
      dom.adminPanelButton.hidden = !isAdmin();
    }

    adminDrawerActions.forEach((node) => {
      if (node) {
        node.hidden = !isAdmin();
      }
    });

    syncMobileMenuSearch();
  }

  addListener(dom.themeToggle, "click", handlers.toggleTheme);
  addListener(dom.refreshButton, "click", handlers.refreshCurrentTopic);
  addListener(dom.messageForm, "submit", handlers.submitMessage);
  addListener(dom.profileButton, "click", handlers.openProfileModal);
  addListener(dom.adminPanelButton, "click", handlers.openAdminPanel);
  addListener(dom.backToTopics, "click", handlers.backToTopics);
  addListener(dom.openRightDrawer, "click", () => {
    lastMobilePanelTrigger = null;
    setMobileDrawerPanel(null, { restoreFocus: false });
    const searchInput = getMobileMenuSearchInput();
    if (typeof searchInput?.value === "string") {
      searchInput.value = "";
    }
    syncMobileMenuSearch();
  });
  addListener(typeof window !== "undefined" ? window : null, "resize", syncAuthUi, { passive: true });

  syncAuthUi();
  function handleAuthButtonClick(event) {
    if (event?.topyklyAuthHandled) {
      return;
    }

    if (event) {
      event.topyklyAuthHandled = true;
      event.preventDefault?.();
    }

    if (isLoggedIn()) {
      requestLogoutConfirmation();
      return;
    }

    void openAuthModal();
  }

  addListener(dom.authButton, "click", handleAuthButtonClick);
  addListener(typeof document !== "undefined" ? document : null, "click", (event) => {
    const eventElement = resolveEventElement(event);
    if (eventElement?.closest?.("#authButton")) {
      handleAuthButtonClick(event);
    }
  });
  addListener(dom.authGoogleButton, "click", async () => {
    setAuthButtonPending(dom.authGoogleButton, true, "Verificando...");
    try {
      await setLoggedIn(true);
    } finally {
      setAuthButtonPending(dom.authGoogleButton, false);
    }
  });
  addListener(dom.closeAuthModalButton, "click", closeAuthModal);
  addListener(dom.authModalBackdrop, "click", (event) => {
    if (event.target === dom.authModalBackdrop) {
      closeAuthModal();
    }
  });
  addListener(dom.authLoginModeButton, "click", () => setAuthPasswordMode("login"));
  addListener(dom.authRegisterModeButton, "click", () => setAuthPasswordMode("register"));
  addListener(dom.authPasswordForm, "submit", async (event) => {
    event.preventDefault();
    if (authPending || isLoggedIn()) {
      return;
    }

    authPending = true;
    syncAuthUi();
    setAuthButtonPending(dom.authPasswordButton, true, "Verificando...");

    try {
      setAuthStatusMessage("Verificando acceso...");
      const turnstileToken = await requestTurnstileToken();

      const payload = {
        email: dom.authEmailInput?.value || "",
        password: dom.authPasswordInput?.value || "",
        turnstileToken
      };
      const authResult = authPasswordMode === "register"
        ? await handlers.registerWithPassword?.({ ...payload, nickname: dom.authNicknameInput?.value || "" })
        : await handlers.loginWithPassword?.(payload);

      if (authResult) {
        setAuthStatusMessage();
        closeAuthModal();
        handlers.flashTitle(authPasswordMode === "register" ? "Cuenta creada" : "Sesion iniciada");
      }
    } catch (error) {
      console.error(error);
      const message = error?.message || "No se pudo completar el acceso";
      setAuthStatusMessage(message, "error");
      handlers.flashTitle(message);
    } finally {
      authPending = false;
      setAuthButtonPending(dom.authPasswordButton, false);
      syncAuthUi();
    }
  });
  addListener(typeof window !== "undefined" ? window : null, "keydown", (event) => {
    if (event.key === "Escape" && dom.authModalBackdrop && !dom.authModalBackdrop.hidden) {
      closeAuthModal();
    }
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
      setMobileDrawerPanel(nextPanel, { trigger: panelTarget });
      return;
    }

    const target = eventElement?.closest?.("[data-mobile-topbar-action]") ?? null;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.dataset.mobileTopbarAction === "home") {
      setMobileDrawerPanel(null, { restoreFocus: false });
      if (handlers.state) {
        dispatch(handlers.state, reducers.setMobileView, "browse");
      }
      handlers.syncResponsiveView?.();
      handlers.closeDrawers?.();
      return;
    }

    if (target.dataset.mobileTopbarAction === "profile") {
      openProfileShortcut();
      return;
    }

    if (target.dataset.mobileTopbarAction === "admin") {
      setMobileDrawerPanel(null, { restoreFocus: false });
      handlers.closeDrawers?.();
      scheduleOpen(() => handlers.openAdminPanel?.());
      return;
    }

    if (target.dataset.mobileTopbarAction === "store") {
      setMobileDrawerPanel(null, { restoreFocus: false });
      handlers.closeDrawers?.();
      handlers.flashTitle("Tienda en preparacion");
      return;
    }

    if (target.dataset.mobileTopbarAction === "auth") {
      setMobileDrawerPanel(null, { restoreFocus: false });
      requestLogoutConfirmation();
      return;
    }

    if (target.dataset.mobileTopbarAction === "palette") {
      setMobileDrawerPanel(null, { restoreFocus: false });
      handlers.closeDrawers?.();
      scheduleOpen(() => {
        handlers.openPaletteModal();
      });
    }
  });
  addListener(dom.mobileTopbarMenu?.querySelector?.("#mobileDrawerSearch") ?? null, "input", syncMobileMenuSearch);
  addListener(dom.mobileDrawerPanels, "click", (event) => {
    const eventElement = resolveEventElement(event);
    const backTarget = eventElement?.closest?.("[data-mobile-drawer-back]") ?? null;
    if (backTarget instanceof HTMLElement) {
      setMobileDrawerPanel(null);
    }
  });
  addListener(dom.paletteButton, "click", handlers.openPaletteModal);
  addListener(dom.closePaletteModalButton, "click", dismissPaletteModal);
  addListener(dom.closeProfileModalButton, "click", handlers.closeProfileModal);
  addListener(dom.skipProfileButton, "click", handlers.skipProfileSetup);
  addListener(dom.closeAdminModalButton, "click", handlers.closeAdminPanel);
  addListener(dom.profileModalBackdrop, "click", (event) => {
    if (event.target === dom.profileModalBackdrop) {
      handlers.closeProfileModal?.();
    }
  });
  addListener(dom.adminModalBackdrop, "click", (event) => {
    if (event.target === dom.adminModalBackdrop) {
      handlers.closeAdminPanel?.();
    }
  });
  addListener(dom.adminPanelBody, "click", (event) => {
    const target = resolveEventElement(event)?.closest?.("[data-admin-action]") ?? null;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    void handlers.applyAdminAction?.(target.dataset.adminAction, target.dataset.targetType, target.dataset.targetId);
  });
  function renderProfileAvatarPreview(avatarUrl = "") {
    if (!dom.profileAvatarPreview) {
      return;
    }

    dom.profileAvatarPreview.textContent = "";
    if (avatarUrl) {
      const image = document.createElement("img");
      image.src = avatarUrl;
      image.alt = "";
      dom.profileAvatarPreview.append(image);
      return;
    }

    const fallback = document.createElement("span");
    fallback.textContent = "T";
    dom.profileAvatarPreview.append(fallback);
  }

  function readProfileAvatarFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        resolve("");
        return;
      }

      if (!PROFILE_AVATAR_TYPES.has(file.type)) {
        reject(new Error("La foto debe ser PNG, JPG, WebP o GIF."));
        return;
      }

      if (file.size > PROFILE_AVATAR_MAX_BYTES) {
        reject(new Error("La foto no puede superar 256 KB."));
        return;
      }

      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result || "")));
      reader.addEventListener("error", () => reject(new Error("No se pudo leer la foto.")));
      reader.readAsDataURL(file);
    });
  }

  async function syncProfileAvatarPreview() {
    const file = dom.profileAvatarInput?.files?.[0] ?? null;
    if (!file) {
      if (dom.profileAvatarInput) {
        dom.profileAvatarInput.dataset.selectedAvatarDataUrl = "";
        dom.profileAvatarInput.dataset.removeAvatar = "false";
      }
      renderProfileAvatarPreview(dom.profileAvatarInput?.dataset?.renderedAvatarUrl || "");
      return;
    }

    try {
      const dataUrl = await readProfileAvatarFile(file);
      if (dom.profileAvatarInput) {
        dom.profileAvatarInput.dataset.selectedAvatarDataUrl = dataUrl;
        dom.profileAvatarInput.dataset.removeAvatar = "false";
      }
      renderProfileAvatarPreview(dataUrl);
    } catch (error) {
      if (dom.profileAvatarInput) {
        dom.profileAvatarInput.value = "";
        dom.profileAvatarInput.dataset.selectedAvatarDataUrl = "";
        dom.profileAvatarInput.dataset.removeAvatar = "false";
      }
      renderProfileAvatarPreview(dom.profileAvatarInput?.dataset?.renderedAvatarUrl || "");
      handlers.flashTitle(error?.message || "No se pudo cargar la foto");
    }
  }

  addListener(dom.profileAvatarInput, "change", () => {
    void syncProfileAvatarPreview();
  });
  addListener(dom.profileAvatarPickButton, "click", () => {
    dom.profileAvatarInput?.click?.();
  });
  addListener(dom.profileAvatarClearButton, "click", () => {
    const selectedAvatarDataUrl = dom.profileAvatarInput?.dataset?.selectedAvatarDataUrl || "";
    const renderedAvatarUrl = dom.profileAvatarInput?.dataset?.renderedAvatarUrl || "";

    if (dom.profileAvatarInput) {
      dom.profileAvatarInput.value = "";
      dom.profileAvatarInput.dataset.selectedAvatarDataUrl = "";
      dom.profileAvatarInput.dataset.removeAvatar = selectedAvatarDataUrl ? "false" : String(Boolean(renderedAvatarUrl));
    }

    renderProfileAvatarPreview(selectedAvatarDataUrl ? renderedAvatarUrl : "");
  });
  addListener(dom.profileModal?.querySelector?.("#profileForm") ?? null, "submit", handlers.saveProfile);
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
