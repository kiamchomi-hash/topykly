import { initialUsers, topicSeedData } from "./data.js";
import { buildTopics, buildUsers } from "./model.js";
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

function hydrateInitialData(render) {
  const users = buildUsers(initialUsers);
  dispatch(state, reducers.setLoadingData, {
    users,
    topics: buildTopics(topicSeedData, users)
  });
  render();
}

function scheduleInitialDataHydration(render) {
  const applyData = () => hydrateInitialData(render);

  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => requestAnimationFrame(applyData));
    return;
  }

  setTimeout(applyData, 0);
}

export function bootstrap() {
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
    toggleTheme: actions.toggleTheme,
    setRankingScope: actions.setRankingScope,
    toggleRankingScope: actions.toggleRankingScope,
    refreshCurrentTopic: actions.refreshCurrentTopic,
    createNewTopic: actions.createNewTopic,
    submitMessage: actions.submitMessage,
    setRankingStep: actions.setRankingStep,
    selectRankingStep: actions.selectRankingStep,
    openPaletteModal: actions.openPaletteModal,
    closePaletteModal: actions.closePaletteModal,
    selectPalette: actions.selectPalette,
    updateCustomPaletteHex: actions.updateCustomPaletteHex,
    randomizeCustomPalette: actions.randomizeCustomPalette,
    activateConnectedUser: actions.activateConnectedUser,
    openDrawer: (side, trigger) => openDrawer(side, dom, closeTimerRef, trigger),
    closeDrawers: actions.closeDrawers,
    flashTitle: actions.flashTitle,
    backToTopics,
    onResize: handleResize,
    onWheel: responsive.handleScrollableWheel
  });

  scheduleInitialDataHydration(renderers.render);
}
