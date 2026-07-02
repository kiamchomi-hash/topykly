import { openDrawer, closeDrawers } from "./ui/drawers.js";
import { bindPageEvents } from "./ui/events.js";
import { cacheDom } from "./ui/dom.js";
import { createActionHandlers } from "./controller-actions.js";
import { createResponsiveHelpers } from "./controller-responsive.js";
import { createRenderers } from "./controller-render.js";
import { closeTimerRef, dom, state } from "./app-store.js";
import { applyStoredTheme, createBackToTopicsHandler, createResizeHandler } from "./controller-runtime.js";
import { dispatch, reducers } from "./store-logic.js";
import { syncRankingListHeights } from "./ui/ranking-panel-state.js";
import { getTransitionDurationMs } from "./ui/transition-utils.js";
import { api } from "./services/api.js";

function readBootstrapLocationParams() {
  if (typeof window === "undefined") {
    return {
      selectedTopicId: null,
      authError: null
    };
  }

  const url = new URL(window.location.href);
  return {
    selectedTopicId: url.searchParams.get("selectedTopicId") || null,
    authError: url.searchParams.get("authError") || null
  };
}

export function getAuthErrorFeedbackMessage(authError) {
  const code = String(authError || "").trim().toLowerCase();
  if (!code) {
    return "No se pudo completar el inicio de sesion.";
  }

  if (code === "access_denied") {
    return "Inicio de sesion cancelado.";
  }

  if (code === "auth_flow_expired") {
    return "La solicitud de inicio de sesion expiro. Intentalo de nuevo.";
  }

  if (code === "auth_not_configured") {
    return "El login externo todavia no esta configurado.";
  }

  if (code === "invalid_auth_callback" || code === "invalid_auth_flow") {
    return "No se pudo validar el inicio de sesion. Intentalo de nuevo.";
  }

  if (code === "auth_provider_error" || code === "auth_provider_misconfigured") {
    return "El proveedor de login no respondio correctamente.";
  }

  return "No se pudo completar el inicio de sesion.";
}

function clearBootstrapLocationParams() {
  if (typeof window === "undefined" || typeof window.history?.replaceState !== "function") {
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.delete("selectedTopicId");
  url.searchParams.delete("authError");
  window.history.replaceState({}, "", url.toString());
}

async function hydrateInitialData(render, initialSelectedTopicId = null) {
  try {
    const payload = await api.fetchInitialData(initialSelectedTopicId ?? state.selectedTopicId);
    dispatch(state, reducers.hydrateFromBackend, payload);
    if (payload.viewer?.profilePending) {
      dispatch(state, reducers.setProfileModalOpen, true);
    }
  } catch (error) {
    console.error(error);
  }
  render();
}

function scheduleInitialDataHydration(render, initialSelectedTopicId = null) {
  const applyData = () => {
    hydrateInitialData(render, initialSelectedTopicId);
  };

  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => requestAnimationFrame(applyData));
    return;
  }

  setTimeout(applyData, 0);
}

export function bootstrap() {
  const bootstrapLocationParams = readBootstrapLocationParams();
  applyStoredTheme(state);
  Object.assign(dom, cacheDom());

  const responsive = createResponsiveHelpers({ state, dom });
  const renderRef = { current: () => {} };
  const actions = createActionHandlers({
    state,
    dom,
    renderRef,
    syncResponsiveView: responsive.syncResponsiveView,
    isMobileViewport: responsive.isMobileViewport,
    closeDrawers: () => closeDrawers(dom, responsive.isMobileViewport, getTransitionDurationMs, closeTimerRef)
  });
  const renderers = createRenderers({
    state,
    dom,
    actions,
    responsive,
    closeTimerRef,
    getTransitionDurationMs
  });

  renderRef.current = renderers.render;

  responsive.syncResponsiveView();
  responsive.updateLayoutMetrics();
  renderers.render();

  // Reveal the interface after the first render
  if (dom.workspace) {
    dom.workspace.classList.add("workspace--visible");
  }

  const backToTopics = createBackToTopicsHandler(state, responsive, renderers.render);
  const handleResize = createResizeHandler({
    responsive,
    render: renderers.render,
    actions,
    syncRankingListHeights: () => syncRankingListHeights(dom)
  });

  bindPageEvents(dom, {
    state: actions.state,
    setAuthUiSync: actions.setAuthUiSync,
    toggleTheme: actions.toggleTheme,
    setRankingScope: actions.setRankingScope,
    toggleRankingScope: actions.toggleRankingScope,
    refreshCurrentTopic: actions.refreshCurrentTopic,
    reportEntity: actions.reportEntity,
    createNewTopic: actions.createNewTopic,
    submitMessage: actions.submitMessage,
    setRankingStep: actions.setRankingStep,
    selectRankingStep: actions.selectRankingStep,
    openPaletteModal: actions.openPaletteModal,
    closePaletteModal: actions.closePaletteModal,
    openProfileModal: actions.openProfileModal,
    closeProfileModal: actions.closeProfileModal,
    openAdminPanel: actions.openAdminPanel,
    closeAdminPanel: actions.closeAdminPanel,
    applyAdminAction: actions.applyAdminAction,
    saveProfile: actions.saveProfile,
    selectPalette: actions.selectPalette,
    updateCustomPaletteHex: actions.updateCustomPaletteHex,
    randomizeCustomPalette: actions.randomizeCustomPalette,
    activateConnectedUser: actions.activateConnectedUser,
    openDrawer: (side, trigger) => openDrawer(side, dom, closeTimerRef, trigger),
    closeDrawers: actions.closeDrawers,
    flashTitle: actions.flashTitle,
    login: actions.login,
    logout: actions.logout,
    backToTopics,
    onResize: handleResize,
    onWheel: responsive.handleScrollableWheel
  });

  if (bootstrapLocationParams.authError) {
    actions.showFeedback(getAuthErrorFeedbackMessage(bootstrapLocationParams.authError), { kind: "error" });
  }

  clearBootstrapLocationParams();
  scheduleInitialDataHydration(renderers.render, bootstrapLocationParams.selectedTopicId);
}
