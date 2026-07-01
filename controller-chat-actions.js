import { getSelectedTopic } from "./model.js";
import { api, ApiError } from "./services/api.js";
import { dispatch, reducers } from "./store-logic.js";

export function createChatActions({ state, dom, render, refreshFeedbackMs = 750, apiClient = api }) {
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

  function requestReportReason(entityType) {
    if (typeof window === "undefined" || typeof window.prompt !== "function") {
      return "";
    }

    const promptLabel = entityType === "message"
      ? "Motivo del reporte del mensaje:"
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

  async function refreshSelectedTopicAfterLock(topicId) {
    if (!topicId) {
      return;
    }

    try {
      await syncBackendPayload(() => apiClient.openTopic(topicId));
    } catch (error) {
      console.error(error);
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

      input.value = "";
      render();
    } catch (error) {
      if (error instanceof ApiError && error.code === "TOPIC_EXPELLED_OR_BLOCKED") {
        flashComposerLock(error.topicStatus || "blocked");
        await refreshSelectedTopicAfterLock(topic?.id || null);
        render();
        return;
      }

      console.error(error);
    } finally {
      setComposerBusy(false);
      render();
    }
  }

  async function refreshCurrentTopic() {
    const startedAt = Date.now();

    if (refreshFeedbackTimer) {
      clearTimeout(refreshFeedbackTimer);
    }

    setRefreshButtonState(true);
    try {
      await syncBackendPayload(() => apiClient.refreshTopics(state.selectedTopicId));
      dispatch(state, reducers.incrementRefreshCount);
      render();
    } catch (error) {
      console.error(error);
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
    } finally {
      setReportTriggerState(trigger, false);
      render();
    }
  }

  return {
    createNewTopic,
    submitMessage,
    refreshCurrentTopic,
    reportEntity
  };
}
