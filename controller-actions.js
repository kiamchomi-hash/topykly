import { createChatActions } from "./controller-chat-actions.js";
import { createRankingActions } from "./controller-ranking-actions.js";
import { api } from "./services/api.js?v=20260702-sessioncookie";
import { dispatch, reducers } from "./store-logic.js";
import {
  applyPaletteToDocument,
  CUSTOM_PALETTE_ID,
  DEFAULT_CUSTOM_PALETTE_HEX,
  DEFAULT_PALETTE_ID,
  isPaletteId,
  normalizeHexColor,
  parseHexColor,
  updateDocumentFavicon
} from "./palettes.js";

function focusPaletteOption(dom, paletteId) {
  dom.paletteOptionGrid
    ?.querySelector(`[data-palette-option="${paletteId}"]`)
    ?.focus();
}

function hslToHex(hue, saturation, lightness) {
  const h = hue / 360;
  const s = saturation / 100;
  const l = lightness / 100;

  const hueToRgb = (p, q, t) => {
    let value = t;
    if (value < 0) {
      value += 1;
    }
    if (value > 1) {
      value -= 1;
    }
    if (value < 1 / 6) {
      return p + (q - p) * 6 * value;
    }
    if (value < 1 / 2) {
      return q;
    }
    if (value < 2 / 3) {
      return p + (q - p) * (2 / 3 - value) * 6;
    }
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channels = s === 0
    ? [l, l, l]
    : [
        hueToRgb(p, q, h + 1 / 3),
        hueToRgb(p, q, h),
        hueToRgb(p, q, h - 1 / 3)
      ];

  return `#${channels
    .map((channel) => Math.round(channel * 255).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

function createRandomPaletteHex() {
  const hue = Math.floor(Math.random() * 360);
  const saturation = 56 + Math.floor(Math.random() * 20);
  const lightness = 42 + Math.floor(Math.random() * 12);
  return hslToHex(hue, saturation, lightness);
}

function isInputLike(node) {
  if (typeof HTMLInputElement !== "undefined") {
    return node instanceof HTMLInputElement;
  }

  return Boolean(node && typeof node === "object" && "value" in node && "dataset" in node);
}

function isStyleHost(node) {
  if (typeof HTMLElement !== "undefined") {
    return node instanceof HTMLElement;
  }

  return Boolean(node && typeof node === "object" && node.style && typeof node.style.setProperty === "function");
}

export function createActionHandlers({
  state,
  dom,
  renderRef,
  syncResponsiveView,
  isMobileViewport,
  closeDrawers
}) {
  let syncAuthUiRef = () => {};
  let feedbackTimer = 0;

  function render() {
    renderRef.current();
  }

  function flashTitle(text) {
    showFeedback(text, { kind: "info" });
  }

  function showFeedback(message, { kind = "info", durationMs = 3600 } = {}) {
    const normalized = String(message || "").trim();
    if (!normalized) {
      return;
    }

    if (feedbackTimer) {
      clearTimeout(feedbackTimer);
    }

    dispatch(state, reducers.setFeedback, {
      id: Date.now(),
      message: normalized,
      kind
    });
    render();

    feedbackTimer = setTimeout(() => {
      dispatch(state, reducers.setFeedback, null);
      feedbackTimer = 0;
      render();
    }, durationMs);
    feedbackTimer.unref?.();
  }

  async function getAuthStatus() {
    return api.getAuthStatus();
  }

  async function login({ turnstileToken = "" } = {}) {
    const result = await api.login(state.selectedTopicId, { turnstileToken });
    if (result?.redirected) {
      return result;
    }

    dispatch(state, reducers.hydrateFromBackend, result);
    render();
    return result;
  }

  async function logout() {
    const payload = await api.logout(state.selectedTopicId);
    dispatch(state, reducers.hydrateFromBackend, payload);
    render();
    return payload;
  }

  function openProfileModal() {
    dispatch(state, reducers.setProfileModalOpen, true);
    render();
    setTimeout(() => dom.profileNameInput?.focus?.(), 0);
  }

  async function openAdminPanel() {
    dispatch(state, reducers.setAdminPanelOpen, true);
    dispatch(state, reducers.setAdminDashboard, { loaded: false, reports: [], pendingAvatars: [] });
    render();

    try {
      const dashboard = await api.getAdminDashboard();
      dispatch(state, reducers.setAdminDashboard, { ...dashboard, loaded: true });
    } catch (error) {
      console.error(error);
      showFeedback(error?.message || "No se pudo cargar administracion.", { kind: "error" });
      dispatch(state, reducers.setAdminDashboard, { loaded: true, reports: [], pendingAvatars: [] });
    }
    render();
  }

  function closeAdminPanel() {
    dispatch(state, reducers.setAdminPanelOpen, false);
    render();
    dom.adminPanelButton?.focus?.();
  }

  async function applyAdminAction(actionType, targetType, targetId) {
    try {
      await api.applyModerationAction(actionType, targetType, targetId, "", state.selectedTopicId);
      const dashboard = await api.getAdminDashboard();
      dispatch(state, reducers.setAdminDashboard, { ...dashboard, loaded: true });
      showFeedback(actionType === "approve_avatar" ? "Foto aprobada" : "Foto rechazada");
    } catch (error) {
      console.error(error);
      showFeedback(error?.message || "No se pudo aplicar la accion.", { kind: "error" });
    }
    render();
  }
  function closeProfileModal() {
    dispatch(state, reducers.setProfileModalOpen, false);
    render();
    dom.profileButton?.focus?.();
  }

  async function saveProfile(event) {
    event?.preventDefault?.();
    const displayName = dom.profileNameInput?.value?.trim() || null;
    const avatarDataUrl = dom.profileAvatarInput?.dataset?.selectedAvatarDataUrl || null;
    const removeAvatar = dom.profileAvatarInput?.dataset?.removeAvatar === "true";

    if (dom.saveProfileButton) {
      dom.saveProfileButton.disabled = true;
      dom.saveProfileButton.setAttribute("aria-busy", "true");
    }

    try {
      const payload = await api.updateProfile({
        displayName,
        avatarDataUrl,
        removeAvatar,
        selectedTopicId: state.selectedTopicId
      });
      dispatch(state, reducers.hydrateFromBackend, payload);
      dispatch(state, reducers.setProfileModalOpen, false);
      showFeedback(avatarDataUrl ? "Perfil actualizado. La foto queda pendiente de revision." : removeAvatar ? "Perfil actualizado. Foto eliminada." : "Perfil actualizado");
      return payload;
    } catch (error) {
      console.error(error);
      showFeedback(error?.message || "No se pudo actualizar el perfil.", { kind: "error" });
      return null;
    } finally {
      if (dom.saveProfileButton) {
        dom.saveProfileButton.disabled = false;
        dom.saveProfileButton.setAttribute("aria-busy", "false");
      }
      render();
    }
  }

  function applyPalette() {
    if (typeof document === "undefined") {
      return;
    }

    applyPaletteToDocument(
      document.documentElement,
      state.theme,
      state.paletteId || DEFAULT_PALETTE_ID,
      state.customPaletteHex || DEFAULT_CUSTOM_PALETTE_HEX
    );
    updateDocumentFavicon(
      document,
      state.theme,
      state.paletteId || DEFAULT_PALETTE_ID,
      state.customPaletteHex || DEFAULT_CUSTOM_PALETTE_HEX
    );
  }

  function persistPaletteState() {
    if (typeof localStorage === "undefined") {
      return;
    }

    localStorage.setItem("topykly-palette", state.paletteId);
    if (state.paletteId === CUSTOM_PALETTE_ID) {
      localStorage.setItem("topykly-custom-palette-hex", state.customPaletteHex || DEFAULT_CUSTOM_PALETTE_HEX);
    }
  }

  function syncCustomPaletteControls(hexValue) {
    const normalized = normalizeHexColor(hexValue, state.customPaletteHex || DEFAULT_CUSTOM_PALETTE_HEX);

    dom.paletteOptionGrid
      ?.querySelectorAll("[data-custom-palette-hex]")
      ?.forEach((input) => {
        if (!isInputLike(input)) {
          return;
        }
        input.value = normalized;
        input.defaultValue = normalized;
        input.dataset.lastValid = normalized;
      });

    dom.paletteOptionGrid
      ?.querySelectorAll("[data-custom-palette-picker]")
      ?.forEach((input) => {
        if (isInputLike(input)) {
          input.value = normalized;
        }
      });

    dom.paletteOptionGrid
      ?.querySelectorAll(".palette-option__color-preview")
      ?.forEach((preview) => {
        if (isStyleHost(preview)) {
          preview.style.setProperty("--palette-custom-preview", normalized);
        }
      });
  }

  function toggleTheme() {
    dispatch(state, reducers.setTheme, state.theme === "light" ? "dark" : "light");
    applyPalette();
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("topykly-theme", state.theme);
    }
    render();
  }

  function openPaletteModal() {
    if (state.isPaletteModalOpen) {
      return;
    }

    state.isPaletteModalOpen = true;
    render();
    focusPaletteOption(dom, state.paletteId);
  }

  function closePaletteModal() {
    if (!state.isPaletteModalOpen) {
      return;
    }

    state.isPaletteModalOpen = false;
    render();
    const focusTarget = isMobileViewport() ? dom.openRightDrawer : dom.paletteButton;
    focusTarget?.focus?.();
  }

  function selectPalette(paletteId) {
    if (!isPaletteId(paletteId)) {
      return;
    }

    dispatch(state, reducers.setPalette, { paletteId: paletteId || DEFAULT_PALETTE_ID });
    applyPalette();
    persistPaletteState();
    render();
    focusPaletteOption(dom, state.paletteId);
  }

  function ensureCustomPaletteActive() {
    if (state.paletteId === CUSTOM_PALETTE_ID) {
      return false;
    }

    state.paletteId = CUSTOM_PALETTE_ID;
    applyPalette();
    persistPaletteState();
    render();
    return true;
  }

  function updateCustomPaletteHex(nextHexValue, options = {}) {
    const { render: shouldRender = true, focus: shouldFocus = true } = options;
    const parsedHex = parseHexColor(nextHexValue);
    if (!parsedHex) {
      return false;
    }

    state.customPaletteHex = normalizeHexColor(parsedHex, state.customPaletteHex || DEFAULT_CUSTOM_PALETTE_HEX);
    state.paletteId = CUSTOM_PALETTE_ID;
    applyPalette();
    persistPaletteState();
    if (shouldRender) {
      render();
      if (shouldFocus) {
        focusPaletteOption(dom, state.paletteId);
      }
    } else {
      syncCustomPaletteControls(state.customPaletteHex);
    }
    return true;
  }

  function randomizeCustomPalette() {
    return updateCustomPaletteHex(createRandomPaletteHex());
  }

  function activateConnectedUser(userId, action = "item") {
    const targetUser = state.users.find((user) => user.id === userId);
    if (!targetUser) {
      return;
    }

    dispatch(state, reducers.setActiveUser, userId);
    render();

    if (action === "profile") {
      flashTitle(`Perfil de ${targetUser.name} listo para conectar`);
      return;
    }

    if (action === "message") {
      flashTitle(`Mensaje directo con ${targetUser.name} listo para conectar`);
      return;
    }

    flashTitle(`${targetUser.name} seleccionado`);
  }

  const rankingActions = createRankingActions({
    state,
    isMobileViewport,
    syncResponsiveView,
    render
  });

  const chatActions = createChatActions({
    state,
    dom,
    render
  });

  return {
    state,
    syncResponsiveView,
    setAuthUiSync(fn) {
      syncAuthUiRef = typeof fn === "function" ? fn : () => {};
    },
    syncAuthUi() {
      syncAuthUiRef();
    },
    getAuthStatus,
    login,
    logout,
    flashTitle,
    showFeedback,
    openProfileModal,
    closeProfileModal,
    openAdminPanel,
    closeAdminPanel,
    applyAdminAction,
    saveProfile,
    toggleTheme,
    setRankingScope: rankingActions.setRankingScope,
    toggleRankingScope: rankingActions.toggleRankingScope,
    focusTopic: rankingActions.focusTopic,
    setRankingStep: rankingActions.setRankingStep,
    selectRankingStep: rankingActions.selectRankingStep,
    createNewTopic: chatActions.createNewTopic,
    submitMessage: chatActions.submitMessage,
    refreshCurrentTopic: chatActions.refreshCurrentTopic,
    reportEntity: chatActions.reportEntity,
    openPaletteModal,
    closePaletteModal,
    selectPalette,
    ensureCustomPaletteActive,
    updateCustomPaletteHex,
    randomizeCustomPalette,
    activateConnectedUser,
    closeDrawers
  };
}
