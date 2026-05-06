export function createResponsiveHelpers({ state, dom }) {
  function isMobileViewport() {
    return window.matchMedia("(max-width: 960px)").matches;
  }

  function resetDrawerStateForDesktop() {
    [dom.leftDrawer, dom.rightDrawer].forEach((drawer) => {
      if (!drawer) {
        return;
      }

      drawer.hidden = true;
      drawer.classList.remove("is-open", "is-closing");
      drawer.setAttribute("aria-hidden", "true");
    });

    if (dom.drawerBackdrop) {
      dom.drawerBackdrop.hidden = true;
    }
  }

  function syncResponsiveView() {
    const shell = dom.shell;
    if (!shell) {
      return isMobileViewport();
    }

    const mobile = isMobileViewport();
    document.documentElement.classList.toggle("is-mobile-viewport", mobile);
    document.documentElement.classList.toggle("is-desktop-viewport", !mobile);

    if (!mobile) {
      resetDrawerStateForDesktop();
      state.mobileView = "browse";
      shell.dataset.mobileView = "desktop";
      return mobile;
    }

    if (state.mobileView !== "chat" && state.mobileView !== "browse") {
      state.mobileView = "browse";
    }

    shell.dataset.mobileView = state.mobileView;
    return mobile;
  }

  function updateLayoutMetrics() {
    const topbar = dom.topbar;
    if (!topbar) {
      return;
    }

    document.documentElement.style.setProperty(
      "--topbar-offset",
      `${Math.ceil(topbar.getBoundingClientRect().height)}px`
    );
  }

  function handleScrollableWheel(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      return;
    }

    const container = target.closest(".scroll-list, .message-stream");
    if (!container) {
      return;
    }

    const delta = event.deltaY;
    if (!delta) {
      return;
    }

    const canScroll = container.scrollHeight > container.clientHeight + 1;
    if (!canScroll) {
      return;
    }

    event.preventDefault();
    container.scrollTop += delta;
  }

  return {
    isMobileViewport,
    syncResponsiveView,
    updateLayoutMetrics,
    handleScrollableWheel
  };
}
