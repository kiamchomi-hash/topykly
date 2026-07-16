import { getSelectedTopic } from "./model.js";
import { api, ApiError } from "./services/api.js";
import { collectTopicNotifications, createNotificationStateUpdate } from "./ui/notifications.js";
import { dispatch, reducers } from "./store-logic.js?v=20260709-topicrace1";
import { composeReportReason } from "./report-reasons.js";

export function createChatActions({
  state,
  dom,
  render,
  refreshFeedbackMs = 750,
  apiClient = api,
  showFeedback = null,
  isMobileViewport = null,
  syncResponsiveView = null
}) {
  let submitLockTimer = 0;
  let pendingReportTrigger = null;

  function setRefreshButtonState(isRefreshing) {
    if (!dom.refreshButton) {
      return;
    }

    dom.refreshButton.classList.toggle("is-refreshing", isRefreshing);
    dom.refreshButton.setAttribute("aria-busy", String(isRefreshing));
  }

  function setTopicsRefreshButtonState(isRefreshing) {
    if (!dom.topicsRefreshButton) {
      return;
    }

    dom.topicsRefreshButton.classList.toggle("is-refreshing", isRefreshing);
    dom.topicsRefreshButton.setAttribute("aria-busy", String(isRefreshing));
  }

  // Shared debounce shape for the two "refresh" buttons: show the busy state
  // immediately, run the action, and only clear the busy state after
  // refreshFeedbackMs has elapsed (so quick responses still visibly spin).
  function createDebouncedRefresh(setButtonState) {
    let timer = 0;

    return async function runWithFeedback(action) {
      const startedAt = Date.now();
      if (timer) {
        clearTimeout(timer);
      }

      setButtonState(true);
      try {
        await action();
      } catch (error) {
        console.error(error);
        showFeedback?.(getActionErrorMessage(error, "No se pudo completar la accion."), { kind: "error" });
      } finally {
        const remainingMs = Math.max(0, refreshFeedbackMs - (Date.now() - startedAt));
        timer = setTimeout(() => {
          setButtonState(false);
          timer = 0;
        }, remainingMs);
      }
    };
  }

  function setComposerBusy(isBusy) {
    const submitButton = dom.composerSubmitButton;
    if (submitButton) {
      submitButton.disabled = isBusy;
      submitButton.setAttribute("aria-busy", String(isBusy));
    }

    if (dom.messageInput) {
      dom.messageInput.readOnly = isBusy;
    }

    if (dom.topicTitleInput) {
      dom.topicTitleInput.readOnly = isBusy;
    }
  }

  function scrollMessageStreamToBottom() {
    const stream = dom.messageStream;
    if (!stream) {
      return;
    }

    const applyScroll = () => {
      stream.scrollTop = stream.scrollHeight;
    };

    applyScroll();
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(applyScroll);
    }
  }

  function flashComposerLock(topicStatus = "blocked") {
    const submitButton = dom.composerSubmitButton;
    if (!submitButton) {
      return;
    }

    submitButton.classList.remove("is-locked");
    submitButton.dataset.lockedTopicStatus = topicStatus;
    // Restart the animation when the backend rejects multiple times in a row.
    void submitButton.offsetWidth;
    submitButton.classList.add("is-locked");
    clearTimeout(submitLockTimer);
    submitLockTimer = setTimeout(() => {
      submitButton.classList.remove("is-locked");
      delete submitButton.dataset.lockedTopicStatus;
      submitLockTimer = 0;
    }, 900);
  }

  function setReportTriggerState(trigger, isBusy) {
    if (typeof HTMLButtonElement === "undefined") {
      return;
    }

    if (!(trigger instanceof HTMLButtonElement)) {
      return;
    }

    trigger.disabled = isBusy;
    trigger.setAttribute("aria-busy", String(isBusy));
  }

  function getReactionScrollState(trigger) {
    const stream = trigger?.closest?.(".message-stream");
    if (typeof HTMLElement === "undefined" || !(stream instanceof HTMLElement)) {
      return null;
    }

    return {
      stream,
      scrollTop: stream.scrollTop
    };
  }

  function restoreReactionScroll(scrollState) {
    if (!scrollState) {
      return;
    }

    const applyScroll = () => {
      scrollState.stream.scrollTop = scrollState.scrollTop;
    };

    applyScroll();
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(applyScroll);
    }
  }
  // Preserves the topics list's on-screen order by default (own comments, likes,
  // topic creation, etc. should not reshuffle it); pass reorder:true only for the
  // explicit topics-list refresh action, which is meant to adopt the backend order.
  async function syncBackendPayload(fetcher, { reorder = false } = {}) {
    const payload = await fetcher();
    dispatch(state, reorder ? reducers.hydrateFromBackend : reducers.mergeLiveTopics, payload);
  }

  function getActionErrorMessage(error, fallback) {
    if (error instanceof ApiError && error.code === "LOGIN_REQUIRED") {
      return "Inicia sesion o crea una cuenta para participar.";
    }
    return error?.message || fallback;
  }

  async function refreshSelectedTopicAfterLock(topicId) {
    if (!topicId) {
      return;
    }

    try {
      await syncBackendPayload(() => apiClient.openTopic(topicId));
    } catch (error) {
      console.error(error);
      showFeedback?.(getActionErrorMessage(error, "No se pudo completar la accion."), { kind: "error" });
    }
  }

  async function submitMessage(event) {
    event.preventDefault();
    const input = dom.messageInput;
    if (!input) {
      return;
    }

    const text = input.value.trim();
    if (!text) {
      return;
    }

    const topic = getSelectedTopic(state.topics, state.selectedTopicId);
    const titleInput = dom.topicTitleInput;
    const title = titleInput?.value.trim() ?? "";

    if (!topic && !title) {
      titleInput?.focus();
      return;
    }

    let shouldScrollAfterSubmit = false;
    void apiClient.trackProductEvent?.("publish_attempt", topic ? "/tema" : "/");
    setComposerBusy(true);
    try {
      if (!topic) {
        // Creating a topic is the one action that should still surface at the
        // top of the list immediately, unlike replies/likes/etc. which must
        // not reshuffle the topics list until the user hits "Actualizar".
        await syncBackendPayload(() => apiClient.createTopic(title, text), { reorder: true });
        void apiClient.trackProductEvent?.("topic_created", "/tema");
        if (titleInput) {
          titleInput.value = "";
        }
      } else {
        await syncBackendPayload(() => apiClient.submitMessage(topic.id, text));
        void apiClient.trackProductEvent?.("comment_created", "/tema");
      }

      dispatch(state, reducers.markTopicRead, state.selectedTopicId);

      shouldScrollAfterSubmit = true;

      input.value = "";
      if (input.dataset) {
        delete input.dataset.quoteLockLength;
      }
      render();
    } catch (error) {
      if (error instanceof ApiError && error.code === "TOPIC_EXPELLED_OR_BLOCKED") {
        flashComposerLock(error.topicStatus || "blocked");
        showFeedback?.(error.message || "Este tema ya no acepta comentarios.", { kind: "error" });
        await refreshSelectedTopicAfterLock(topic?.id || null);
        render();
        return;
      }

      console.error(error);
      showFeedback?.(getActionErrorMessage(error, "No se pudo completar la accion."), { kind: "error" });
    } finally {
      setComposerBusy(false);
      render();
      if (shouldScrollAfterSubmit) {
        scrollMessageStreamToBottom();
      }
    }
  }

  const runTopicRefreshWithFeedback = createDebouncedRefresh(setRefreshButtonState);
  const runTopicsListRefreshWithFeedback = createDebouncedRefresh(setTopicsRefreshButtonState);

  async function refreshCurrentTopic() {
    await runTopicRefreshWithFeedback(async () => {
      const refreshedTopicId = state.selectedTopicId;
      await syncBackendPayload(() => apiClient.refreshTopics(refreshedTopicId));
      dispatch(state, reducers.markTopicRead, refreshedTopicId);
      dispatch(state, reducers.incrementRefreshCount);
      render();
    });
  }

  async function refreshTopicsList() {
    await runTopicsListRefreshWithFeedback(async () => {
      await syncBackendPayload(() => apiClient.refreshTopics(state.selectedTopicId), { reorder: true });
      render();
    });
  }

  function createNewTopic() {
    dispatch(state, reducers.setSelectedTopic, null);
    if (isMobileViewport?.()) {
      dispatch(state, reducers.setMobileView, "chat");
      syncResponsiveView?.();
    }
    if (dom.topicTitleInput) {
      dom.topicTitleInput.value = "";
    }
    if (dom.messageInput) {
      dom.messageInput.value = "";
      if (dom.messageInput.dataset) {
        delete dom.messageInput.dataset.quoteLockLength;
      }
    }
    render();

    if (dom.topicTitleInput) {
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => dom.topicTitleInput?.focus());
      } else {
        dom.topicTitleInput.focus();
      }
    }
  }

  async function toggleMessageReaction(messageId, reactionType, { trigger = null } = {}) {
    if (!messageId || state.pendingMessageReactionIds?.includes(messageId)) {
      return;
    }

    const previousTopics = state.topics;
    const reactionScrollState = getReactionScrollState(trigger);
    const apiCall = reactionType === "dislike" ? apiClient.toggleMessageDislike : apiClient.toggleMessageLike;
    const errorFallback = reactionType === "dislike" ? "No se pudo actualizar el dislike." : "No se pudo actualizar el like.";

    setReportTriggerState(trigger, true);
    dispatch(state, reducers.setMessageReactionPending, { messageId, pending: true });
    dispatch(state, reducers.applyMessageReaction, { messageId, reactionType });
    render();
    restoreReactionScroll(reactionScrollState);

    try {
      await syncBackendPayload(() => apiCall(messageId, state.selectedTopicId));
      render();
      restoreReactionScroll(reactionScrollState);
    } catch (error) {
      dispatch(state, reducers.restoreTopics, previousTopics);
      console.error(error);
      showFeedback?.(getActionErrorMessage(error, errorFallback), { kind: "error" });
    } finally {
      dispatch(state, reducers.setMessageReactionPending, { messageId, pending: false });
      setReportTriggerState(trigger, false);
      render();
      restoreReactionScroll(reactionScrollState);
    }
  }

  function toggleMessageLike(messageId, options = {}) {
    return toggleMessageReaction(messageId, "like", options);
  }

  function toggleMessageDislike(messageId, options = {}) {
    return toggleMessageReaction(messageId, "dislike", options);
  }


  function findMessageById(messageId) {
    for (const topic of state.topics || []) {
      const message = topic.messages?.find?.((entry) => entry.id === messageId);
      if (message) {
        return { topic, message };
      }
    }
    return null;
  }

  function getUserName(userId) {
    const user = state.users?.find?.((candidate) => candidate.id === userId);
    return user?.nickname || user?.name || "Alguien";
  }

  function formatQuoteAuthor(name) {
    const normalized = String(name || "Alguien").trim();
    return normalized.startsWith("@") ? normalized : `@${normalized}`;
  }

  function formatQuoteText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 140);
  }

  function quoteMessage(messageId) {
    const target = findMessageById(messageId);
    const input = dom.messageInput;
    if (!target || !input) {
      return;
    }

    if (target.topic?.id && state.selectedTopicId !== target.topic.id) {
      dispatch(state, reducers.setSelectedTopic, target.topic.id);
    }

    const author = getUserName(target.message.authorId);
    const preview = formatQuoteText(target.message.text);
    const quote = `> ${formatQuoteAuthor(author)}\n> ${preview}\n\n`;
    const existingText = input.value.trim();
    const nextValue = existingText
      ? `${quote}${existingText}`
      : quote;
    const maxLength = Number(input.maxLength);
    input.value = maxLength > 0 ? nextValue.slice(0, maxLength) : nextValue;
    const cursorPosition = Math.min(quote.length, input.value.length);
    if (input.dataset) {
      input.dataset.quoteLockLength = String(cursorPosition);
    }
    render();

    if (isMobileViewport?.()) {
      dispatch(state, reducers.setMobileView, "chat");
      syncResponsiveView?.();
    }

    scrollMessageStreamToBottom();

    const scrollToCursor = () => {
      input.scrollTop = input.scrollHeight;
    };

    try {
      input.focus({ preventScroll: true });
      input.setSelectionRange(cursorPosition, cursorPosition);
      scrollToCursor();
      globalThis.requestAnimationFrame?.(scrollToCursor);
    } catch {
      input.focus?.();
      scrollToCursor();
    }
  }
  async function reportEntity(entityType, entityId, { trigger = null, reason = "" } = {}) {
    setReportTriggerState(trigger, true);
    try {
      await syncBackendPayload(() => apiClient.reportEntity(
        entityType,
        entityId,
        reason || "",
        state.selectedTopicId
      ));
      render();
    } catch (error) {
      console.error(error);
      showFeedback?.(getActionErrorMessage(error, "No se pudo completar la accion."), { kind: "error" });
    } finally {
      setReportTriggerState(trigger, false);
      render();
    }
  }

  function openReportModal(entityType, entityId, { trigger = null } = {}) {
    pendingReportTrigger = typeof HTMLElement !== "undefined" && trigger instanceof HTMLElement ? trigger : null;
    dispatch(state, reducers.setReportModalOpen, { isOpen: true, entityType, entityId });
    render();
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        dom.reportReasonForm?.querySelector?.("input[type='radio']")?.focus?.();
      });
    }
  }

  function closeReportModal() {
    const trigger = pendingReportTrigger;
    pendingReportTrigger = null;
    dispatch(state, reducers.setReportModalOpen, { isOpen: false, entityType: null, entityId: null });
    render();
    trigger?.focus?.();
  }

  async function submitReportModal(reasonValue, customText = "") {
    const reportModal = state.reportModal || {};
    if (!reportModal.isOpen || !reportModal.entityType || !reportModal.entityId) {
      return;
    }

    const reason = composeReportReason(reasonValue, customText);
    if (!reason) {
      return;
    }

    const { entityType, entityId } = reportModal;
    const trigger = pendingReportTrigger;
    await reportEntity(entityType, entityId, { trigger, reason });
    closeReportModal();
  }

  return {
    createNewTopic,
    submitMessage,
    refreshCurrentTopic,
    refreshTopicsList,
    toggleMessageLike,
    toggleMessageDislike,
    quoteMessage,
    reportEntity,
    openReportModal,
    closeReportModal,
    submitReportModal
  };
}
