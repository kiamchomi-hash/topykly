import { CUSTOM_PALETTE_ID } from "../palettes.js";
import { resetSocialEditing, setProfileSectionEditing, setSocialFieldEditing } from "./profile-modal.js";
import { dispatch, reducers } from "../store-logic.js?v=20260709-topicrace1";
import { computeAgeFromBirthdateParts, MINIMUM_REGISTRATION_AGE, populateBirthYearOptions } from "./date-utils.js";
const PROFILE_AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const PROFILE_AVATAR_SOURCE_MAX_BYTES = 8 * 1024 * 1024;
const PROFILE_AVATAR_CROP_SIZE = 1024;
const PROFILE_AVATAR_CROP_PREVIEW_SIZE = 256;
const PROFILE_AVATAR_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const AUTH_EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const AUTH_NICKNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{2,23}$/;
const AUTH_CODE_PATTERN = /^\d{6}$/;
const AUTH_MINIMUM_AGE = MINIMUM_REGISTRATION_AGE;
const AUTH_TERMS_VERSION = "2026-07-10";
const AUTH_RESEND_COOLDOWN_MS = 60000;
const AUTH_RESEND_DEFAULT_LABEL = "Reenviar código";

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
  let pickerPointerStartedInside = false;
  let authPending = false;
  let authStatus = null;
  let authStatusPromise = null;
  let turnstileScriptPromise = null;
  let turnstileWidgetId = null;
  let authPasswordMode = "login";
  let authRegisterStep = "credentials";
  let authEmailChallenge = null;
  let authRecoveryMode = false;
  let authRecoveryStep = "request";
  let authRecoveryChallenge = null;
  let pendingAuthTopicId = null;
  let turnstileRequired = false;
  let pendingTurnstileToken = null;
  let logoutConfirmUntil = 0;
  let authButtonErrorTimer = 0;
  let authValidationMessage = "";
  let authResendCooldownTimer = 0;
  let authResendCooldownEndsAt = 0;
  let activeMobileDrawerPanel = null;
  let lastMobilePanelTrigger = null;
  let profileAvatarCropState = null;
  let authOidcCompletion = false;
  let oidcCompletionPrompted = false;
  let authAccountLinkMode = false;
  let authAccountLinkRequested = handlers.initialAuthAction === "link-account";
  globalThis.__topyklyAuthControllerReady = true;
  syncAuthUi();
  populateAuthBirthYearOptions();
  setPickerOpenState(false);
  handlers.setAuthUiSync?.(syncAuthUi);
  handlers.setOpenOidcProfileCompletionSync?.(openOidcProfileCompletion);

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

    const avatarUrl = handlers.state?.viewer?.avatarPendingUrl || handlers.state?.viewer?.avatarUrl || "";
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
    image.width = 42;
    image.height = 42;
    image.loading = "lazy";
    avatar.append(image);
  }

  function isThemeDrawerViewport() {
    return isMobileViewport() && window.matchMedia?.("(max-width: 380px)")?.matches;
  }

  function syncThemeTogglePlacement() {
    const themeToggle = dom.themeToggle;
    const targetSlot = isThemeDrawerViewport()
      ? dom.themeToggleDrawerSlot
      : isMobileViewport()
        ? dom.themeToggleMobileSlot
        : dom.themeToggleDesktopSlot;
    if (!themeToggle || !targetSlot) {
      return;
    }

    if (themeToggle.parentElement !== targetSlot) {
      targetSlot.append(themeToggle);
    }

    themeToggle.dataset.themeTogglePlacement = isThemeDrawerViewport()
      ? "drawer"
      : isMobileViewport()
        ? "mobile"
        : "desktop";
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

  function loadTurnstileScript() {
    if (globalThis.turnstile?.render) {
      return Promise.resolve();
    }

    if (turnstileScriptPromise) {
      return turnstileScriptPromise;
    }

    const existingScript = document.getElementById?.("turnstile-script") ?? null;
    if (existingScript) {
      turnstileScriptPromise = new Promise((resolve) => {
        const waitForTurnstile = window.setInterval?.(() => {
          if (globalThis.turnstile?.render) {
            window.clearInterval?.(waitForTurnstile);
            resolve();
          }
        }, 50);
        existingScript.addEventListener?.("load", () => resolve(), { once: true });
        existingScript.addEventListener?.("error", () => resolve(), { once: true });
      });
      return turnstileScriptPromise;
    }

    turnstileScriptPromise = new Promise((resolve) => {
      const script = document.createElement?.("script");
      if (!script || !document.head?.appendChild) {
        resolve();
        return;
      }

      script.id = "turnstile-script";
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => resolve();
      document.head.appendChild(script);
    });

    return turnstileScriptPromise;
  }

  async function syncTurnstile({ resetExisting = false } = {}) {
    const status = await loadAuthStatus();
    const siteKey = status?.turnstile?.siteKey || "";
    turnstileRequired = Boolean(status?.turnstile?.configured && siteKey);

    if (!dom.authTurnstile) {
      return;
    }

    dom.authTurnstile.dataset.turnstileMode = turnstileRequired ? "silent" : "off";
    if (!turnstileRequired) {
      resetTurnstileToken();
      return;
    }

    if (!globalThis.turnstile?.render) {
      await loadTurnstileScript();
      if (!globalThis.turnstile?.render) {
        handlers.flashTitle?.("Preparando verificacion anti-bots");
        return;
      }
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

  async function requestTurnstileToken({ silent = false } = {}) {
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

    if (!silent) {
      handlers.flashTitle?.("Verificando acceso...");
      setAuthStatusMessage("Verificando acceso...");
    }
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

  function setAuthButtonPending(button, pending, pendingText = "Verificando...", { preserveLabel = false } = {}) {
    if (!button) {
      return;
    }

    const label = button.querySelector?.("[data-auth-button-label]") ?? button.querySelector?.("span:last-child") ?? button;
    if (label && !button.dataset.defaultAuthLabel) {
      button.dataset.defaultAuthLabel = label.textContent || "";
    }

    if (pending) {
      clearTimeout(authButtonErrorTimer);
      button.classList?.remove?.("is-error");
    }

    button.disabled = pending;
    button.setAttribute("aria-busy", String(pending));
    button.classList?.toggle?.("is-pending", pending);
    if (label && !preserveLabel) {
      label.textContent = pending ? pendingText : button.dataset.defaultAuthLabel || label.textContent;
    }
  }

  function flashAuthButtonError(button, message) {
    if (!button || !message) {
      return;
    }

    const label = button.querySelector?.("[data-auth-button-label]") ?? button;
    if (!button.dataset.defaultAuthLabel) {
      button.dataset.defaultAuthLabel = label.textContent || "";
    }

    clearTimeout(authButtonErrorTimer);
    button.classList?.add?.("is-error");
    label.textContent = message;
    button.title = message;
    authButtonErrorTimer = setTimeout(() => {
      button.classList?.remove?.("is-error");
      button.removeAttribute?.("title");
      if (label.textContent === message) {
        label.textContent = button.dataset.defaultAuthLabel || label.textContent;
      }
    }, 3600);
    authButtonErrorTimer?.unref?.();
  }

  function scheduleAuthButtonError(button, message) {
    const timer = setTimeout(() => flashAuthButtonError(button, message), 0);
    timer?.unref?.();
  }

  function clearAuthButtonError(button) {
    if (!button) {
      return;
    }

    clearTimeout(authButtonErrorTimer);
    button.classList?.remove?.("is-error");
    button.removeAttribute?.("title");
  }

  function formatAuthResendCountdown(remainingMs) {
    const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function tickAuthResendCooldown() {
    const button = dom.authSendCodeAgainButton;
    if (!button) {
      clearInterval(authResendCooldownTimer);
      authResendCooldownTimer = 0;
      return;
    }

    const remainingMs = authResendCooldownEndsAt - Date.now();
    if (remainingMs <= 0) {
      stopAuthResendCooldown();
      return;
    }

    button.disabled = true;
    button.textContent = `${AUTH_RESEND_DEFAULT_LABEL} (${formatAuthResendCountdown(remainingMs)})`;
  }

  function startAuthResendCooldown(durationMs = AUTH_RESEND_COOLDOWN_MS) {
    clearInterval(authResendCooldownTimer);
    authResendCooldownEndsAt = Date.now() + durationMs;
    tickAuthResendCooldown();
    if (typeof setInterval !== "function") {
      return;
    }
    authResendCooldownTimer = setInterval(tickAuthResendCooldown, 1000);
    authResendCooldownTimer?.unref?.();
  }

  function stopAuthResendCooldown() {
    clearInterval(authResendCooldownTimer);
    authResendCooldownTimer = 0;
    authResendCooldownEndsAt = 0;
    const button = dom.authSendCodeAgainButton;
    if (button) {
      button.disabled = false;
      button.textContent = AUTH_RESEND_DEFAULT_LABEL;
    }
  }

  function getAuthCodeBoxes() {
    return Array.from(dom.authCodeBoxes?.querySelectorAll?.(".auth-code-box") ?? []);
  }

  function syncAuthCodeValueFromBoxes() {
    if (!dom.authCodeInput) {
      return;
    }

    dom.authCodeInput.value = getAuthCodeBoxes().map((box) => box.value || "").join("");
    dom.authCodeInput.dispatchEvent?.(new Event("input", { bubbles: true }));
  }

  function setAuthCodeBoxesValue(value) {
    const digits = String(value || "").replace(/\D/g, "").slice(0, 6).split("");
    getAuthCodeBoxes().forEach((box, index) => {
      box.value = digits[index] || "";
    });
    syncAuthCodeValueFromBoxes();
  }

  function setAuthStatusMessage(message = "", kind = "info") {
    if (!dom.authStatus) {
      return;
    }

    const normalized = String(message || "").trim();
    dom.authStatus.textContent = normalized;
    dom.authStatus.hidden = false;
    dom.authStatus.dataset.statusKind = normalized ? kind : "off";
  }
  function setAuthFieldInvalid(input, isInvalid) {
    if (!input) {
      return;
    }

    input.setAttribute?.("aria-invalid", String(Boolean(isInvalid)));
    const field = typeof input.closest === "function"
      ? input.closest(".auth-email-form__field")
      : null;
    field?.classList?.toggle?.("is-invalid", Boolean(isInvalid));
  }

  function setAuthTermsInvalid(isInvalid) {
    dom.authTermsInput?.setAttribute?.("aria-invalid", String(Boolean(isInvalid)));
    dom.authTermsField?.classList?.toggle?.("is-invalid", Boolean(isInvalid));
  }

  function populateAuthBirthYearOptions() {
    populateBirthYearOptions(dom.authBirthYear, AUTH_MINIMUM_AGE);
  }

  function syncAuthBirthdateAge() {
    const day = dom.authBirthDay?.value || "";
    const month = dom.authBirthMonth?.value || "";
    const year = dom.authBirthYear?.value || "";
    if (!dom.authAgeInput) {
      return;
    }

    if (!day || !month || !year) {
      dom.authAgeInput.value = "";
      return;
    }

    const age = computeAgeFromBirthdateParts(day, month, year);
    dom.authAgeInput.value = age === null ? "" : String(age);
    dom.authAgeInput.dispatchEvent?.(new Event("input", { bubbles: true }));
  }

  function resetAuthFieldValidation() {
    [dom.authNicknameInput, dom.authEmailInput, dom.authAgeInput, dom.authCodeInput, dom.authPasswordInput, dom.authPasswordConfirmInput].forEach((input) => {
      setAuthFieldInvalid(input, false);
    });
    setAuthTermsInvalid(false);
    clearAuthButtonError(dom.authPasswordButton);
    clearAuthButtonError(dom.authSendCodeAgainButton);
  }

  function markAuthErrorFields(error) {
    const code = String(error?.code || "").toUpperCase();
    const message = String(error?.message || "").toLowerCase();
    let marked = false;

    if ([
      "INVALID_EMAIL_CODE",
      "EMAIL_CODE_EXPIRED",
      "EMAIL_CODE_ATTEMPTS_EXCEEDED",
      "INVALID_PASSWORD_RESET_CODE",
      "PASSWORD_RESET_CODE_EXPIRED",
      "PASSWORD_RESET_ATTEMPTS_EXCEEDED"
    ].includes(code)) {
      setAuthFieldInvalid(dom.authCodeInput, true);
      return;
    }

    if (code === "NICKNAME_TAKEN" || message.includes("nickname")) {
      setAuthFieldInvalid(dom.authNicknameInput, true);
      marked = true;
    }
    if (message.includes("email")) {
      setAuthFieldInvalid(dom.authEmailInput, true);
      marked = true;
    }
    if (code === "INVALID_AGE" || message.includes("edad") || message.includes("anos")) {
      setAuthFieldInvalid(dom.authAgeInput, true);
      marked = true;
    }
    if (code === "TERMS_REQUIRED" || message.includes("terminos")) {
      setAuthTermsInvalid(true);
      marked = true;
    }
    if (message.includes("contrasena") || message.includes("contraseña")) {
      setAuthFieldInvalid(dom.authPasswordInput, true);
      marked = true;
    }

    if (!marked && code === "VALIDATION_ERROR") {
      setAuthFieldInvalid(dom.authEmailInput, true);
      if (authPasswordMode === "register") {
        setAuthFieldInvalid(dom.authNicknameInput, true);
        setAuthFieldInvalid(dom.authAgeInput, true);
      }
    }
  }

  function getAuthBirthdateValidationMessage() {
    const raw = dom.authAgeInput?.value ?? "";
    if (raw === "") {
      return "Completa tu fecha de nacimiento.";
    }

    const age = Number(raw);
    if (!Number.isInteger(age) || age < AUTH_MINIMUM_AGE || age > 120) {
      return age < AUTH_MINIMUM_AGE
        ? `Debes tener al menos ${AUTH_MINIMUM_AGE} años para registrarte.`
        : "Revisa tu fecha de nacimiento.";
    }

    return "";
  }

  function validateAuthEmailFields() {
    resetAuthFieldValidation();
    authValidationMessage = "";
    const isRegister = authPasswordMode === "register";
    const email = String(dom.authEmailInput?.value || "").trim();
    const nickname = String(dom.authNicknameInput?.value || "").trim();
    const password = String(dom.authPasswordInput?.value || "");
    const code = String(dom.authCodeInput?.value || "").trim();

    if (authAccountLinkMode) {
      if (!password) {
        setAuthFieldInvalid(dom.authPasswordInput, true);
        authValidationMessage = "Ingresa tu contraseña actual.";
        return false;
      }
      return true;
    }

    if (authRecoveryMode) {
      if (authRecoveryStep === "request") {
        if (!AUTH_EMAIL_PATTERN.test(email)) {
          setAuthFieldInvalid(dom.authEmailInput, true);
          authValidationMessage = "Ingresa un email válido.";
          return false;
        }
        return true;
      }

      const codeInvalid = !AUTH_CODE_PATTERN.test(code);
      const passwordInvalid = password.length < 8;
      const confirmValue = String(dom.authPasswordConfirmInput?.value || "");
      const confirmInvalid = !passwordInvalid && confirmValue !== password;
      if (codeInvalid) {
        setAuthFieldInvalid(dom.authCodeInput, true);
      }
      if (passwordInvalid) {
        setAuthFieldInvalid(dom.authPasswordInput, true);
      }
      if (confirmInvalid) {
        setAuthFieldInvalid(dom.authPasswordConfirmInput, true);
      }

      if (codeInvalid) {
        authValidationMessage = "Ingresa el código de 6 dígitos que te enviamos por email.";
      } else if (passwordInvalid) {
        authValidationMessage = password
          ? "La nueva contraseña debe tener al menos 8 caracteres."
          : "Ingresa una nueva contraseña.";
      } else if (confirmInvalid) {
        authValidationMessage = "Las contraseñas no coinciden.";
      }

      return !codeInvalid && !passwordInvalid && !confirmInvalid;
    }

    if (isRegister && authRegisterStep === "verify") {
      if (!AUTH_CODE_PATTERN.test(code)) {
        setAuthFieldInvalid(dom.authCodeInput, true);
        authValidationMessage = "Ingresa el código de 6 dígitos que te enviamos por email.";
        return false;
      }
      return true;
    }

    if (!isRegister || authRegisterStep === "credentials") {
      const emailInvalid = !AUTH_EMAIL_PATTERN.test(email);
      const passwordInvalid = password.length < 8;
      if (emailInvalid) {
        setAuthFieldInvalid(dom.authEmailInput, true);
      }
      if (passwordInvalid) {
        setAuthFieldInvalid(dom.authPasswordInput, true);
      }

      if (emailInvalid && passwordInvalid) {
        authValidationMessage = "Completa tu email y contraseña.";
      } else if (emailInvalid) {
        authValidationMessage = "Ingresa un email válido.";
      } else if (passwordInvalid) {
        authValidationMessage = password
          ? "La contraseña debe tener al menos 8 caracteres."
          : "Ingresa tu contraseña.";
      }

      return !emailInvalid && !passwordInvalid;
    }

    if (authRegisterStep === "profile") {
      const nicknameInvalid = !AUTH_NICKNAME_PATTERN.test(nickname);
      const ageMessage = getAuthBirthdateValidationMessage();
      const termsInvalid = !dom.authTermsInput?.checked;

      if (nicknameInvalid) {
        setAuthFieldInvalid(dom.authNicknameInput, true);
      }
      if (ageMessage) {
        setAuthFieldInvalid(dom.authAgeInput, true);
      }
      if (termsInvalid) {
        setAuthTermsInvalid(true);
      }

      if (nicknameInvalid) {
        authValidationMessage = "El nombre de usuario debe tener 3 a 24 caracteres y empezar con una letra.";
      } else if (ageMessage) {
        authValidationMessage = ageMessage;
      } else if (termsInvalid) {
        authValidationMessage = "Acepta los Términos y Condiciones para continuar.";
      }

      return !nicknameInvalid && !ageMessage && !termsInvalid;
    }

    return true;
  }

  function setAuthPasswordLabelText(text) {
    const labelText = dom.authPasswordField?.querySelector?.(".auth-email-form__label-text");
    const textNode = labelText?.firstChild;
    if (textNode && typeof textNode.nodeValue === "string") {
      textNode.nodeValue = `${text} `;
    }
  }

  function syncAuthPasswordMode() {
    const isRecovery = authRecoveryMode;
    const isAccountLink = authAccountLinkMode;
    const recoveryRequestStep = isRecovery && authRecoveryStep === "request";
    const recoveryVerifyStep = isRecovery && authRecoveryStep === "verify";
    const isRegister = !isRecovery && !isAccountLink && authPasswordMode === "register";
    const isCredentialsStep = !isRecovery && !isAccountLink && (!isRegister || authRegisterStep === "credentials");
    const isProfileStep = isRegister && authRegisterStep === "profile";
    const isCodeStep = isRegister && authRegisterStep === "verify";
    if (dom.authPasswordForm) {
      dom.authPasswordForm.dataset.authMode = isAccountLink ? "link" : isRecovery ? "recovery" : authPasswordMode;
      dom.authPasswordForm.dataset.authStep = isRecovery ? authRecoveryStep : isRegister ? authRegisterStep : "credentials";
    }

    const authModalTitle = authOidcCompletion
      ? "Completa tu registro"
      : isRecovery
        ? "Recuperar contraseña"
        : isAccountLink
          ? "Vincular con Google"
          : isRegister ? "Regístrate" : "Iniciar Sesión";
    if (dom.authModalTitle) {
      dom.authModalTitle.textContent = authModalTitle;
    }
    dom.authModal?.setAttribute?.("aria-label", authModalTitle);

    [dom.authLoginModeButton, dom.authRegisterModeButton].forEach((button) => {
      if (!button) {
        return;
      }

      const active = button.dataset.authMode === authPasswordMode;
      button.classList?.toggle?.("is-active", active);
      button.setAttribute?.("aria-pressed", String(active));
      button.disabled = isCodeStep || authOidcCompletion || isRecovery || isAccountLink;
    });
    const authModeTabsContainer = dom.authLoginModeButton?.closest?.(".auth-mode-tabs") ?? null;
    if (authModeTabsContainer) {
      authModeTabsContainer.hidden = authOidcCompletion || isRecovery || isAccountLink;
    }

    dom.authModal?.querySelectorAll?.(".auth-credentials-step")?.forEach((node) => {
      node.hidden = !(isCredentialsStep || isRecovery || isAccountLink);
    });
    if (dom.authGoogleSection) {
      dom.authGoogleSection.classList?.toggle?.("is-collapsed", !isCredentialsStep);
      dom.authGoogleSection.setAttribute?.("aria-hidden", String(!isCredentialsStep));
    }
    if (dom.authGoogleButton) {
      dom.authGoogleButton.disabled = !isCredentialsStep;
    }
    dom.authModal?.querySelectorAll?.(".auth-profile-step")?.forEach((node) => {
      node.hidden = !isProfileStep;
    });
    dom.authModal?.querySelectorAll?.(".auth-verify-step")?.forEach((node) => {
      node.hidden = !(isCodeStep || recoveryVerifyStep);
    });
    if (dom.authNicknameInput) {
      dom.authNicknameInput.required = isProfileStep;
      dom.authNicknameInput.disabled = !isProfileStep;
    }
    if (dom.authAgeInput) {
      dom.authAgeInput.required = isProfileStep;
      dom.authAgeInput.disabled = !isProfileStep;
    }
    [dom.authBirthDay, dom.authBirthMonth, dom.authBirthYear].forEach((select) => {
      if (select) {
        select.required = isProfileStep;
        select.disabled = !isProfileStep;
      }
    });
    if (dom.authTermsInput) {
      dom.authTermsInput.required = isProfileStep;
      dom.authTermsInput.disabled = !isProfileStep;
    }
    const emailActive = isCredentialsStep || recoveryRequestStep;
    if (dom.authEmailInput) {
      dom.authEmailInput.required = emailActive;
      dom.authEmailInput.disabled = !emailActive;
      dom.authEmailInput.readOnly = false;
    }
    if (dom.authEmailField) {
      dom.authEmailField.hidden = recoveryVerifyStep || isAccountLink;
    }
    const passwordActive = isCredentialsStep || recoveryVerifyStep || isAccountLink;
    if (dom.authPasswordInput) {
      dom.authPasswordInput.required = passwordActive;
      dom.authPasswordInput.disabled = !passwordActive;
      dom.authPasswordInput.autocomplete = isRegister || recoveryVerifyStep ? "new-password" : "current-password";
    }
    if (dom.authPasswordField) {
      dom.authPasswordField.hidden = recoveryRequestStep;
    }
    setAuthPasswordLabelText(recoveryVerifyStep ? "Nueva contraseña" : isAccountLink ? "Contraseña actual" : "Contraseña");
    if (dom.authPasswordConfirmField) {
      dom.authPasswordConfirmField.hidden = !recoveryVerifyStep;
    }
    if (dom.authPasswordConfirmInput) {
      dom.authPasswordConfirmInput.required = recoveryVerifyStep;
      dom.authPasswordConfirmInput.disabled = !recoveryVerifyStep;
    }
    if (dom.authCodeInput) {
      dom.authCodeInput.required = isCodeStep || recoveryVerifyStep;
      dom.authCodeInput.disabled = !(isCodeStep || recoveryVerifyStep);
    }
    if (dom.authSendCodeAgainButton) {
      dom.authSendCodeAgainButton.hidden = !(isCodeStep || recoveryVerifyStep);
    }
    if (dom.authRecoveryButton) {
      // In the register credentials step the button stays as an invisible
      // placeholder so both tabs keep the fields at the same vertical position.
      dom.authRecoveryButton.hidden = !(isCredentialsStep && !authOidcCompletion);
      dom.authRecoveryButton.classList?.toggle?.("is-placeholder", isCredentialsStep && isRegister);
      dom.authRecoveryButton.disabled = isRegister;
    }
    if (dom.authBackButton) {
      dom.authBackButton.hidden = !(isProfileStep || isRecovery || isAccountLink);
      dom.authBackButton.textContent = authOidcCompletion ? "Más tarde" : isAccountLink ? "Cancelar" : "Volver";
    }
    const label = dom.authPasswordButton?.querySelector?.("[data-auth-button-label]") ?? dom.authPasswordButton;
    if (label) {
      label.textContent = authOidcCompletion
        ? "Guardar"
        : recoveryRequestStep
        ? "Enviar código"
        : recoveryVerifyStep
        ? "Cambiar contraseña"
        : isAccountLink
        ? "Continuar con Google"
        : isCredentialsStep && isRegister
        ? "Siguiente"
        : isCodeStep
        ? "Verificar código"
        : (isRegister ? "Enviar código" : "Iniciar sesión");
      if (dom.authPasswordButton) {
        // Keep the restore label in sync so pending/error flashes revert to the
        // current mode's text instead of the first one ever captured.
        dom.authPasswordButton.dataset.defaultAuthLabel = label.textContent;
      }
    }
  }

  function resetAuthEmailChallenge() {
    authEmailChallenge = null;
    if (dom.authCodeInput) {
      dom.authCodeInput.value = "";
    }
    if (dom.authCodeHint) {
      dom.authCodeHint.textContent = "";
    }
    setAuthCodeBoxesValue("");
    stopAuthResendCooldown();
  }

  function resetAuthFormDraft() {
    [dom.authNicknameInput, dom.authEmailInput, dom.authAgeInput, dom.authCodeInput, dom.authPasswordInput, dom.authPasswordConfirmInput].forEach((input) => {
      if (input) {
        input.value = "";
      }
    });
    [dom.authBirthDay, dom.authBirthMonth, dom.authBirthYear].forEach((select) => {
      if (select) {
        select.value = "";
      }
    });
    setAuthCodeBoxesValue("");
    if (dom.authTermsInput) {
      dom.authTermsInput.checked = false;
    }
  }

  function setAuthPasswordMode(nextMode) {
    authPasswordMode = nextMode === "register" ? "register" : "login";
    authRegisterStep = "credentials";
    authRecoveryMode = false;
    authRecoveryStep = "request";
    authRecoveryChallenge = null;
    authAccountLinkMode = false;
    resetAuthEmailChallenge();
    resetAuthFormDraft();
    resetTurnstileToken();
    resetAuthFieldValidation();
    setAuthStatusMessage();
    syncAuthPasswordMode();
  }

  function enterPasswordRecovery() {
    if (authPending) {
      return;
    }

    authRecoveryMode = true;
    authRecoveryStep = "request";
    authRecoveryChallenge = null;
    authAccountLinkMode = false;
    authRegisterStep = "credentials";
    resetAuthEmailChallenge();
    resetTurnstileToken();
    resetAuthFieldValidation();
    if (dom.authPasswordInput) {
      dom.authPasswordInput.value = "";
    }
    if (dom.authPasswordConfirmInput) {
      dom.authPasswordConfirmInput.value = "";
    }
    setAuthStatusMessage();
    syncAuthPasswordMode();
    dom.authEmailInput?.focus?.();
  }

  function exitPasswordRecovery() {
    authRecoveryMode = false;
    authRecoveryStep = "request";
    authRecoveryChallenge = null;
    resetAuthEmailChallenge();
    resetTurnstileToken();
    resetAuthFieldValidation();
    if (dom.authPasswordInput) {
      dom.authPasswordInput.value = "";
    }
    if (dom.authPasswordConfirmInput) {
      dom.authPasswordConfirmInput.value = "";
    }
    setAuthStatusMessage();
    syncAuthPasswordMode();
    dom.authEmailInput?.focus?.();
  }

  function openAccountLinkModal() {
    if (authPending || !isLoggedIn() || !handlers.state?.viewer?.canLinkGoogle) {
      return;
    }

    handlers.closeProfileModal?.();
    pendingAuthTopicId = handlers.state?.selectedTopicId ?? null;
    authAccountLinkMode = true;
    authRecoveryMode = false;
    authRecoveryStep = "request";
    authRecoveryChallenge = null;
    authPasswordMode = "login";
    authRegisterStep = "credentials";
    resetAuthEmailChallenge();
    resetAuthFormDraft();
    resetAuthFieldValidation();
    setAuthStatusMessage();
    setAuthModalOpen(true);
    void syncTurnstile();
    dom.authPasswordInput?.focus?.();
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

  function getPendingAuthTopicId() {
    return pendingAuthTopicId ?? handlers.state?.selectedTopicId ?? null;
  }

  async function openAuthModal() {
    if (authPending || isLoggedIn()) {
      return;
    }

    pendingAuthTopicId = handlers.state?.selectedTopicId ?? null;
    resetAuthEmailChallenge();
    resetAuthFieldValidation();
    setAuthStatusMessage();
    setAuthModalOpen(true);
    await syncTurnstile();
  }

  function closeAuthModal() {
    pendingAuthTopicId = null;
    resetTurnstileToken();
    authRegisterStep = "credentials";
    authOidcCompletion = false;
    authRecoveryMode = false;
    authRecoveryStep = "request";
    authRecoveryChallenge = null;
    authAccountLinkMode = false;
    resetAuthEmailChallenge();
    resetAuthFormDraft();
    resetAuthFieldValidation();
    setAuthStatusMessage();
    if (dom.authGoogleButton) {
      dom.authGoogleButton.disabled = true;
    }
    setAuthModalOpen(false);
  }

  function openOidcProfileCompletion() {
    if (authPending) {
      return;
    }

    pendingAuthTopicId = handlers.state?.selectedTopicId ?? null;
    authPasswordMode = "register";
    authRegisterStep = "profile";
    authOidcCompletion = true;
    resetAuthEmailChallenge();
    resetAuthFieldValidation();
    setAuthStatusMessage();
    syncAuthPasswordMode();
    setAuthModalOpen(true);
    dom.authNicknameInput?.focus?.();
  }

  function requestLogoutConfirmation() {
    const now = Date.now();
    if (now <= logoutConfirmUntil) {
      logoutConfirmUntil = 0;
      void setLoggedIn(false);
      return;
    }

    logoutConfirmUntil = now + 4500;
    handlers.flashTitle?.("Toca de nuevo para cerrar sesión");
  }
  async function setLoggedIn(nextLoggedIn, { announce = true, silentTurnstile = false } = {}) {
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
      const turnstileToken = nextLoggedIn ? await requestTurnstileToken({ silent: silentTurnstile }) : "";

      const authResult = nextLoggedIn
        ? await handlers.login?.({ turnstileToken, selectedTopicId: getPendingAuthTopicId() })
        : await handlers.logout?.();

      if (authResult?.redirected) {
        closeAuthModal();
        return;
      }

      closeAuthModal();

      if (announce) {
        handlers.flashTitle(nextLoggedIn ? "Sesión iniciada" : "Sesión cerrada");
      }
    } catch (error) {
      console.error(error);
      if (announce) {
        const message = error?.message || (nextLoggedIn ? "No se pudo iniciar sesión" : "No se pudo cerrar sesión");
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

    [dom.profileButton, dom.settingsButton, dom.storeButton, dom.openRightDrawer].forEach((node) => {
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

    if (Boolean(handlers.state?.viewer?.profilePending)) {
      if (!oidcCompletionPrompted) {
        oidcCompletionPrompted = true;
        openOidcProfileCompletion();
      }
    } else {
      oidcCompletionPrompted = false;
    }

    if (authAccountLinkRequested && loggedIn && !authPending) {
      authAccountLinkRequested = false;
      openAccountLinkModal();
    }
  }

  addListener(dom.themeToggle, "click", handlers.toggleTheme);
  addListener(dom.refreshButton, "click", handlers.refreshCurrentTopic);
  addListener(dom.topicsRefreshButton, "click", handlers.refreshTopicsList);
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
    setAuthButtonPending(dom.authGoogleButton, true, "", { preserveLabel: true });
    try {
      await setLoggedIn(true, { silentTurnstile: true });
    } finally {
      setAuthButtonPending(dom.authGoogleButton, false, "", { preserveLabel: true });
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
  addListener(dom.authBackButton, "click", () => {
    if (authPending) {
      return;
    }
    if (authOidcCompletion) {
      closeAuthModal();
      handlers.flashTitle("Puedes completar tu registro desde el botón de acceso.");
      return;
    }
    if (authAccountLinkMode) {
      closeAuthModal();
      return;
    }
    if (authRecoveryMode) {
      if (authRecoveryStep === "verify") {
        authRecoveryStep = "request";
        authRecoveryChallenge = null;
        resetAuthEmailChallenge();
        resetAuthFieldValidation();
        if (dom.authPasswordInput) {
          dom.authPasswordInput.value = "";
        }
        if (dom.authPasswordConfirmInput) {
          dom.authPasswordConfirmInput.value = "";
        }
        setAuthStatusMessage();
        syncAuthPasswordMode();
        dom.authEmailInput?.focus?.();
        return;
      }
      exitPasswordRecovery();
      return;
    }
    if (authPasswordMode !== "register" || authRegisterStep !== "profile") {
      return;
    }
    authRegisterStep = "credentials";
    resetAuthFieldValidation();
    setAuthStatusMessage();
    syncAuthPasswordMode();
    dom.authEmailInput?.focus?.();
  });

  async function requestAuthEmailCode() {
    if (authEmailChallenge) {
      resetTurnstileToken();
    }
    const turnstileToken = await requestTurnstileToken();
    const challenge = await handlers.requestEmailAuthCode({
      email: dom.authEmailInput?.value || "",
      nickname: dom.authNicknameInput?.value || "",
      age: dom.authAgeInput?.value || null,
      password: dom.authPasswordInput?.value || "",
      acceptedTerms: Boolean(dom.authTermsInput?.checked),
      termsVersion: AUTH_TERMS_VERSION,
      turnstileToken
    });
    authEmailChallenge = challenge;
    authRegisterStep = "verify";
    setAuthCodeBoxesValue("");
    setAuthFieldInvalid(dom.authCodeInput, false);
    syncAuthPasswordMode();
    setAuthStatusMessage();
    if (dom.authCodeHint) {
      dom.authCodeHint.textContent = "";
      const emailStrong = document.createElement("strong");
      emailStrong.textContent = challenge.email;
      dom.authCodeHint.append("Te enviamos un código a ", emailStrong, ". Revisa también spam.");
    }
    startAuthResendCooldown();
    getAuthCodeBoxes()[0]?.focus?.();
    return challenge;
  }

  async function requestPasswordRecoveryCode() {
    if (authRecoveryChallenge) {
      resetTurnstileToken();
    }
    const turnstileToken = await requestTurnstileToken();
    const email = String(dom.authEmailInput?.value || "").trim();
    const challenge = await handlers.requestPasswordResetCode?.({ email, turnstileToken });
    authRecoveryChallenge = { ...challenge, email };
    authRecoveryStep = "verify";
    setAuthCodeBoxesValue("");
    setAuthFieldInvalid(dom.authCodeInput, false);
    if (dom.authPasswordInput) {
      dom.authPasswordInput.value = "";
    }
    if (dom.authPasswordConfirmInput) {
      dom.authPasswordConfirmInput.value = "";
    }
    syncAuthPasswordMode();
    setAuthStatusMessage();
    if (dom.authCodeHint) {
      dom.authCodeHint.textContent = "";
      const emailStrong = document.createElement("strong");
      emailStrong.textContent = email;
      dom.authCodeHint.append("Si ", emailStrong, " tiene una cuenta, recibirá un código. Revisa también spam.");
    }
    startAuthResendCooldown();
    getAuthCodeBoxes()[0]?.focus?.();
    return challenge;
  }

  addListener(dom.authPasswordForm, "submit", async (event) => {
    event.preventDefault();
    if (authPending || (isLoggedIn() && !authOidcCompletion && !authAccountLinkMode)) {
      return;
    }

    if (!validateAuthEmailFields()) {
      const message = authValidationMessage || "Revisa los campos marcados.";
      setAuthStatusMessage(message, "error");
      flashAuthButtonError(dom.authPasswordButton, message);
      return;
    }

    const isRegister = !authRecoveryMode && !authAccountLinkMode && authPasswordMode === "register";
    if (isRegister && authRegisterStep === "credentials") {
      authRegisterStep = "profile";
      setAuthStatusMessage();
      syncAuthPasswordMode();
      dom.authNicknameInput?.focus?.();
      return;
    }

    authPending = true;
    syncAuthUi();
    const showVerifyingLabel = authEmailChallenge
      || authAccountLinkMode
      || (authRecoveryMode && authRecoveryStep === "verify");
    setAuthButtonPending(dom.authPasswordButton, true, showVerifyingLabel ? "Verificando..." : "Enviando...");

    try {
      let authResult = null;
      if (authOidcCompletion) {
        authResult = await handlers.completeOidcProfile?.({
          username: dom.authNicknameInput?.value || "",
          age: Number(dom.authAgeInput?.value) || null,
          acceptedTerms: Boolean(dom.authTermsInput?.checked),
          termsVersion: AUTH_TERMS_VERSION
        });
      } else if (authAccountLinkMode) {
        const turnstileToken = await requestTurnstileToken();
        setAuthStatusMessage("Verificando contraseña...");
        const linkResult = await handlers.startAccountLink?.({
          password: dom.authPasswordInput?.value || "",
          turnstileToken,
          selectedTopicId: getPendingAuthTopicId()
        });
        if (linkResult?.redirected) {
          setAuthStatusMessage("Redirigiendo a Google...");
          return;
        }
        authResult = linkResult;
      } else if (authRecoveryMode) {
        if (authRecoveryStep === "request") {
          await requestPasswordRecoveryCode();
          return;
        }
        setAuthStatusMessage("Verificando código...");
        authResult = await handlers.confirmPasswordReset?.({
          challengeId: authRecoveryChallenge?.challengeId || "",
          code: dom.authCodeInput?.value || "",
          newPassword: dom.authPasswordInput?.value || "",
          selectedTopicId: getPendingAuthTopicId()
        });
      } else if (!isRegister) {
        const turnstileToken = await requestTurnstileToken();
        authResult = await handlers.loginWithPassword?.({
          email: dom.authEmailInput?.value || "",
          password: dom.authPasswordInput?.value || "",
          turnstileToken,
          selectedTopicId: getPendingAuthTopicId()
        });
      } else if (authRegisterStep === "profile") {
        await requestAuthEmailCode();
        return;
      } else {
        setAuthStatusMessage("Verificando código...");
        authResult = await handlers.verifyEmailAuthCode({
          challengeId: authEmailChallenge.challengeId,
          code: dom.authCodeInput?.value || "",
          selectedTopicId: getPendingAuthTopicId()
        });
      }

      if (authResult) {
        const successMessage = authOidcCompletion
          ? "Perfil completado"
          : authRecoveryMode
            ? "Contraseña actualizada"
            : authAccountLinkMode
              ? "Cuenta de Google vinculada"
              : authPasswordMode === "register" ? "Cuenta creada" : "Sesión iniciada";
        setAuthStatusMessage();
        closeAuthModal();
        handlers.flashTitle(successMessage);
      }
    } catch (error) {
      console.error(error);
      markAuthErrorFields(error);
      const message = error?.message || "No se pudo completar el acceso";
      setAuthStatusMessage(message, "error");
      handlers.flashTitle(message);
      scheduleAuthButtonError(dom.authPasswordButton, message);
    } finally {
      authPending = false;
      setAuthButtonPending(dom.authPasswordButton, false);
      syncAuthPasswordMode();
      syncAuthUi();
    }
  });

  addListener(dom.authSendCodeAgainButton, "click", async () => {
    if (authPending || (!authEmailChallenge && !authRecoveryChallenge)) {
      return;
    }
    authPending = true;
    dom.authSendCodeAgainButton.disabled = true;
    try {
      if (authRecoveryMode) {
        await requestPasswordRecoveryCode();
      } else {
        await requestAuthEmailCode();
      }
    } catch (error) {
      markAuthErrorFields(error);
      const message = error?.message || "No se pudo reenviar el código.";
      setAuthStatusMessage(message, "error");
      stopAuthResendCooldown();
      flashAuthButtonError(dom.authSendCodeAgainButton, message);
    } finally {
      authPending = false;
      syncAuthUi();
    }
  });

  [dom.authNicknameInput, dom.authEmailInput, dom.authAgeInput, dom.authCodeInput, dom.authPasswordInput, dom.authPasswordConfirmInput].forEach((node) => {
    addListener(node, "input", () => {
      setAuthFieldInvalid(node, false);
    });
  });
  addListener(dom.authRecoveryButton, "click", enterPasswordRecovery);
  addListener(dom.profileLinkGoogleButton, "click", openAccountLinkModal);
  [dom.authBirthDay, dom.authBirthMonth, dom.authBirthYear].forEach((select) => {
    addListener(select, "change", syncAuthBirthdateAge);
  });
  getAuthCodeBoxes().forEach((box, index) => {
    addListener(box, "input", () => {
      const digit = String(box.value || "").replace(/\D/g, "").slice(-1);
      box.value = digit;
      syncAuthCodeValueFromBoxes();
      if (digit && index < 5) {
        getAuthCodeBoxes()[index + 1]?.focus?.();
      }
    });
    addListener(box, "keydown", (event) => {
      if (event.key === "Backspace" && !box.value && index > 0) {
        const previousBox = getAuthCodeBoxes()[index - 1];
        if (previousBox) {
          previousBox.value = "";
          previousBox.focus?.();
          syncAuthCodeValueFromBoxes();
        }
      } else if (event.key === "ArrowLeft" && index > 0) {
        getAuthCodeBoxes()[index - 1]?.focus?.();
      } else if (event.key === "ArrowRight" && index < 5) {
        getAuthCodeBoxes()[index + 1]?.focus?.();
      }
    });
    addListener(box, "paste", (event) => {
      const text = event.clipboardData?.getData?.("text") || "";
      if (!text) {
        return;
      }
      event.preventDefault?.();
      setAuthCodeBoxesValue(text);
      const filledCount = String(text).replace(/\D/g, "").length;
      getAuthCodeBoxes()[Math.min(filledCount, 5)]?.focus?.();
    });
  });
  addListener(dom.authTermsInput, "change", () => setAuthTermsInvalid(false));
  addListener(typeof window !== "undefined" ? window : null, "keydown", (event) => {
    if (event.key === "Escape" && dom.profileAvatarCropBackdrop && !dom.profileAvatarCropBackdrop.hidden) {
      closeProfileAvatarCrop();
      renderProfileAvatarPreview(dom.profileAvatarInput?.dataset?.selectedAvatarDataUrl || dom.profileAvatarInput?.dataset?.renderedAvatarUrl || "");
      return;
    }

    if (event.key === "Escape" && dom.authModalBackdrop && !dom.authModalBackdrop.hidden) {
      closeAuthModal();
    }

    if (event.key === "Escape" && dom.reportModalBackdrop && !dom.reportModalBackdrop.hidden) {
      handlers.closeReportModal?.();
    }

    if (event.key === "Escape" && dom.settingsModalBackdrop && !dom.settingsModalBackdrop.hidden) {
      handlers.closeSettingsModal?.();
    }
  });

  addListener(dom.friendRequestsButton, "click", (event) => {
    event?.stopPropagation();
    handlers.toggleFriendRequestsPanel?.();
  });

  addListener(dom.notificationsButton, "click", (event) => {
    event?.stopPropagation();
    handlers.toggleNotificationsPanel?.();
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

    if (target.dataset.mobileTopbarAction === "friends") {
      setMobileDrawerPanel(null, { restoreFocus: false });
      handlers.closeDrawers?.();
      scheduleOpen(() => handlers.toggleFriendRequestsPanel?.(true));
      return;
    }

    if (target.dataset.mobileTopbarAction === "admin") {
      setMobileDrawerPanel(null, { restoreFocus: false });
      handlers.closeDrawers?.();
      scheduleOpen(() => handlers.openAdminPanel?.());
      return;
    }

    if (target.dataset.mobileTopbarAction === "settings") {
      setMobileDrawerPanel(null, { restoreFocus: false });
      handlers.closeDrawers?.();
      scheduleOpen(() => handlers.openSettingsModal?.());
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
  addListener(dom.settingsButton, "click", handlers.openSettingsModal);
  addListener(dom.closeSettingsModalButton, "click", handlers.closeSettingsModal);
  addListener(dom.settingsModalBackdrop, "click", (event) => {
    if (event.target === dom.settingsModalBackdrop) {
      handlers.closeSettingsModal?.();
    }
  });
  addListener(dom.settingsModal, "click", (event) => {
    const toggleTarget = resolveEventElement(event)?.closest?.("[data-setting-toggle]") ?? null;
    if (toggleTarget instanceof HTMLElement) {
      void handlers.toggleSetting?.(toggleTarget.dataset.settingToggle);
    }
  });
  addListener(dom.settingsDeleteAccountButton, "click", handlers.requestAccountDeletion);
  addListener(dom.settingsDeleteCancelButton, "click", handlers.cancelAccountDeletion);
  addListener(dom.settingsDeleteConfirmButton, "click", () => {
    void handlers.confirmAccountDeletion?.();
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
  addListener(dom.closeReportModalButton, "click", () => handlers.closeReportModal?.());
  addListener(dom.reportModalBackdrop, "click", (event) => {
    if (event.target === dom.reportModalBackdrop) {
      handlers.closeReportModal?.();
    }
  });
  function syncReportModalSubmitState() {
    if (!dom.reportModalSubmitButton) {
      return;
    }

    const selected = dom.reportReasonForm?.querySelector?.("input[name='reportReason']:checked");
    const isOther = selected?.value === "other";
    const hasCustomText = Boolean(dom.reportOtherReasonInput?.value?.trim());
    dom.reportModalSubmitButton.disabled = !selected || (isOther && !hasCustomText);
  }

  addListener(dom.reportReasonForm, "change", (event) => {
    const target = resolveEventElement(event);
    if (!(target instanceof HTMLInputElement) || target.name !== "reportReason") {
      return;
    }

    syncReportModalSubmitState();
  });
  addListener(dom.reportOtherReasonInput, "input", syncReportModalSubmitState);
  addListener(dom.reportReasonForm, "submit", (event) => {
    event.preventDefault();
    const selected = dom.reportReasonForm?.querySelector?.("input[name='reportReason']:checked");
    if (!(selected instanceof HTMLInputElement)) {
      return;
    }
    void handlers.submitReportModal?.(selected.value, dom.reportOtherReasonInput?.value || "");
  });
  function setProfileAvatarSelection(dataUrl) {
    if (dom.profileAvatarInput) {
      dom.profileAvatarInput.dataset.selectedAvatarDataUrl = dataUrl;
      dom.profileAvatarInput.dataset.removeAvatar = "false";
    }
    renderProfileAvatarPreview(dataUrl);
  }

  function setProfileAvatarCropOpen(isOpen) {
    if (dom.profileAvatarCropBackdrop) {
      dom.profileAvatarCropBackdrop.hidden = !isOpen;
    }
    if (dom.profileAvatarCropModal) {
      dom.profileAvatarCropModal.setAttribute("aria-hidden", String(!isOpen));
    }
    if (isOpen) {
      scheduleOpen(() => dom.profileAvatarCropModal?.focus?.());
    }
  }

  function closeProfileAvatarCrop({ clearInput = true } = {}) {
    profileAvatarCropState = null;
    setProfileAvatarCropOpen(false);
    if (clearInput && dom.profileAvatarInput) {
      dom.profileAvatarInput.value = "";
    }
    if (dom.profileAvatarCropImage) {
      dom.profileAvatarCropImage.removeAttribute("src");
      dom.profileAvatarCropImage.style.width = "";
      dom.profileAvatarCropImage.style.height = "";
      dom.profileAvatarCropImage.style.transform = "";
    }
  }

  function clampProfileAvatarCropOffset() {
    if (!profileAvatarCropState) {
      return;
    }

    const state = profileAvatarCropState;
    const previewSize = getProfileAvatarCropPreviewSize();
    const scale = previewSize / Math.min(state.width, state.height) * state.zoom;
    const scaledWidth = state.width * scale;
    const scaledHeight = state.height * scale;
    const maxX = Math.max(0, (scaledWidth - previewSize) / 2);
    const maxY = Math.max(0, (scaledHeight - previewSize) / 2);
    state.offsetX = Math.max(-maxX, Math.min(maxX, state.offsetX));
    state.offsetY = Math.max(-maxY, Math.min(maxY, state.offsetY));
  }

  function getProfileAvatarCropPreviewSize() {
    const cropWindow = dom.profileAvatarCropFrame?.querySelector?.(".profile-avatar-crop__window");
    const bounds = cropWindow?.getBoundingClientRect?.();
    return bounds?.width || PROFILE_AVATAR_CROP_PREVIEW_SIZE;
  }

  function syncProfileAvatarCropImage() {
    if (!profileAvatarCropState || !dom.profileAvatarCropImage) {
      return;
    }

    clampProfileAvatarCropOffset();
    const state = profileAvatarCropState;
    const previewSize = getProfileAvatarCropPreviewSize();
    const scale = previewSize / Math.min(state.width, state.height) * state.zoom;
    dom.profileAvatarCropImage.style.width = `${state.width * scale}px`;
    dom.profileAvatarCropImage.style.height = `${state.height * scale}px`;
    dom.profileAvatarCropImage.style.transform = `translate(-50%, -50%) translate(${state.offsetX}px, ${state.offsetY}px)`;
  }
  function loadProfileAvatarImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.addEventListener("load", () => resolve(image));
      image.addEventListener("error", () => reject(new Error("No se pudo preparar la foto.")));
      image.src = dataUrl;
    });
  }

  function openProfileAvatarCrop(dataUrl, fileType, image) {
    profileAvatarCropState = {
      dataUrl,
      fileType,
      image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      drag: null
    };

    if (dom.profileAvatarCropImage) {
      dom.profileAvatarCropImage.src = dataUrl;
    }
    if (dom.profileAvatarCropZoom) {
      dom.profileAvatarCropZoom.value = "1";
    }
    syncProfileAvatarCropImage();
    setProfileAvatarCropOpen(true);
  }

  function renderCroppedProfileAvatar() {
    if (!profileAvatarCropState) {
      return "";
    }

    const state = profileAvatarCropState;
    const canvas = document.createElement("canvas");
    canvas.width = PROFILE_AVATAR_CROP_SIZE;
    canvas.height = PROFILE_AVATAR_CROP_SIZE;
    const context = canvas.getContext("2d");
    if (!context) {
      return "";
    }

    const previewSize = getProfileAvatarCropPreviewSize();
    const outputRatio = PROFILE_AVATAR_CROP_SIZE / previewSize;
    const scale = PROFILE_AVATAR_CROP_SIZE / Math.min(state.width, state.height) * state.zoom;
    const scaledWidth = state.width * scale;
    const scaledHeight = state.height * scale;
    const rawDx = (PROFILE_AVATAR_CROP_SIZE - scaledWidth) / 2 + state.offsetX * outputRatio;
    const rawDy = (PROFILE_AVATAR_CROP_SIZE - scaledHeight) / 2 + state.offsetY * outputRatio;
    // La imagen debe cubrir todo el canvas: cualquier franja descubierta queda
    // negra al exportar a JPEG y se ve como pixeles sueltos en el avatar.
    const dx = Math.min(0, Math.max(PROFILE_AVATAR_CROP_SIZE - scaledWidth, rawDx));
    const dy = Math.min(0, Math.max(PROFILE_AVATAR_CROP_SIZE - scaledHeight, rawDy));
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(state.image, dx, dy, scaledWidth, scaledHeight);

    return canvas.toDataURL("image/jpeg", 0.88);
  }

  function renderProfileAvatarPreview(avatarUrl = "") {
    if (!dom.profileAvatarPreview) {
      return;
    }

    dom.profileAvatarPreview.textContent = "";
    if (avatarUrl) {
      const image = document.createElement("img");
      image.src = avatarUrl;
      image.alt = "";
      image.width = 232;
      image.height = 232;
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

      if (file.size > PROFILE_AVATAR_SOURCE_MAX_BYTES) {
        reject(new Error("La foto no puede superar 8 MB."));
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
      const image = await loadProfileAvatarImage(dataUrl);
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (width && height && width !== height) {
        openProfileAvatarCrop(dataUrl, file.type, image);
        return;
      }

      setProfileAvatarSelection(dataUrl);
    } catch (error) {
      if (dom.profileAvatarInput) {
        dom.profileAvatarInput.value = "";
        dom.profileAvatarInput.dataset.selectedAvatarDataUrl = "";
        dom.profileAvatarInput.dataset.removeAvatar = "false";
      }
      closeProfileAvatarCrop({ clearInput: false });
      renderProfileAvatarPreview(dom.profileAvatarInput?.dataset?.renderedAvatarUrl || "");
      handlers.flashTitle(error?.message || "No se pudo cargar la foto");
    }
  }

  function toggleProfileSection(section) {
    const sectionNode = section === "name" ? dom.profileNameSection : dom.profileDescriptionSection;
    const isEditing = sectionNode?.dataset?.editing === "true";
    setProfileSectionEditing(dom, section, !isEditing);
    if (isEditing) {
      if (section === "name") {
        dom.profileNameEditButton?.focus?.();
      } else if (section === "description") {
        dom.profileDescriptionEditButton?.focus?.();
      }
      return;
    }

    if (section === "name") {
      dom.profileNameInput?.focus?.();
      dom.profileNameInput?.select?.();
      return;
    }
    if (section === "description") {
      dom.profileDescriptionInput?.focus?.();
    }
  }

  function toggleProfileVisibility(button) {
    if (!button) {
      return;
    }
    const nextVisible = button.dataset.visible !== "false" ? false : true;
    button.dataset.visible = String(nextVisible);
    button.setAttribute("aria-pressed", String(!nextVisible));
    const label = button.dataset.profileVisibility === "joinedAt"
      ? "fecha de registro"
      : button.dataset.profileVisibility === "social"
        ? "redes sociales"
        : button.dataset.profileVisibility === "indexable"
          ? "perfil en buscadores"
          : "descripción";
    button.setAttribute("aria-label", nextVisible ? `Ocultar ${label}` : `Mostrar ${label}`);
    button.innerHTML = nextVisible
      ? `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="3"/></svg>`
      : `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 3l18 18"/><path d="M10.6 10.6A3 3 0 0 0 12 15a3 3 0 0 0 2.4-1.2"/><path d="M9.9 5.3A10.8 10.8 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-2.3 3.2"/><path d="M6.2 6.8A16.6 16.6 0 0 0 2.5 12s3.5 7 9.5 7a10 10 0 0 0 4.1-.9"/></svg>`;
  }
  addListener(dom.profileNameEditButton, "click", () => toggleProfileSection("name"));
  addListener(dom.profileDescriptionEditButton, "click", () => toggleProfileSection("description"));
  addListener(dom.profileDescriptionVisibilityButton, "click", () => toggleProfileVisibility(dom.profileDescriptionVisibilityButton));
  addListener(dom.profileJoinedAtVisibilityButton, "click", () => toggleProfileVisibility(dom.profileJoinedAtVisibilityButton));
  addListener(dom.profileIndexableVisibilityButton, "click", () => toggleProfileVisibility(dom.profileIndexableVisibilityButton));
  addListener(dom.profileSocialVisibilityButton, "click", () => toggleProfileVisibility(dom.profileSocialVisibilityButton));
  dom.profileSocialSection?.querySelectorAll?.("[data-profile-social-edit]")?.forEach((button) => {
    addListener(button, "click", () => {
      const field = button.closest(".profile-modal__social-field");
      const isEditing = field?.dataset?.editing === "true";
      setSocialFieldEditing(field, !isEditing);
      if (!isEditing) {
        const input = field?.querySelector?.("input");
        input?.focus?.();
        input?.select?.();
      } else {
        button.focus();
      }
    });
  });
  addListener(dom.profileNameInput, "input", () => {
    dom.profileNameInput?.removeAttribute?.("aria-invalid");
    if (dom.profileNameFeedback) {
      dom.profileNameFeedback.textContent = "";
      dom.profileNameFeedback.hidden = true;
    }
  });
  addListener(dom.profileUsernameInput, "input", () => {
    dom.profileUsernameInput?.removeAttribute?.("aria-invalid");
    if (dom.profileUsernameFeedback) {
      dom.profileUsernameFeedback.textContent = "";
      dom.profileUsernameFeedback.hidden = true;
    }
  });
  addListener(dom.profileAvatarInput, "change", () => {
    void syncProfileAvatarPreview();
  });
  const openProfileAvatarPicker = () => {
    dom.profileAvatarInput?.click?.();
  };

  addListener(dom.profileAvatarPickButton, "click", openProfileAvatarPicker);
  addListener(dom.profileAvatarPreview, "click", openProfileAvatarPicker);
  addListener(dom.profileAvatarClearButton, "click", () => {
    const selectedAvatarDataUrl = dom.profileAvatarInput?.dataset?.selectedAvatarDataUrl || "";
    const renderedAvatarUrl = dom.profileAvatarInput?.dataset?.renderedAvatarUrl || "";

    closeProfileAvatarCrop();
    if (dom.profileAvatarInput) {
      dom.profileAvatarInput.value = "";
      dom.profileAvatarInput.dataset.selectedAvatarDataUrl = "";
      dom.profileAvatarInput.dataset.removeAvatar = selectedAvatarDataUrl ? "false" : String(Boolean(renderedAvatarUrl));
    }

    renderProfileAvatarPreview(selectedAvatarDataUrl ? renderedAvatarUrl : "");
  });
  addListener(dom.profileAvatarCropCancelButton, "click", () => {
    closeProfileAvatarCrop();
    renderProfileAvatarPreview(dom.profileAvatarInput?.dataset?.selectedAvatarDataUrl || dom.profileAvatarInput?.dataset?.renderedAvatarUrl || "");
  });
  addListener(dom.profileAvatarCropApplyButton, "click", () => {
    const dataUrl = renderCroppedProfileAvatar();
    if (!dataUrl) {
      handlers.flashTitle("No se pudo ajustar la foto");
      return;
    }

    setProfileAvatarSelection(dataUrl);
    closeProfileAvatarCrop({ clearInput: false });
  });
  addListener(dom.profileAvatarCropBackdrop, "click", (event) => {
    if (event.target === dom.profileAvatarCropBackdrop) {
      closeProfileAvatarCrop();
      renderProfileAvatarPreview(dom.profileAvatarInput?.dataset?.selectedAvatarDataUrl || dom.profileAvatarInput?.dataset?.renderedAvatarUrl || "");
    }
  });
  addListener(dom.profileAvatarCropZoom, "input", () => {
    if (!profileAvatarCropState) {
      return;
    }
    profileAvatarCropState.zoom = Number.parseFloat(dom.profileAvatarCropZoom?.value || "1") || 1;
    syncProfileAvatarCropImage();
  });
  addListener(dom.profileAvatarCropFrame, "pointerdown", (event) => {
    if (!profileAvatarCropState) {
      return;
    }
    profileAvatarCropState.drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: profileAvatarCropState.offsetX,
      offsetY: profileAvatarCropState.offsetY
    };
    dom.profileAvatarCropFrame?.setPointerCapture?.(event.pointerId);
  });
  addListener(dom.profileAvatarCropFrame, "pointermove", (event) => {
    const drag = profileAvatarCropState?.drag;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    profileAvatarCropState.offsetX = drag.offsetX + event.clientX - drag.startX;
    profileAvatarCropState.offsetY = drag.offsetY + event.clientY - drag.startY;
    syncProfileAvatarCropImage();
  });
  addListener(dom.profileAvatarCropFrame, "pointerup", (event) => {
    if (profileAvatarCropState?.drag?.pointerId === event.pointerId) {
      profileAvatarCropState.drag = null;
    }
  });
  addListener(dom.profileAvatarCropFrame, "pointercancel", () => {
    if (profileAvatarCropState) {
      profileAvatarCropState.drag = null;
    }
  });
  addListener(dom.profileModal?.querySelector?.("#profileForm") ?? null, "submit", (event) => {
    resetSocialEditing(dom);
    handlers.saveProfile(event);
  });
  addListener(dom.paletteModalBackdrop, "click", (event) => {
    if (event.target === dom.paletteModalBackdrop) {
      dismissPaletteModal();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    pickerPointerStartedInside = isCustomPickerEventTarget(event.target);
  }, true);
  document.addEventListener("click", (event) => {
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
  }, true);
  addListener(dom.paletteOptionGrid, "click", (event) => {
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
      const applied = handlers.updateCustomPaletteHex(target.value, { focus: false });
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
        const applied = handlers.updateCustomPaletteHex(nextValue, { render: false, focus: false });
        if (applied) {
          target.dataset.lastValid = nextValue;
        }
      }
    }
  });
  addListener(dom.createTopicButton, "click", handlers.createNewTopic);
}
