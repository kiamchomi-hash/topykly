export function createBackToTopicsHandler(state, responsive, render) {
  return function backToTopics() {
    state.mobileView = "browse";
    responsive.syncResponsiveView();
    render();
  };
}

export function createResizeHandler({ responsive, render, actions, syncRankingListHeights = () => {} }) {
  return function handleResize() {
    const root = typeof document !== "undefined" ? document.documentElement : null;
    const wasMobile = root?.classList?.contains("is-mobile-viewport") ?? responsive.isMobileViewport();
    const isMobile = responsive.syncResponsiveView();
    responsive.updateLayoutMetrics();
    if (wasMobile && !isMobile) {
      actions.closeDrawers();
    }
    if (wasMobile !== isMobile) {
      render();
      return;
    }

    syncRankingListHeights();
  };
}
