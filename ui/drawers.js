import { getTransitionDurationMs } from "./transition-utils.js";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled]):not([tabindex='-1'])",
  "[href]:not([tabindex='-1'])",
  "input:not([disabled]):not([type='hidden']):not([tabindex='-1'])",
  "textarea:not([disabled]):not([tabindex='-1'])",
  "select:not([disabled]):not([tabindex='-1'])",
  "[tabindex]:not([tabindex='-1'])"
].join(", ");

let lastDrawerFocusOrigin = null;

function getFirstFocusableElement(container) {
  if (!(container instanceof HTMLElement)) {
    return null;
  }

  return container.querySelector(FOCUSABLE_SELECTOR);
}

function focusDrawerSurface(drawer) {
  const focusTarget = getFirstFocusableElement(drawer) || drawer;

  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => focusTarget.focus?.());
    return;
  }

  focusTarget.focus?.();
}

function syncRightDrawerAccessibility(dom, isOpen) {
  dom.openRightDrawer?.setAttribute("aria-expanded", String(isOpen));
  dom.rightDrawer?.setAttribute("aria-hidden", String(!isOpen));
}

function restoreDrawerFocus() {
  lastDrawerFocusOrigin?.focus?.();
  lastDrawerFocusOrigin = null;
}

export function openDrawer(side, dom, closeTimerRef, trigger = null) {
  const drawer = side === "left" ? dom.leftDrawer : dom.rightDrawer;
  const backdrop = dom.drawerBackdrop;
  if (!drawer || !backdrop) {
    return;
  }

  drawer.hidden = false;
  if (side === "right") {
    lastDrawerFocusOrigin =
      trigger instanceof HTMLElement
        ? trigger
        : document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
  }

  window.clearTimeout(closeTimerRef.current);
  closeTimerRef.current = 0;
  drawer.classList.remove("is-closing");
  drawer.classList.add("is-open");
  drawer.setAttribute("aria-hidden", "false");
  backdrop.hidden = false;
  if (side === "right") {
    syncRightDrawerAccessibility(dom, true);
  }
  focusDrawerSurface(drawer);
}

export function closeDrawers(dom, isMobileViewport, getTransitionDurationMs, closeTimerRef) {
  const leftDrawer = dom.leftDrawer;
  const rightDrawer = dom.rightDrawer;
  const backdrop = dom.drawerBackdrop;
  if (!leftDrawer || !rightDrawer || !backdrop) {
    return;
  }

  leftDrawer.classList.remove("is-open", "is-closing");
  leftDrawer.hidden = true;
  leftDrawer.setAttribute("aria-hidden", "true");

  const finalizeRightDrawerClose = () => {
    rightDrawer.classList.remove("is-open", "is-closing");
    rightDrawer.hidden = true;
    rightDrawer.setAttribute("aria-hidden", "true");
    backdrop.hidden = true;
    closeTimerRef.current = 0;
    syncRightDrawerAccessibility(dom, false);
    restoreDrawerFocus();
  };

  if (isMobileViewport() && rightDrawer.classList.contains("is-open")) {
    rightDrawer.classList.add("is-closing");
    rightDrawer.setAttribute("aria-hidden", "true");
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      finalizeRightDrawerClose();
    }, getTransitionDurationMs(rightDrawer));
    return;
  }

  finalizeRightDrawerClose();
}
