import { bindTopbarEvents } from "./topbar.js?v=20260702-sessioncookie";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled]):not([tabindex='-1'])",
  "[href]:not([tabindex='-1'])",
  "input:not([disabled]):not([type='hidden']):not([tabindex='-1'])",
  "textarea:not([disabled]):not([tabindex='-1'])",
  "select:not([disabled]):not([tabindex='-1'])",
  "[tabindex]:not([tabindex='-1'])"
].join(", ");

function getFocusableElements(container) {
  if (!(container instanceof HTMLElement)) {
    return [];
  }

  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    return !element.hidden && element.getAttribute("aria-hidden") !== "true";
  });
}

function getActiveFocusTrapContainer(dom) {
  if (
    dom.authModal instanceof HTMLElement &&
    dom.authModalBackdrop &&
    !dom.authModalBackdrop.hidden &&
    dom.authModal.getAttribute("aria-hidden") === "false"
  ) {
    return dom.authModal;
  }
  if (
    dom.authModal instanceof HTMLElement &&
    dom.authModalBackdrop &&
    !dom.authModalBackdrop.hidden &&
    dom.authModal.getAttribute("aria-hidden") === "false"
  ) {
    return dom.authModal;
  }
  if (
    dom.paletteModal instanceof HTMLElement &&
    dom.paletteModalBackdrop &&
    !dom.paletteModalBackdrop.hidden &&
    dom.paletteModal.getAttribute("aria-hidden") === "false"
  ) {
    return dom.paletteModal;
  }

  if (
    dom.adminModal instanceof HTMLElement &&
    dom.adminModalBackdrop &&
    !dom.adminModalBackdrop.hidden &&
    dom.adminModal.getAttribute("aria-hidden") === "false"
  ) {
    return dom.adminModal;
  }

  if (
    dom.profileModal instanceof HTMLElement &&
    dom.profileModalBackdrop &&
    !dom.profileModalBackdrop.hidden &&
    dom.profileModal.getAttribute("aria-hidden") === "false"
  ) {
    return dom.profileModal;
  }

  if (
    dom.publicProfileModal instanceof HTMLElement &&
    dom.publicProfileModalBackdrop &&
    !dom.publicProfileModalBackdrop.hidden &&
    dom.publicProfileModal.getAttribute("aria-hidden") === "false"
  ) {
    return dom.publicProfileModal;
  }

  if (dom.rightDrawer instanceof HTMLElement && dom.rightDrawer.classList.contains("is-open")) {
    return dom.rightDrawer;
  }

  if (dom.leftDrawer instanceof HTMLElement && dom.leftDrawer.classList.contains("is-open")) {
    return dom.leftDrawer;
  }

  return null;
}

export function bindPageEvents(dom, handlers) {
  bindTopbarEvents(dom, handlers);

  function handleConnectedUserActivation(target) {
    if (!(target instanceof Element)) {
      return false;
    }

    const userItem = target.closest("[data-connected-user-id]");
    if (!(userItem instanceof HTMLElement)) {
      return false;
    }

    const userId = userItem.dataset.connectedUserId;
    if (!userId) {
      return false;
    }

    const actionButton = target.closest("[data-user-action]");
    const action = actionButton instanceof HTMLElement ? actionButton.dataset.userAction || "item" : "item";
    handlers.activateConnectedUser?.(userId, action);
    return true;
  }

  function bindConnectedUserListEvents(listNode) {
    if (!(listNode instanceof HTMLElement)) {
      return;
    }

    listNode.addEventListener("click", (event) => {
      handleConnectedUserActivation(event.target);
    });
  }

  bindConnectedUserListEvents(dom.userList);
  bindConnectedUserListEvents(dom.drawerUserList);


  if (typeof HTMLElement !== "undefined" && dom.closePublicProfileModalButton instanceof HTMLElement) {
    dom.closePublicProfileModalButton.addEventListener("click", () => {
      handlers.closePublicProfileModal?.();
    });
  }

  if (typeof HTMLElement !== "undefined" && dom.publicProfileModalBackdrop instanceof HTMLElement) {
    dom.publicProfileModalBackdrop.addEventListener("click", (event) => {
      if (event.target === dom.publicProfileModalBackdrop) {
        handlers.closePublicProfileModal?.();
      }
    });
  }

  if (typeof HTMLElement !== "undefined" && dom.publicProfileReportButton instanceof HTMLElement) {
    dom.publicProfileReportButton.addEventListener("click", (event) => {
      const target = event.currentTarget;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const entityId = target.dataset.reportEntityId || "";
      if (!entityId) {
        return;
      }

      handlers.reportEntity?.("user", entityId, { trigger: target });
    });
  }

  if (typeof HTMLFormElement !== "undefined" && dom.messageForm instanceof HTMLFormElement) {
    dom.messageForm.addEventListener("submit", handlers.submitMessage);
  }

  if (typeof HTMLElement !== "undefined" && dom.reportTopicButton instanceof HTMLElement) {
    dom.reportTopicButton.addEventListener("click", (event) => {
      const target = event.currentTarget;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const entityType = target.dataset.reportEntityType || "topic";
      const entityId = target.dataset.reportEntityId || "";
      if (!entityId) {
        return;
      }

      handlers.reportEntity?.(entityType, entityId, { trigger: target });
    });
  }

  function closeMessageActionMenus(exceptMenu = null) {
    if (!(dom.messageStream instanceof HTMLElement)) {
      return;
    }

    dom.messageStream.querySelectorAll("[data-message-menu]").forEach((menu) => {
      if (!(menu instanceof HTMLElement) || menu === exceptMenu) {
        return;
      }
      menu.hidden = true;
      const trigger = dom.messageStream.querySelector(`[data-message-menu-trigger="${menu.dataset.messageMenu}"]`);
      if (trigger instanceof HTMLElement) {
        trigger.setAttribute("aria-expanded", "false");
      }
    });
  }

  if (typeof HTMLElement !== "undefined" && dom.messageStream instanceof HTMLElement) {
    dom.messageStream.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      const menuTrigger = event.target.closest("[data-message-menu-trigger]");
      if (menuTrigger instanceof HTMLElement) {
        const menuId = menuTrigger.dataset.messageMenuTrigger || "";
        const menu = dom.messageStream.querySelector(`[data-message-menu="${menuId}"]`);
        if (menu instanceof HTMLElement) {
          const willOpen = menu.hidden;
          closeMessageActionMenus(menu);
          menu.hidden = !willOpen;
          menuTrigger.setAttribute("aria-expanded", String(willOpen));
        }
        return;
      }

      const profileTrigger = event.target.closest("[data-message-profile-author-id]");
      if (profileTrigger instanceof HTMLElement) {
        closeMessageActionMenus();
        handlers.activateConnectedUser?.(profileTrigger.dataset.messageProfileAuthorId || "", "profile");
        return;
      }

      const likeTrigger = event.target.closest("[data-like-message-id]");
      if (likeTrigger instanceof HTMLElement) {
        closeMessageActionMenus();
        handlers.toggleMessageLike?.(likeTrigger.dataset.likeMessageId || "", { trigger: likeTrigger });
        return;
      }

      const dislikeTrigger = event.target.closest("[data-dislike-message-id]");
      if (dislikeTrigger instanceof HTMLElement) {
        closeMessageActionMenus();
        handlers.toggleMessageDislike?.(dislikeTrigger.dataset.dislikeMessageId || "", { trigger: dislikeTrigger });
        return;
      }

      const trigger = event.target.closest("[data-report-entity-type][data-report-entity-id]");
      if (!(trigger instanceof HTMLElement)) {
        closeMessageActionMenus();
        return;
      }

      closeMessageActionMenus();
      handlers.reportEntity?.(
        trigger.dataset.reportEntityType || "message",
        trigger.dataset.reportEntityId || "",
        { trigger }
      );
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      const focusTrapContainer = getActiveFocusTrapContainer(dom);
      if (!focusTrapContainer) {
        return;
      }

      const focusableElements = getFocusableElements(focusTrapContainer);
      if (!focusableElements.length) {
        event.preventDefault();
        focusTrapContainer.focus?.();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey) {
        if (activeElement === firstElement || !focusTrapContainer.contains(activeElement)) {
          event.preventDefault();
          lastElement.focus();
        }
        return;
      }

      if (activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
      return;
    }

    if (event.key !== "Escape") {
      return;
    }

    const pickerMarkedOpen = document.documentElement?.dataset?.customPickerOpen === "true";
    const picker = document.querySelector(".clr-picker");
    const pickerIsOpen = pickerMarkedOpen || (picker instanceof HTMLElement && picker.classList.contains("clr-open"));
    if (!pickerIsOpen || typeof globalThis.Coloris?.close !== "function") {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation?.();
    event.stopPropagation?.();
    globalThis.Coloris.close();
  }, true);

  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) {
      return;
    }

    if (event.key === "Escape") {
      handlers.closePaletteModal();
      handlers.closePublicProfileModal?.();
      handlers.closeDrawers();
    }
  });

  window.addEventListener("resize", handlers.onResize);
  document.addEventListener("wheel", handlers.onWheel, { passive: false, capture: true });
}
