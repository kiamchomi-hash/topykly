import { getSelectedTopic } from "./model.js";
import { api, ApiError } from "./services/api.js";
import { collectTopicNotifications, createNotificationStateUpdate } from "./ui/notifications.js";
import { dispatch, reducers } from "./store-logic.js";

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
  let refreshFeedbackTimer = 0;
  let submitLockTimer = 0;

  function setRefreshButtonState(isRefreshing) {
    if (!dom.refreshButton) {
      return;
    }

    dom.refreshButton.classList.toggle("is-refreshing", isRefreshing);
    dom.refreshButton.setAttribute("aria-busy", String(isRefreshing));
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
    if (!(stream instanceof HTMLElement)) {
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
  function requestReportReason(entityType) {
    if (typeof window === "undefined" || typeof window.prompt !== "function") {
      return "";
    }

    const promptLabel = entityType === "message"
      ? "Motivo del reporte del mensaje:"
      : entityType === "user"
        ? "Motivo del reporte del usuario:"
        : "Motivo del reporte del tema:";
    const response = window.prompt(promptLabel, "");
    if (response === null) {
      return null;
    }

    return response;
  }

  async function syncBackendPayload(fetcher) {
    const payload = await fetcher();
    dispatch(state, reducers.hydrateFromBackend, payload);
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
    setComposerBusy(true);
    try {
      if (!topic) {
        await syncBackendPayload(() => apiClient.createTopic(title, text));
        if (titleInput) {
          titleInput.value = "";
        }
      } else {
        await syncBackendPayload(() => apiClient.submitMessage(topic.id, text));
      }

      dispatch(state, reducers.markTopicRead, state.selectedTopicId);

      shouldScrollAfterSubmit = true;

      input.value = "";
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

  async function refreshCurrentTopic() {
    const startedAt = Date.now();

    if (refreshFeedbackTimer) {
      clearTimeout(refreshFeedbackTimer);
    }

    setRefreshButtonState(true);
    try {
      const refreshedTopicId = state.selectedTopicId;
      await syncBackendPayload(() => apiClient.refreshTopics(refreshedTopicId));
      dispatch(state, reducers.markTopicRead, refreshedTopicId);
      dispatch(state, reducers.incrementRefreshCount);
      render();
    } catch (error) {
      console.error(error);
      showFeedback?.(getActionErrorMessage(error, "No se pudo completar la accion."), { kind: "error" });
    } finally {
      const remainingMs = Math.max(0, refreshFeedbackMs - (Date.now() - startedAt));
      refreshFeedbackTimer = setTimeout(() => {
        setRefreshButtonState(false);
        refreshFeedbackTimer = 0;
      }, remainingMs);
    }
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

  async function toggleMessageLike(messageId, { trigger = null } = {}) {
    if (!messageId) {
      return;
    }

    const previousTopics = state.topics;
    const reactionScrollState = getReactionScrollState(trigger);
    setReportTriggerState(trigger, true);
    dispatch(state, reducers.applyMessageReaction, { messageId, reactionType: "like" });
    render();
    restoreReactionScroll(reactionScrollState);

    try {
      await syncBackendPayload(() => apiClient.toggleMessageLike(messageId, state.selectedTopicId));
      render();
      restoreReactionScroll(reactionScrollState);
    } catch (error) {
      dispatch(state, reducers.restoreTopics, previousTopics);
      console.error(error);
      showFeedback?.(getActionErrorMessage(error, "No se pudo actualizar el like."), { kind: "error" });
    } finally {
      setReportTriggerState(trigger, false);
      render();
      restoreReactionScroll(reactionScrollState);
    }
  }

  async function toggleMessageDislike(messageId, { trigger = null } = {}) {
    if (!messageId) {
      return;
    }

    const previousTopics = state.topics;
    const reactionScrollState = getReactionScrollState(trigger);
    setReportTriggerState(trigger, true);
    dispatch(state, reducers.applyMessageReaction, { messageId, reactionType: "dislike" });
    render();
    restoreReactionScroll(reactionScrollState);

    try {
      await syncBackendPayload(() => apiClient.toggleMessageDislike(messageId, state.selectedTopicId));
      render();
      restoreReactionScroll(reactionScrollState);
    } catch (error) {
      dispatch(state, reducers.restoreTopics, previousTopics);
      console.error(error);
      showFeedback?.(getActionErrorMessage(error, "No se pudo actualizar el dislike."), { kind: "error" });
    } finally {
      setReportTriggerState(trigger, false);
      render();
      restoreReactionScroll(reactionScrollState);
    }
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
    return state.users?.find?.((user) => user.id === userId)?.name || "Alguien";
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
    const preview = String(target.message.text || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 140);
    const quote = `> ${author}: ${preview}\n\n`;
    input.value = input.value.trim()
      ? `${quote}${input.value.trim()}`
      : quote;
    render();

    if (isMobileViewport?.()) {
      dispatch(state, reducers.setMobileView, "chat");
      syncResponsiveView?.();
    }

    try {
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    } catch {
      input.focus?.();
    }
  }
  async function reportEntity(entityType, entityId, { trigger = null, reason = undefined } = {}) {
    const requestedReason = reason ?? requestReportReason(entityType);
    if (requestedReason === null) {
      return;
    }

    setReportTriggerState(trigger, true);
    try {
      await syncBackendPayload(() => apiClient.reportEntity(
        entityType,
        entityId,
        requestedReason || "",
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

  return {
    createNewTopic,
    submitMessage,
    refreshCurrentTopic,
    toggleMessageLike,
    toggleMessageDislike,
    reportEntity
  };
}
