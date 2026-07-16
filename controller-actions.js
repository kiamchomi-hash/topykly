import { createChatActions } from "./controller-chat-actions.js";
import { createRankingActions } from "./controller-ranking-actions.js";
import { api } from "./services/api.js?v=20260709-topicrace1";
import { dispatch, reducers } from "./store-logic.js?v=20260709-topicrace1";
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
import { getWebNotificationPermission, requestWebNotificationPermission } from "./ui/notifications.js";

const ADMIN_ACTION_FEEDBACK = {
  approve_avatar: "Foto aprobada",
  reject_avatar: "Foto rechazada",
  delete_message: "Comentario eliminado",
  dismiss_report: "Reporte descartado",
  block_topic: "Tema bloqueado",
  expel_user: "Sancion progresiva aplicada",
  restore_user: "Sancion anulada; el usuario recupero el acceso"
};

const DESTRUCTIVE_ADMIN_ACTIONS = new Set(["delete_message", "block_topic", "expel_user", "restore_user"]);
const ADMIN_CONFIRM_WINDOW_MS = 4000;

export function clearDocumentTextSelection(selection = globalThis.getSelection?.()) {
  selection?.removeAllRanges?.();
}

function focusPaletteOption(dom, paletteId) {
  dom.paletteOptionGrid
    ?.querySelector(`[data-palette-option="${paletteId}"]`)
    ?.focus();
}

function resetPaletteModalScroll(dom) {
  const body = dom.paletteModal?.querySelector(".palette-modal__body");
  if (!body) {
    return;
  }

  body.scrollTop = 0;
  body.scrollLeft = 0;
}

function focusPaletteModalStart(dom) {
  try {
    dom.paletteModal?.focus?.({ preventScroll: true });
  } catch {
    dom.paletteModal?.focus?.();
  }

  resetPaletteModalScroll(dom);
  globalThis.requestAnimationFrame?.(() => resetPaletteModalScroll(dom));
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

export function createActionHandlers({
  state,
  dom,
  renderRef,
  syncResponsiveView,
  isMobileViewport,
  closeDrawers,
  apiClient = api,
  onLiveSyncPreferenceChange = null
}) {
  let syncAuthUiRef = () => {};
  let openOidcProfileCompletionRef = () => {};
  let feedbackTimer = 0;
  let adminConfirmTimer = 0;
  dispatch(state, reducers.setWebNotificationsPermission, getWebNotificationPermission());

  function render() {
    renderRef.current();
  }

  function flashTitle(text) {
    showFeedback(text, { kind: "info" });
  }

  function trackProductEvent(eventName, routeGroup = null) {
    return Promise.resolve(apiClient.trackProductEvent?.(eventName, routeGroup) ?? null)
      .catch(() => null);
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

  async function enableWebNotifications() {
    const permission = await requestWebNotificationPermission();
    dispatch(state, reducers.setWebNotificationsPermission, permission);
    if (permission === "granted") {
      showFeedback("Notificaciones del navegador activadas.");
    } else if (permission === "denied") {
      showFeedback("Las notificaciones estan bloqueadas en el navegador.", { kind: "error" });
    } else if (permission === "unsupported") {
      showFeedback("Este navegador no soporta notificaciones.", { kind: "error" });
    }
    render();
    return permission;
  }

  function resolveSelectedTopicId(selectedTopicId = null) {
    return selectedTopicId ?? state.selectedTopicId;
  }

  async function login({ turnstileToken = "", selectedTopicId = null } = {}) {
    const result = await api.login(resolveSelectedTopicId(selectedTopicId), { turnstileToken });
    if (result?.redirected) {
      return result;
    }

    dispatch(state, reducers.mergeLiveTopics, result);
    void trackProductEvent("login_complete");
    render();
    return result;
  }

  async function loginWithPassword({ email, password, turnstileToken = "", selectedTopicId = null } = {}) {
    const result = await api.loginWithPassword({
      email,
      password,
      turnstileToken,
      selectedTopicId: resolveSelectedTopicId(selectedTopicId)
    });
    dispatch(state, reducers.mergeLiveTopics, result);
    void trackProductEvent("login_complete");
    render();
    return result;
  }

  async function requestEmailAuthCode({
    email,
    nickname = "",
    age = null,
    password = "",
    acceptedTerms = false,
    termsVersion = null,
    turnstileToken = ""
  } = {}) {
    return api.requestEmailAuthCode({
      email,
      nickname,
      age,
      password,
      acceptedTerms,
      termsVersion,
      turnstileToken
    });
  }

  async function verifyEmailAuthCode({ challengeId, code, selectedTopicId = null } = {}) {
    const result = await api.verifyEmailAuthCode({
      challengeId,
      code,
      selectedTopicId: resolveSelectedTopicId(selectedTopicId)
    });
    dispatch(state, reducers.mergeLiveTopics, result);
    void trackProductEvent("registration_complete");
    render();
    return result;
  }

  async function requestPasswordResetCode({ email, turnstileToken = "" } = {}) {
    return api.requestPasswordResetCode({ email, turnstileToken });
  }

  async function confirmPasswordReset({ challengeId, code, newPassword, selectedTopicId = null } = {}) {
    const result = await api.confirmPasswordReset({
      challengeId,
      code,
      newPassword,
      selectedTopicId: resolveSelectedTopicId(selectedTopicId)
    });
    dispatch(state, reducers.mergeLiveTopics, result);
    render();
    return result;
  }

  async function startAccountLink({ password, turnstileToken = "", selectedTopicId = null } = {}) {
    return api.startAccountLink({
      password,
      turnstileToken,
      selectedTopicId: resolveSelectedTopicId(selectedTopicId)
    });
  }

  async function logout() {
    const payload = await api.logout(state.selectedTopicId);
    dispatch(state, reducers.mergeLiveTopics, payload);
    render();
    return payload;
  }

  function openProfileModal() {
    if (state.viewer?.profilePending) {
      openOidcProfileCompletionRef();
      return;
    }
    dispatch(state, reducers.setProfileModalOpen, true);
    render();
    if (dom.profileModal) {
      dom.profileModal.scrollTop = 0;
    }
    setTimeout(() => {
      try {
        dom.profileNameEditButton?.focus?.({ preventScroll: true });
      } catch {
        dom.profileNameEditButton?.focus?.();
      }
      if (dom.profileModal) {
        dom.profileModal.scrollTop = 0;
      }
    }, 0);
  }

  async function openAdminPanel() {
    dispatch(state, reducers.setProfileModalOpen, false);
    dispatch(state, reducers.setAdminPanelOpen, true);
    dispatch(state, reducers.setAdminDashboard, {
      loaded: false,
      reports: [],
      pendingAvatars: [],
      activeSanctions: [],
      productAnalytics: null
    });
    render();

    try {
      const dashboard = await api.getAdminDashboard();
      dispatch(state, reducers.setAdminDashboard, { ...dashboard, loaded: true });
    } catch (error) {
      console.error(error);
      showFeedback(error?.message || "No se pudo cargar administración.", { kind: "error" });
      dispatch(state, reducers.setAdminDashboard, {
        loaded: true,
        reports: [],
        pendingAvatars: [],
        activeSanctions: [],
        productAnalytics: null
      });
    }
    render();
  }

  function closeAdminPanel() {
    if (adminConfirmTimer) {
      clearTimeout(adminConfirmTimer);
      adminConfirmTimer = 0;
    }
    dispatch(state, reducers.setAdminPanelOpen, false);
    dispatch(state, reducers.setAdminConfirmAction, null);
    render();
    dom.adminPanelButton?.focus?.();
  }

  function setAdminSection(adminSection) {
    if (!["analytics", "reports", "avatars", "sanctions"].includes(adminSection)) {
      return;
    }
    dispatch(state, reducers.setAdminSection, adminSection);
    dispatch(state, reducers.setAdminConfirmAction, null);
    render();
  }

  function closePublicProfileModal() {
    dispatch(state, reducers.setPublicProfileUser, null);
    render();
  }

  function requestUserBlock(userId = state.publicProfileUserId) {
    const targetUser = state.users.find((user) => user.id === userId);
    if (
      !targetUser
      || targetUser.type !== "registered"
      || state.viewer?.type !== "registered"
      || targetUser.id === state.viewer.id
    ) {
      return;
    }
    if (state.publicProfileUserId !== targetUser.id) {
      dispatch(state, reducers.setPublicProfileUser, targetUser.id);
    }
    dispatch(state, reducers.setPublicProfileBlockHideContent, true);
    dispatch(state, reducers.setPublicProfileBlockConfirming, true);
    render();
    setTimeout(() => dom.publicProfileHideContentToggle?.focus?.(), 0);
  }

  function cancelUserBlock() {
    dispatch(state, reducers.setPublicProfileBlockConfirming, false);
    render();
    dom.publicProfileBlockButton?.focus?.();
  }

  function setPublicProfileBlockHideContent(hideContent) {
    dispatch(state, reducers.setPublicProfileBlockHideContent, Boolean(hideContent));
    render();
  }

  async function blockUser(userId, hideContent = true) {
    if (!userId || state.blockedUserActionPending) {
      return null;
    }
    state.blockedUserActionPending = userId;
    render();
    try {
      const payload = await api.blockUser(userId, hideContent, state.selectedTopicId);
      dispatch(state, reducers.mergeLiveTopics, payload);
      dispatch(state, reducers.setPublicProfileBlockConfirming, false);
      showFeedback(hideContent ? "Cuenta bloqueada y contenido oculto." : "Cuenta bloqueada.");
      return payload;
    } catch (error) {
      console.error(error);
      showFeedback(error?.message || "No se pudo bloquear la cuenta.", { kind: "error" });
      return null;
    } finally {
      state.blockedUserActionPending = null;
      render();
    }
  }

  async function updateBlockedUser(userId, hideContent) {
    if (!userId || state.blockedUserActionPending) {
      return null;
    }
    state.blockedUserActionPending = userId;
    render();
    try {
      const payload = await api.updateBlockedUser(userId, hideContent, state.selectedTopicId);
      dispatch(state, reducers.mergeLiveTopics, payload);
      showFeedback(hideContent ? "Contenido de la cuenta oculto." : "Contenido de la cuenta visible.");
      return payload;
    } catch (error) {
      console.error(error);
      showFeedback(error?.message || "No se pudo actualizar el bloqueo.", { kind: "error" });
      return null;
    } finally {
      state.blockedUserActionPending = null;
      render();
    }
  }

  async function unblockUser(userId) {
    if (!userId || state.blockedUserActionPending) {
      return null;
    }
    state.blockedUserActionPending = userId;
    render();
    try {
      const payload = await api.unblockUser(userId, state.selectedTopicId);
      dispatch(state, reducers.mergeLiveTopics, payload);
      dispatch(state, reducers.setPublicProfileBlockConfirming, false);
      showFeedback("Cuenta desbloqueada.");
      return payload;
    } catch (error) {
      console.error(error);
      showFeedback(error?.message || "No se pudo desbloquear la cuenta.", { kind: "error" });
      return null;
    } finally {
      state.blockedUserActionPending = null;
      render();
    }
  }

  async function applyAdminAction(actionType, targetType, targetId) {
    if (DESTRUCTIVE_ADMIN_ACTIONS.has(actionType)) {
      const confirmKey = `${actionType}:${targetType}:${targetId}`;
      const pending = state.adminConfirmAction;
      const now = Date.now();

      if (!pending || pending.key !== confirmKey || pending.until < now) {
        if (adminConfirmTimer) {
          clearTimeout(adminConfirmTimer);
        }
        dispatch(state, reducers.setAdminConfirmAction, { key: confirmKey, until: now + ADMIN_CONFIRM_WINDOW_MS });
        render();
        adminConfirmTimer = setTimeout(() => {
          dispatch(state, reducers.setAdminConfirmAction, null);
          adminConfirmTimer = 0;
          render();
        }, ADMIN_CONFIRM_WINDOW_MS);
        adminConfirmTimer.unref?.();
        return;
      }

      clearTimeout(adminConfirmTimer);
      adminConfirmTimer = 0;
      dispatch(state, reducers.setAdminConfirmAction, null);
    }

    const banHours = actionType === "expel_user" ? "progressive" : null;

    try {
      await api.applyModerationAction(actionType, targetType, targetId, "", state.selectedTopicId, banHours);
      const dashboard = await api.getAdminDashboard();
      dispatch(state, reducers.setAdminDashboard, { ...dashboard, loaded: true });
      showFeedback(ADMIN_ACTION_FEEDBACK[actionType] || "Accion aplicada");
    } catch (error) {
      console.error(error);
      showFeedback(error?.message || "No se pudo aplicar la acción.", { kind: "error" });
    }
    render();
  }
  function closeProfileModal() {
    dispatch(state, reducers.setProfileModalOpen, false);
    render();
    dom.profileButton?.focus?.();
  }

  function openSettingsModal() {
    dispatch(state, reducers.setSettingsModalOpen, true);
    render();
    const settingsWorkspace = dom.settingsModal?.querySelector?.(".settings-panel__workspace");
    if (settingsWorkspace) {
      settingsWorkspace.scrollTop = 0;
    }
    setTimeout(() => {
      dom.settingsModal?.focus?.();
      if (settingsWorkspace) {
        settingsWorkspace.scrollTop = 0;
      }
    }, 0);
  }

  function closeSettingsModal() {
    dispatch(state, reducers.setSettingsModalOpen, false);
    render();
    dom.settingsButton?.focus?.();
  }

  function setSettingsSection(settingsSection) {
    if (!["privacy", "experience", "blocks", "account"].includes(settingsSection)) {
      return;
    }
    dispatch(state, reducers.setSettingsSection, settingsSection);
    render();
    const workspace = dom.settingsModal?.querySelector?.(".settings-panel__workspace");
    if (workspace) {
      workspace.scrollTop = 0;
    }
  }

  const SETTING_FEEDBACK = {
    likesAnonymous: {
      on: "Tus likes ahora son anónimos.",
      off: "Tus likes ahora muestran tu nombre."
    },
    filterProfanity: {
      on: "Filtro de insultos activado.",
      off: "Filtro de insultos desactivado."
    },
    notificationsFriendsOnly: {
      on: "Solo verás notificaciones de tus amigos.",
      off: "Verás notificaciones de toda la actividad."
    },
    emailActivityEnabled: {
      on: "Avisos por correo activados.",
      off: "Avisos por correo desactivados."
    },
    slowMode: {
      on: "Modo lento activado.",
      off: "Modo en vivo activado."
    },
    profileIndexable: {
      on: "Tu perfil puede aparecer en buscadores.",
      off: "Tu perfil ya no aparecerá en buscadores."
    }
  };

  async function toggleSetting(settingKey) {
    if (!SETTING_FEEDBACK[settingKey] || state.settingsUpdatePending) {
      return null;
    }

    const nextValue = !state.viewer?.[settingKey];
    state.settingsUpdatePending = true;
    render();

    try {
      const payload = await api.updateSettings({
        [settingKey]: nextValue,
        selectedTopicId: state.selectedTopicId
      });
      dispatch(state, reducers.mergeLiveTopics, payload);
      if (settingKey === "slowMode") {
        onLiveSyncPreferenceChange?.();
      }
      showFeedback(SETTING_FEEDBACK[settingKey][nextValue ? "on" : "off"]);
      return payload;
    } catch (error) {
      console.error(error);
      showFeedback(error?.message || "No se pudo guardar la configuración.", { kind: "error" });
      return null;
    } finally {
      state.settingsUpdatePending = false;
      render();
    }
  }

  function requestAccountDeletion() {
    dispatch(state, reducers.setSettingsDeleteConfirming, true);
    render();
    setTimeout(() => dom.settingsDeleteCancelButton?.focus?.(), 0);
  }

  function cancelAccountDeletion() {
    dispatch(state, reducers.setSettingsDeleteConfirming, false);
    render();
    dom.settingsDeleteAccountButton?.focus?.();
  }

  async function confirmAccountDeletion() {
    if (dom.settingsDeleteConfirmButton) {
      dom.settingsDeleteConfirmButton.disabled = true;
      dom.settingsDeleteConfirmButton.setAttribute("aria-busy", "true");
    }

    try {
      const currentPassword = window.prompt("Confirma tu contrasena para eliminar la cuenta. Si usas Google, vuelve a iniciar sesion recientemente.") || "";
      const payload = await api.deleteAccount(state.selectedTopicId, currentPassword);
      dispatch(state, reducers.mergeLiveTopics, payload);
      dispatch(state, reducers.setSettingsModalOpen, false);
      showFeedback("Tu cuenta fue eliminada.");
      return payload;
    } catch (error) {
      console.error(error);
      showFeedback(error?.message || "No se pudo eliminar la cuenta.", { kind: "error" });
      return null;
    } finally {
      if (dom.settingsDeleteConfirmButton) {
        dom.settingsDeleteConfirmButton.disabled = false;
        dom.settingsDeleteConfirmButton.setAttribute("aria-busy", "false");
      }
      render();
    }
  }


  function setProfileNameFeedback(message = "") {
    const normalized = String(message || "").trim();
    if (dom.profileNameInput) {
      if (normalized) {
        dom.profileNameInput.setAttribute("aria-invalid", "true");
      } else {
        dom.profileNameInput.removeAttribute("aria-invalid");
      }
    }
    if (dom.profileNameFeedback) {
      dom.profileNameFeedback.textContent = normalized;
      dom.profileNameFeedback.hidden = !normalized;
    }
  }

  function setProfileUsernameFeedback(message = "") {
    const normalized = String(message || "").trim();
    if (dom.profileUsernameInput) {
      if (normalized) {
        dom.profileUsernameInput.setAttribute("aria-invalid", "true");
      } else {
        dom.profileUsernameInput.removeAttribute("aria-invalid");
      }
    }
    if (dom.profileUsernameFeedback) {
      dom.profileUsernameFeedback.textContent = normalized;
      dom.profileUsernameFeedback.hidden = !normalized;
    }
  }

  function skipProfileSetup() {
    dispatch(state, reducers.setProfileModalOpen, false);
    render();
    dom.profileButton?.focus?.();
  }

  async function saveProfile(event) {
    event?.preventDefault?.();
    const showSavedFeedback = !event || event.submitter === dom.saveProfileButton;
    const displayName = dom.profileNameInput?.value?.trim() || null;
    const username = dom.profileUsernameInput?.value?.trim() || null;
    const description = dom.profileDescriptionInput?.value?.trim() || "";
    const avatarDataUrl = dom.profileAvatarInput?.dataset?.selectedAvatarDataUrl || null;
    const removeAvatar = dom.profileAvatarInput?.dataset?.removeAvatar === "true";
    const profileShowDescription = dom.profileDescriptionVisibilityButton?.dataset?.visible !== "false";
    const profileShowJoinedAt = dom.profileJoinedAtVisibilityButton?.dataset?.visible !== "false";
    const socialWhatsapp = dom.socialWhatsappInput?.value?.trim() || "";
    const socialInstagram = dom.socialInstagramInput?.value?.trim() || "";
    const socialTiktok = dom.socialTiktokInput?.value?.trim() || "";
    const socialFacebook = dom.socialFacebookInput?.value?.trim() || "";
    const socialTwitter = dom.socialTwitterInput?.value?.trim() || "";
    const socialDiscord = dom.socialDiscordInput?.value?.trim() || "";
    const profileShowSocial = dom.profileSocialVisibilityButton?.dataset?.visible !== "false";

    if (dom.saveProfileButton) {
      dom.saveProfileButton.disabled = true;
      dom.saveProfileButton.setAttribute("aria-busy", "true");
    }

    try {
      setProfileNameFeedback();
      setProfileUsernameFeedback();
      const payload = await api.updateProfile({
        displayName,
        username,
        description,
        profileShowDescription,
        profileShowJoinedAt,
        socialWhatsapp,
        socialInstagram,
        socialTiktok,
        socialFacebook,
        socialTwitter,
        socialDiscord,
        profileShowSocial,
        avatarDataUrl,
        removeAvatar,
        selectedTopicId: state.selectedTopicId
      });
      dispatch(state, reducers.mergeLiveTopics, payload);
      dispatch(state, reducers.setProfileModalOpen, false);
      if (showSavedFeedback) {
        showFeedback(avatarDataUrl ? "Perfil actualizado. La foto queda pendiente de revision." : removeAvatar ? "Perfil actualizado. Foto eliminada." : "Perfil actualizado");
      }
      return payload;
    } catch (error) {
      console.error(error);
      const usernameError = ["NICKNAME_TAKEN", "USERNAME_REQUIRED", "USERNAME_IMMUTABLE"].includes(error?.code);
      const message = error?.code === "NICKNAME_TAKEN"
        ? "Ese username no esta disponible."
        : error?.message || "No se pudo actualizar el perfil.";
      if (usernameError) {
        setProfileUsernameFeedback(message);
      } else if (error?.code === "VALIDATION_ERROR") {
        setProfileNameFeedback(message);
      }
      showFeedback(message, { kind: "error" });
      return null;
    } finally {
      if (dom.saveProfileButton) {
        dom.saveProfileButton.disabled = false;
        dom.saveProfileButton.setAttribute("aria-busy", "false");
      }
      render();
      if (!state.isProfileModalOpen) {
        dom.profileButton?.focus?.();
      }
    }
  }

  async function completeOidcProfile({ username, age = null, acceptedTerms = false, termsVersion = null } = {}) {
    const payload = await api.updateProfile({
      displayName: username,
      username,
      age,
      acceptedTerms,
      termsVersion,
      selectedTopicId: state.selectedTopicId
    });
    dispatch(state, reducers.mergeLiveTopics, payload);
    void trackProductEvent("registration_complete");
    render();
    return payload;
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
    const activeElement = typeof document !== "undefined" ? document.activeElement : null;

    dom.paletteOptionGrid
      ?.querySelectorAll("[data-custom-palette-hex]")
      ?.forEach((input) => {
        if (!isInputLike(input) || input === activeElement) {
          return;
        }
        input.value = normalized;
        input.defaultValue = normalized;
        input.dataset.lastValid = normalized;
      });

    dom.paletteOptionGrid
      ?.querySelectorAll("[data-custom-palette-picker]")
      ?.forEach((input) => {
        if (isInputLike(input) && input !== activeElement) {
          input.value = normalized;
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

  async function openPaletteModal() {
    if (state.isPaletteModalOpen) {
      return;
    }

    state.isPaletteModalOpen = true;
    render();
    focusPaletteModalStart(dom);
    try {
      const { ensureColorisLoaded } = await import("./services/coloris-loader.js");
      await ensureColorisLoaded();
      if (state.isPaletteModalOpen) {
        render();
      }
    } catch (error) {
      console.error(error);
      showFeedback("No se pudo cargar el selector de color.", { kind: "error" });
    }
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

    if (action === "profile") {
      dispatch(state, reducers.setPublicProfileUser, userId);
      render();
      setTimeout(() => dom.publicProfileModal?.focus?.(), 0);
      return;
    }

    render();

    if (action === "friend") {
      sendFriendRequest(userId);
      return;
    }
  }


  function toggleFriendRequestsPanel(forceOpen = null) {
    const nextOpen = forceOpen === null ? !state.isFriendRequestsPanelOpen : Boolean(forceOpen);
    dispatch(state, reducers.setFriendRequestsPanelOpen, nextOpen);
    if (nextOpen) {
      dispatch(state, reducers.setNotificationsPanelOpen, false);
      dispatch(state, reducers.resetFriendRequestsLimits);
      dispatch(state, reducers.setFriendRequestsTab, "incoming");
    }
    render();
  }

  function setFriendRequestsTab(tab) {
    dispatch(state, reducers.setFriendRequestsTab, tab);
    render();
  }

  function loadMoreFriendRequests() {
    const tab = state.friendRequestsTab || "incoming";
    if (tab === "incoming" || tab === "outgoing") {
      const currentLimit = state.friendRequestsLimits?.[tab] || 10;
      const totalItems = state.friendships?.[tab]?.length || 0;
      if (currentLimit < totalItems) {
        dispatch(state, reducers.increaseFriendRequestsLimit, tab);
        render();
      }
    }
  }

  async function sendFriendRequest(userId) {
    try {
      const result = await api.sendFriendRequest(userId, resolveSelectedTopicId());
      dispatch(state, reducers.mergeLiveTopics, result);
      const targetUser = state.users.find((user) => user.id === userId);
      showFeedback(targetUser?.friendshipStatus === "friend" ? "Amistad aceptada." : "Solicitud de amistad enviada.");
      render();
      return result;
    } catch (error) {
      showFeedback(error?.message || "No se pudo enviar la solicitud de amistad.", { kind: "error" });
      return null;
    }
  }

  async function acceptFriendRequest(userId) {
    try {
      const result = await api.acceptFriendRequest(userId, resolveSelectedTopicId());
      dispatch(state, reducers.mergeLiveTopics, result);
      showFeedback("Solicitud de amistad aceptada.");
      render();
      return result;
    } catch (error) {
      showFeedback(error?.message || "No se pudo aceptar la solicitud.", { kind: "error" });
      return null;
    }
  }

  async function rejectFriendRequest(userId) {
    try {
      const result = await api.rejectFriendRequest(userId, resolveSelectedTopicId());
      dispatch(state, reducers.mergeLiveTopics, result);
      showFeedback("Solicitud de amistad rechazada.");
      render();
      return result;
    } catch (error) {
      showFeedback(error?.message || "No se pudo rechazar la solicitud.", { kind: "error" });
      return null;
    }
  }
  const rankingActions = createRankingActions({
    state,
    isMobileViewport,
    syncResponsiveView,
    render
  });


  function toggleNotificationsPanel(forceOpen = null) {
    const nextOpen = forceOpen === null ? !state.isNotificationsPanelOpen : Boolean(forceOpen);
    dispatch(state, reducers.setNotificationsPanelOpen, nextOpen);
    if (nextOpen) {
      dispatch(state, reducers.setFriendRequestsPanelOpen, false);
    }
    render();
  }
  function dismissNotification(notificationId) {
    dispatch(state, reducers.dismissNotification, notificationId);
    render();
  }

  function openNotificationTopic(topicId, notificationId = null) {
    if (!topicId) {
      return;
    }

    if (notificationId) {
      dispatch(state, reducers.markNotificationRead, notificationId);
    }
    focusTopic(topicId);
  }

  function clearMessageComposerDraft() {
    if (!dom.messageInput) {
      return;
    }

    dom.messageInput.value = "";
    dom.messageInput.scrollTop = 0;
    dom.messageInput.classList?.remove?.("is-scrollable");
    if (dom.messageInput.dataset) {
      delete dom.messageInput.dataset.quoteLockLength;
    }
  }

  function focusTopic(topicId) {
    const previousTopicId = state.selectedTopicId || null;
    if ((topicId || null) !== previousTopicId) {
      clearDocumentTextSelection();
    }
    rankingActions.focusTopic(topicId);
    if (topicId && (topicId || null) !== previousTopicId) {
      void trackProductEvent("topic_open", "/tema");
      if (state.viewer?.type === "registered" && typeof apiClient.followTopic === "function") {
        void apiClient.followTopic(topicId, topicId)
          .then((payload) => {
            dispatch(state, reducers.mergeLiveTopics, payload);
            render();
          })
          .catch(() => {});
      }
    }
    if ((topicId || null) !== previousTopicId) {
      clearMessageComposerDraft();
    }
  }

  const chatActions = createChatActions({
    state,
    dom,
    isMobileViewport,
    syncResponsiveView,
    render,
    showFeedback,
    apiClient
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
    setOpenOidcProfileCompletionSync(fn) {
      openOidcProfileCompletionRef = typeof fn === "function" ? fn : () => {};
    },
    completeOidcProfile,
    getAuthStatus,
    login,
    loginWithPassword,
    requestEmailAuthCode,
    verifyEmailAuthCode,
    requestPasswordResetCode,
    confirmPasswordReset,
    startAccountLink,
    logout,
    flashTitle,
    trackProductEvent,
    showFeedback,
    enableWebNotifications,
    toggleFriendRequestsPanel,
    setFriendRequestsTab,
    loadMoreFriendRequests,
    toggleNotificationsPanel,
    acceptFriendRequest,
    rejectFriendRequest,
    dismissNotification,
    openNotificationTopic,
    openProfileModal,
    closeProfileModal,
    openSettingsModal,
    closeSettingsModal,
    setSettingsSection,
    toggleSetting,
    requestAccountDeletion,
    cancelAccountDeletion,
    confirmAccountDeletion,
    skipProfileSetup,
    closePublicProfileModal,
    requestUserBlock,
    cancelUserBlock,
    setPublicProfileBlockHideContent,
    blockUser,
    updateBlockedUser,
    unblockUser,
    openAdminPanel,
    closeAdminPanel,
    setAdminSection,
    applyAdminAction,
    saveProfile,
    toggleTheme,
    setRankingScope: rankingActions.setRankingScope,
    toggleRankingScope: rankingActions.toggleRankingScope,
    focusTopic,
    setRankingStep: rankingActions.setRankingStep,
    setScopeRankingStep: rankingActions.setScopeRankingStep,
    selectRankingStep: rankingActions.selectRankingStep,
    createNewTopic: chatActions.createNewTopic,
    submitMessage: chatActions.submitMessage,
    refreshCurrentTopic: chatActions.refreshCurrentTopic,
    refreshTopicsList: chatActions.refreshTopicsList,
    toggleMessageLike: chatActions.toggleMessageLike,
    toggleMessageDislike: chatActions.toggleMessageDislike,
    quoteMessage: chatActions.quoteMessage,
    reportEntity: chatActions.reportEntity,
    openReportModal: chatActions.openReportModal,
    closeReportModal: chatActions.closeReportModal,
    submitReportModal: chatActions.submitReportModal,
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
