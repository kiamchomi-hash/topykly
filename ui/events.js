import { bindTopbarEvents } from "./topbar.js?v=20260716-quality1";
import { syncComposerTextareaHeight } from "./chat.js";
import { bindTopicShareEvents } from "./topic-share.js";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled]):not([tabindex='-1'])",
  "[href]:not([tabindex='-1'])",
  "input:not([disabled]):not([type='hidden']):not([tabindex='-1'])",
  "textarea:not([disabled]):not([tabindex='-1'])",
  "select:not([disabled]):not([tabindex='-1'])",
  "[tabindex]:not([tabindex='-1'])"
].join(", ");

async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Sin permiso de portapapeles: probar el mecanismo heredado.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}

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
    dom.logoutConfirmModal instanceof HTMLElement &&
    dom.logoutConfirmBackdrop &&
    !dom.logoutConfirmBackdrop.hidden &&
    dom.logoutConfirmModal.getAttribute("aria-hidden") === "false"
  ) {
    return dom.logoutConfirmModal;
  }

  if (
    dom.shareTopicModal instanceof HTMLElement &&
    dom.shareTopicModalBackdrop &&
    !dom.shareTopicModalBackdrop.hidden &&
    dom.shareTopicModal.getAttribute("aria-hidden") === "false"
  ) {
    return dom.shareTopicModal;
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
    dom.reportModal instanceof HTMLElement &&
    dom.reportModalBackdrop &&
    !dom.reportModalBackdrop.hidden &&
    dom.reportModal.getAttribute("aria-hidden") === "false"
  ) {
    return dom.reportModal;
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
    dom.profileAvatarCropModal instanceof HTMLElement &&
    dom.profileAvatarCropBackdrop &&
    !dom.profileAvatarCropBackdrop.hidden &&
    dom.profileAvatarCropModal.getAttribute("aria-hidden") === "false"
  ) {
    return dom.profileAvatarCropModal;
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

function getBeforeInputText(event) {
  if (typeof event.data === "string") {
    return event.data;
  }

  return event.dataTransfer?.getData?.("text") || "";
}

function shouldBlockTextareaInput(textarea, event) {
  const maxLength = Number(textarea.maxLength);
  if (!(maxLength > 0) || event.inputType?.startsWith?.("delete") || event.isComposing) {
    return false;
  }

  const selectedLength = Math.max(0, textarea.selectionEnd - textarea.selectionStart);
  const insertedText = getBeforeInputText(event);
  const insertedLength = insertedText.length || (event.inputType === "insertLineBreak" ? 1 : 0);
  return textarea.value.length - selectedLength + insertedLength > maxLength;
}

function shouldBlockQuoteEdit(textarea, event) {
  const lockLength = Number(textarea.dataset?.quoteLockLength || 0);
  if (!(lockLength > 0)) {
    return false;
  }

  const { selectionStart, selectionEnd } = textarea;
  if (selectionStart !== selectionEnd) {
    return selectionStart < lockLength;
  }

  if (event.inputType === "deleteContentBackward") {
    return selectionStart <= lockLength;
  }

  return selectionStart < lockLength;
}
export function bindPageEvents(dom, handlers) {
  const publicProfileBody = dom.publicProfileModal?.querySelector?.(".public-profile-modal__body");
  if (typeof HTMLElement !== "undefined" && publicProfileBody instanceof HTMLElement) {
    let publicProfileScrollIdleTimer = 0;
    publicProfileBody.addEventListener("scroll", () => {
      const indicator = dom.publicProfileScrollIndicator;
      const maxScrollTop = publicProfileBody.scrollHeight - publicProfileBody.clientHeight;
      if (!(indicator instanceof HTMLElement) || maxScrollTop <= 0) {
        return;
      }
      const thumbHeight = Math.max(
        32,
        Math.round(publicProfileBody.clientHeight * publicProfileBody.clientHeight / publicProfileBody.scrollHeight)
      );
      const maxThumbTop = Math.max(0, publicProfileBody.clientHeight - thumbHeight);
      const thumbTop = publicProfileBody.offsetTop
        + Math.round(publicProfileBody.scrollTop / maxScrollTop * maxThumbTop);
      indicator.style.height = `${thumbHeight}px`;
      indicator.style.transform = `translateY(${thumbTop}px)`;
      indicator.classList.add("is-visible");
      clearTimeout(publicProfileScrollIdleTimer);
      publicProfileScrollIdleTimer = setTimeout(() => {
        indicator.classList.remove("is-visible");
      }, 600);
    }, { passive: true });
  }

  bindTopbarEvents(dom, handlers);
  const topicShareEvents = bindTopicShareEvents(dom, {
    state: handlers.state,
    showFeedback: handlers.showFeedback,
    copyText: copyTextToClipboard
  });

  function positionConnectedUserMenu(menu, userItem, clickPoint = null) {
    const anchorRect = userItem.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const gap = 6;
    const viewportPadding = 8;

    const hasClickX = clickPoint && typeof clickPoint.x === "number" && clickPoint.x > 0;
    const anchorX = hasClickX ? clickPoint.x : anchorRect.left;
    const anchorY = clickPoint && typeof clickPoint.y === "number" && clickPoint.y > 0 ? clickPoint.y : anchorRect.top;

    // Open to the side opposite the click *within the card* so the menu never
    // lands on top of the profile/message buttons at the card's right edge.
    // (Comparing against the viewport instead of the card would always pick
    // the same side on layouts where the users list sits off-center.)
    const openToLeft = anchorX > anchorRect.left + anchorRect.width / 2;
    let left = openToLeft ? anchorX - menuRect.width - gap : anchorX + gap;
    left = Math.max(viewportPadding, Math.min(window.innerWidth - menuRect.width - viewportPadding, left));

    let top = anchorY - menuRect.height / 2;
    top = Math.max(viewportPadding, Math.min(window.innerHeight - menuRect.height - viewportPadding, top));

    menu.style.setProperty("--user-menu-left", `${left}px`);
    menu.style.setProperty("--user-menu-top", `${top}px`);
  }

  function closeConnectedUserMenus(exceptMenu = null) {
    [dom.userList, dom.drawerUserList].forEach((listNode) => {
      if (!(listNode instanceof HTMLElement)) {
        return;
      }

      listNode.querySelectorAll("[data-user-menu]").forEach((menu) => {
        if (!(menu instanceof HTMLElement) || menu === exceptMenu) {
          return;
        }
        menu.hidden = true;
        menu.style.removeProperty("--user-menu-left");
        menu.style.removeProperty("--user-menu-top");
        listNode.querySelectorAll(`[data-user-menu-trigger="${menu.dataset.userMenu}"]`).forEach((trigger) => {
          if (trigger instanceof HTMLElement) {
            trigger.setAttribute("aria-expanded", "false");
          }
        });
      });
    });
  }

  function handleConnectedUserActivation(target, clickPoint = null) {
    if (!(target instanceof Element)) {
      return false;
    }

    const userItem = target.closest("[data-connected-user-id]");
    if (!(userItem instanceof HTMLElement)) {
      closeConnectedUserMenus();
      return false;
    }

    const userId = userItem.dataset.connectedUserId;
    if (!userId) {
      closeConnectedUserMenus();
      return false;
    }

    const actionButton = target.closest("[data-user-action]");
    if (actionButton instanceof HTMLElement) {
      const action = actionButton.dataset.userAction || "item";
      closeConnectedUserMenus();
      if (action === "report") {
        handlers.openReportModal?.("user", userId, { trigger: actionButton });
        return true;
      }
      handlers.activateConnectedUser?.(userId, action);
      return true;
    }

    // The buttons zone never opens the menu, including a margin to its left
    // so clicks just before "Ver perfil" don't accidentally open the menu.
    const actionsEl = userItem.querySelector(".user-item__actions");
    if (actionsEl instanceof HTMLElement) {
      const actionsDeadZoneMargin = 28;
      const clickX = clickPoint && typeof clickPoint.x === "number" && clickPoint.x > 0 ? clickPoint.x : null;
      const actionsRect = actionsEl.getBoundingClientRect();
      const insideActionsDeadZone =
        target.closest(".user-item__actions") || (clickX !== null && clickX >= actionsRect.left - actionsDeadZoneMargin);
      if (insideActionsDeadZone) {
        closeConnectedUserMenus();
        return true;
      }
    }

    // Clicking anywhere else on the card (not just the name) opens the menu.
    const menu = userItem.querySelector(`[data-user-menu="${userId}"]`);
    if (menu instanceof HTMLElement) {
      const willOpen = menu.hidden;
      closeConnectedUserMenus(menu);
      menu.hidden = !willOpen;
      if (willOpen) {
        positionConnectedUserMenu(menu, userItem, clickPoint);
      }
      userItem.querySelectorAll(`[data-user-menu-trigger="${userId}"]`).forEach((trigger) => {
        if (trigger instanceof HTMLElement) {
          trigger.setAttribute("aria-expanded", String(willOpen));
        }
      });
    }
    return true;
  }

  function bindConnectedUserListEvents(listNode) {
    if (!(listNode instanceof HTMLElement)) {
      return;
    }

    listNode.addEventListener("click", (event) => {
      handleConnectedUserActivation(event.target, { x: event.clientX, y: event.clientY });
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

      handlers.openReportModal?.("user", entityId, { trigger: target });
    });
  }

  if (typeof HTMLElement !== "undefined" && dom.publicProfileCopyLinkButton instanceof HTMLElement) {
    dom.publicProfileCopyLinkButton.addEventListener("click", async () => {
      const nickname = dom.publicProfileCopyLinkButton.dataset.profileNickname || "";
      if (!nickname) {
        return;
      }

      const shareUrl = `${window.location.origin}/?perfil=${encodeURIComponent(nickname)}`;
      const copied = await copyTextToClipboard(shareUrl);
      if (copied) {
        handlers.showFeedback?.("Enlace del perfil copiado.");
      } else {
        handlers.showFeedback?.("No se pudo copiar el enlace.", { kind: "error" });
      }
    });
  }

  if (typeof HTMLElement !== "undefined" && dom.publicProfileBlockButton instanceof HTMLElement) {
    dom.publicProfileBlockButton.addEventListener("click", () => {
      handlers.requestUserBlock?.();
    });
  }

  if (typeof HTMLElement !== "undefined" && dom.publicProfileHideContentToggle instanceof HTMLElement) {
    dom.publicProfileHideContentToggle.addEventListener("click", () => {
      handlers.setPublicProfileBlockHideContent?.(
        dom.publicProfileHideContentToggle.getAttribute("aria-checked") !== "true"
      );
    });
  }

  if (typeof HTMLElement !== "undefined" && dom.publicProfileBlockCancelButton instanceof HTMLElement) {
    dom.publicProfileBlockCancelButton.addEventListener("click", () => handlers.cancelUserBlock?.());
  }

  if (typeof HTMLElement !== "undefined" && dom.publicProfileBlockConfirmButton instanceof HTMLElement) {
    dom.publicProfileBlockConfirmButton.addEventListener("click", () => {
      const userId = dom.publicProfileBlockConfirmButton.dataset.blockedUserId || "";
      if (dom.publicProfileBlockConfirmButton.dataset.blockAction === "unblock") {
        void handlers.unblockUser?.(userId);
        return;
      }
      const hideContent = dom.publicProfileHideContentToggle?.getAttribute?.("aria-checked") !== "false";
      void handlers.blockUser?.(userId, hideContent);
    });
  }


  if (typeof HTMLElement !== "undefined" && dom.publicProfileRecentCafes instanceof HTMLElement) {
    dom.publicProfileRecentCafes.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      const topicButton = event.target.closest("[data-public-profile-topic-id]");
      if (!(topicButton instanceof HTMLElement)) {
        return;
      }

      const topicId = topicButton.dataset.publicProfileTopicId || "";
      if (!topicId) {
        return;
      }

      handlers.closePublicProfileModal?.();
      handlers.focusTopic?.(topicId);
    });
  }

  if (typeof HTMLElement !== "undefined" && dom.friendRequestsPanel instanceof HTMLElement) {
    dom.friendRequestsPanel.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!(event.target instanceof Element)) {
        return;
      }

      const closeTarget = event.target.closest("[data-close-friend-requests]");
      if (closeTarget instanceof HTMLElement) {
        handlers.toggleFriendRequestsPanel?.(false);
        return;
      }

      const tabTarget = event.target.closest("[data-friend-tab]");
      if (tabTarget instanceof HTMLElement) {
        const tab = tabTarget.dataset.friendTab;
        handlers.setFriendRequestsTab?.(tab);
        return;
      }

      const actionTarget = event.target.closest("[data-friend-action][data-friend-user-id]");
      if (!(actionTarget instanceof HTMLElement)) {
        return;
      }

      const userId = actionTarget.dataset.friendUserId || "";
      if (actionTarget.dataset.friendAction === "accept") {
        handlers.acceptFriendRequest?.(userId);
        return;
      }

      if (actionTarget.dataset.friendAction === "reject") {
        handlers.rejectFriendRequest?.(userId);
      }
    });

    dom.friendRequestsPanel.addEventListener("scroll", (event) => {
      const list = event.target;
      if (list instanceof HTMLElement && list.classList.contains("friend-request-panel__list")) {
        if (list.scrollHeight - list.scrollTop - list.clientHeight < 20) {
          handlers.loadMoreFriendRequests?.();
        }
      }
    }, true);
  }
  if (typeof HTMLFormElement !== "undefined" && dom.messageForm instanceof HTMLFormElement) {
    dom.messageForm.addEventListener("submit", handlers.submitMessage);
  }
if (typeof HTMLElement !== "undefined" && dom.notificationToasts instanceof HTMLElement) {
    dom.notificationToasts.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }


      const closeNotificationsTarget = event.target.closest("[data-close-notifications]");
      if (closeNotificationsTarget instanceof HTMLElement) {
        handlers.toggleNotificationsPanel?.(false);
        return;
      }
      const dismissTarget = event.target.closest("[data-dismiss-notification]");
      if (dismissTarget instanceof HTMLElement) {
        handlers.dismissNotification?.(dismissTarget.dataset.dismissNotification || "");
        return;
      }

      const openTarget = event.target.closest("[data-open-notification-topic]");
      if (openTarget instanceof HTMLElement) {
        handlers.openNotificationTopic?.(
          openTarget.dataset.openNotificationTopic || "",
          openTarget.dataset.notificationId || null
        );
      }
    });
  }
  if (typeof HTMLTextAreaElement !== "undefined" && dom.messageInput instanceof HTMLTextAreaElement) {
    dom.messageInput.addEventListener("beforeinput", (event) => {
      if (shouldBlockTextareaInput(dom.messageInput, event) || shouldBlockQuoteEdit(dom.messageInput, event)) {
        event.preventDefault();
      }
    });
    dom.messageInput.addEventListener("input", () => {
      syncComposerTextareaHeight(dom.messageInput);
    });
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

      handlers.openReportModal?.(entityType, entityId, { trigger: target });
    });
  }

  function resetMessageActionMenuPosition(menu) {
    menu.style.position = "";
    menu.style.top = "";
    menu.style.right = "";
    menu.style.bottom = "";
    menu.style.left = "";
    menu.style.zIndex = "";
  }

  function getMessageActionMenuBody(menu) {
    const trigger = dom.messageStream?.querySelector(`[data-message-menu-trigger="${menu.dataset.messageMenu}"]`);
    const message = trigger instanceof HTMLElement ? trigger.closest(".message") : null;
    const body = message instanceof HTMLElement ? message.querySelector(".message__body") : null;
    return body instanceof HTMLElement ? body : null;
  }

  function restoreMessageActionMenu(menu) {
    resetMessageActionMenuPosition(menu);
    const body = getMessageActionMenuBody(menu);
    if (body && menu.parentElement !== body) {
      body.insertBefore(menu, body.firstChild);
    }
  }

  function positionFloatingMessageActionMenu(menu) {
    const body = getMessageActionMenuBody(menu);
    if (!(body instanceof HTMLElement)) {
      return;
    }

    const bodyRect = body.getBoundingClientRect();
    if (menu.parentElement !== document.body) {
      document.body.append(menu);
    }
    menu.style.position = "fixed";
    menu.style.top = `${Math.round(bodyRect.bottom - menu.offsetHeight - 8)}px`;
    menu.style.right = "auto";
    menu.style.bottom = "auto";
    menu.style.left = `${Math.round(bodyRect.left + 8)}px`;
    menu.style.zIndex = "80";
  }
  function closeMessageActionMenus(exceptMenu = null) {
    if (!(dom.messageStream instanceof HTMLElement)) {
      return;
    }

    document.querySelectorAll("[data-message-menu]").forEach((menu) => {
      if (!(menu instanceof HTMLElement) || menu === exceptMenu) {
        return;
      }
      menu.hidden = true;
      restoreMessageActionMenu(menu);
      const trigger = dom.messageStream.querySelector(`[data-message-menu-trigger="${menu.dataset.messageMenu}"]`);
      if (trigger instanceof HTMLElement) {
        trigger.setAttribute("aria-expanded", "false");
      }
    });
  }

  function closeMessageReactionMenus(exceptMenu = null) {
    if (!(dom.messageStream instanceof HTMLElement)) {
      return;
    }

    dom.messageStream.querySelectorAll("[data-message-reaction-menu]").forEach((menu) => {
      if (!(menu instanceof HTMLElement) || menu === exceptMenu) {
        return;
      }
      menu.hidden = true;
      const trigger = dom.messageStream.querySelector(`[data-message-reaction-trigger="${menu.dataset.messageReactionMenu}"]`);
      if (trigger instanceof HTMLElement) {
        trigger.setAttribute("aria-expanded", "false");
      }
    });
  }
  // Shared by both listeners below: the floating action menu is reparented to
  // document.body for positioning (see positionFloatingMessageActionMenu), so a
  // single listener on messageStream can't catch clicks on it once it's open.
  // Returns true when a profile/like/dislike/quote/block/report trigger was found and
  // dispatched (closing both menus first), false otherwise.
  function dispatchMessageActionClick(target) {
    const profileTrigger = target.closest("[data-message-profile-author-id]");
    if (profileTrigger instanceof HTMLElement) {
      closeMessageReactionMenus();
      closeMessageActionMenus();
      handlers.activateConnectedUser?.(profileTrigger.dataset.messageProfileAuthorId || "", "profile");
      return true;
    }

    const likeTrigger = target.closest("[data-like-message-id]");
    if (likeTrigger instanceof HTMLElement) {
      closeMessageReactionMenus();
      closeMessageActionMenus();
      handlers.toggleMessageLike?.(likeTrigger.dataset.likeMessageId || "", { trigger: likeTrigger });
      return true;
    }

    const dislikeTrigger = target.closest("[data-dislike-message-id]");
    if (dislikeTrigger instanceof HTMLElement) {
      closeMessageReactionMenus();
      closeMessageActionMenus();
      handlers.toggleMessageDislike?.(dislikeTrigger.dataset.dislikeMessageId || "", { trigger: dislikeTrigger });
      return true;
    }

    const quoteTrigger = target.closest("[data-quote-message-id]");
    if (quoteTrigger instanceof HTMLElement) {
      closeMessageReactionMenus();
      closeMessageActionMenus();
      handlers.quoteMessage?.(quoteTrigger.dataset.quoteMessageId || "", { trigger: quoteTrigger });
      return true;
    }

    const blockTrigger = target.closest("[data-block-user-id]");
    if (blockTrigger instanceof HTMLElement) {
      closeMessageReactionMenus();
      closeMessageActionMenus();
      const userId = blockTrigger.dataset.blockUserId || "";
      handlers.requestUserBlock?.(userId);
      return true;
    }

    const reportTrigger = target.closest("[data-report-entity-type][data-report-entity-id]");
    if (reportTrigger instanceof HTMLElement) {
      closeMessageReactionMenus();
      closeMessageActionMenus();
      handlers.openReportModal?.(
        reportTrigger.dataset.reportEntityType || "message",
        reportTrigger.dataset.reportEntityId || "",
        { trigger: reportTrigger }
      );
      return true;
    }

    return false;
  }

  if (typeof HTMLElement !== "undefined" && dom.messageStream instanceof HTMLElement) {
    dom.messageStream.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      const menuTrigger = event.target.closest("[data-message-menu-trigger]");
      if (menuTrigger instanceof HTMLElement) {
        const menuId = menuTrigger.dataset.messageMenuTrigger || "";
        const menu = document.querySelector(`[data-message-menu="${menuId}"]`);
        if (menu instanceof HTMLElement) {
          const willOpen = menu.hidden;
          closeMessageReactionMenus();
          closeMessageActionMenus(menu);
          menu.hidden = !willOpen;
          if (willOpen) {
            positionFloatingMessageActionMenu(menu);
          } else {
            restoreMessageActionMenu(menu);
          }
          menuTrigger.setAttribute("aria-expanded", String(willOpen));
        }
        return;
      }

      const reactionTrigger = event.target.closest("[data-message-reaction-trigger]");
      if (reactionTrigger instanceof HTMLElement) {
        const menuId = reactionTrigger.dataset.messageReactionTrigger || "";
        const menu = dom.messageStream.querySelector(`[data-message-reaction-menu="${menuId}"]`);
        if (menu instanceof HTMLElement) {
          const willOpen = menu.hidden;
          closeMessageActionMenus();
          closeMessageReactionMenus(menu);
          menu.hidden = !willOpen;
          reactionTrigger.setAttribute("aria-expanded", String(willOpen));
        }
        return;
      }

      if (dispatchMessageActionClick(event.target)) {
        return;
      }

      closeMessageReactionMenus();
      closeMessageActionMenus();
    });
  }

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const insideMessageActionMenu = event.target.closest("[data-message-menu]");
    if (insideMessageActionMenu instanceof HTMLElement && dispatchMessageActionClick(event.target)) {
      return;
    }

    const messageActionTrigger = event.target.closest("[data-message-menu-trigger]");
    if (!insideMessageActionMenu && !messageActionTrigger) {
      closeMessageActionMenus();
    }

    const insideFriendPanel = event.target.closest("#friendRequestsPanel");
    const friendButton = event.target.closest("#friendRequestsButton");
    if (!insideFriendPanel && !friendButton) {
      handlers.toggleFriendRequestsPanel?.(false);
    }

    const insideNotificationsPanel = event.target.closest("#notificationToasts");
    const notificationsButton = event.target.closest("#notificationsButton");
    if (!insideNotificationsPanel && !notificationsButton) {
      handlers.toggleNotificationsPanel?.(false);
    }
  });
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

    const picker = document.querySelector(".clr-picker");
    const pickerIsOpen = picker instanceof HTMLElement && picker.classList.contains("clr-open");
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
      topicShareEvents.close();
      handlers.closePaletteModal();
      handlers.closePublicProfileModal?.();
      handlers.closeDrawers();
    }
  });

  window.addEventListener("resize", handlers.onResize);
  document.addEventListener("wheel", handlers.onWheel, { passive: false, capture: true });
}
