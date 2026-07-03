import { createMessageItem } from "../components.js";
import { getSelectedTopic } from "../model.js";
import { renderIntoTargets } from "./render-utils.js";

const CHAT_SCROLL_BOTTOM_THRESHOLD_PX = 24;

function parseRenderedNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readRenderedChatState(messageStream) {
  return {
    topicId: messageStream.dataset.renderedTopicId || "",
    messageCount: parseRenderedNumber(messageStream.dataset.renderedMessageCount),
    lastMessageId: messageStream.dataset.renderedLastMessageId || "",
    width: parseRenderedNumber(messageStream.dataset.renderedWidth)
  };
}

function writeRenderedChatState(messageStream, nextState) {
  messageStream.dataset.renderedTopicId = nextState.topicId;
  messageStream.dataset.renderedMessageCount = String(nextState.messageCount);
  messageStream.dataset.renderedLastMessageId = nextState.lastMessageId;
  messageStream.dataset.renderedWidth = String(nextState.width);
}

function clearRenderedChatState(messageStream) {
  delete messageStream.dataset.renderedTopicId;
  delete messageStream.dataset.renderedMessageCount;
  delete messageStream.dataset.renderedLastMessageId;
  delete messageStream.dataset.renderedWidth;
}

function createNextRenderedChatState(messageStream, topic) {
  return {
    topicId: topic.id,
    messageCount: topic.messages.length,
    lastMessageId: topic.messages[topic.messages.length - 1]?.id || "",
    width: messageStream.clientWidth
  };
}

function isNearMessageStreamBottom(messageStream) {
  const remainingDistance = messageStream.scrollHeight - messageStream.clientHeight - messageStream.scrollTop;
  return remainingDistance <= CHAT_SCROLL_BOTTOM_THRESHOLD_PX;
}

export function shouldSyncChatLayout(previousState, nextState) {
  return previousState.topicId !== nextState.topicId
    || previousState.messageCount !== nextState.messageCount
    || previousState.lastMessageId !== nextState.lastMessageId
    || Math.abs(previousState.width - nextState.width) > 1;
}

export function shouldScrollChatToBottom(previousState, nextState, wasNearBottom) {
  if (previousState.topicId !== nextState.topicId) {
    return true;
  }

  return previousState.lastMessageId !== nextState.lastMessageId && wasNearBottom;
}

export function renderChat(state, dom) {
  const topic = getSelectedTopic(state.topics, state.selectedTopicId);
  const isLoading = !state.viewer;
  const reportedMessageIds = new Set(state.reportedMessageIds || []);
  const isTopicReported = Boolean(topic && state.reportedTopicIds?.includes?.(topic.id));

  syncChatComposer(topic, dom, isLoading);
  syncTopicReportButton(topic, dom, isLoading, isTopicReported);

  if (!dom.messageStream) {
    return;
  }

  const chatHero = dom.chatTopicName?.closest(".chat-hero");
  if (chatHero) {
    chatHero.hidden = true;
  }

  dom.messageStream.hidden = isLoading || !topic;
  if (!topic) {
    dom.messageStream.innerHTML = "";
    clearRenderedChatState(dom.messageStream);
    return;
  }

  const previousRenderState = readRenderedChatState(dom.messageStream);
  const wasNearBottom = previousRenderState.topicId ? isNearMessageStreamBottom(dom.messageStream) : true;

  renderIntoTargets([dom.messageStream], "message-stream", () =>
    topic.messages.map((message) => createMessageItem(message, state.users, {
      reported: reportedMessageIds.has(message.id)
    }))
  );

  const nextRenderState = createNextRenderedChatState(dom.messageStream, topic);
  // Reconciliation can replace cards when their inline height styles differ from fresh nodes,
  // so message heights must be re-applied after every render.
  syncMessageCardHeights(dom.messageStream);
  if (shouldScrollChatToBottom(previousRenderState, nextRenderState, wasNearBottom)) {
    dom.messageStream.scrollTop = dom.messageStream.scrollHeight;
  }
  writeRenderedChatState(dom.messageStream, nextRenderState);
}

function syncTopicReportButton(topic, dom, isLoading, isReported) {
  if (typeof HTMLButtonElement === "undefined") {
    return;
  }

  if (!(dom.reportTopicButton instanceof HTMLButtonElement)) {
    return;
  }

  const button = dom.reportTopicButton;
  const label = button.querySelector(".button-label");
  button.hidden = isLoading || !topic;
  button.disabled = isLoading || !topic || isReported;
  button.dataset.reportEntityType = "topic";
  button.dataset.reportEntityId = topic?.id || "";
  button.dataset.reported = String(isReported);
  button.setAttribute("aria-label", isReported ? "Tema ya reportado" : "Reportar tema");

  if (label) {
    label.textContent = isReported ? "Reportado" : "Reportar";
  }
}

function syncMessageCardHeights(messageStream) {
  const messageCards = messageStream.querySelectorAll(".message");

  messageCards.forEach((card) => {
    const body = card.querySelector(".message__body");
    if (!body) {
      return;
    }

    card.style.height = "auto";
    card.style.minHeight = `${Math.max(84, body.scrollHeight)}px`;
  });
}

function syncChatComposer(topic, dom, isLoading) {
  const isCreatingTopic = !topic;
  const isCommentableTopic = !topic || topic.status === "active" || topic.status === "pinned";
  const topicTitleField = dom.topicTitleInput?.closest(".composer__field");
  const chatHeader = dom.chatTitle?.closest(".panel__header--chat");
  const chatPanel = dom.messageForm?.closest(".panel--chat");
  const submitButton = dom.composerSubmitButton;
  const submitLabel = submitButton?.querySelector(".button-label");

  if (topicTitleField) {
    topicTitleField.hidden = isLoading || !isCreatingTopic;
  }
  if (chatHeader) {
    chatHeader.hidden = isLoading || isCreatingTopic;
  }
  if (chatPanel) {
    chatPanel.classList.toggle("panel--topic-create", !isLoading && isCreatingTopic);
  }
  if (dom.messageForm) {
    dom.messageForm.hidden = isLoading;
    dom.messageForm.classList.toggle("composer--topic-create", isCreatingTopic);
    dom.messageForm.dataset.topicStatus = topic?.status || "draft";
  }
  if (dom.messageInput) {
    dom.messageInput.disabled = !isCreatingTopic && !isCommentableTopic;
    dom.messageInput.placeholder = isCreatingTopic
      ? "Mensaje"
      : isCommentableTopic
        ? "Escribe aqui..."
        : "Tema cerrado para comentarios";
    dom.messageInput.rows = isCreatingTopic ? 4 : 2;
  }
  if (submitButton) {
    submitButton.disabled = isLoading || (!isCreatingTopic && !isCommentableTopic);
    submitButton.setAttribute("aria-disabled", String(submitButton.disabled));
  }
  if (submitLabel) {
    submitLabel.textContent = !isCreatingTopic && !isCommentableTopic ? "Bloqueado" : "Enviar";
  } else if (submitButton) {
    submitButton.textContent = !isCreatingTopic && !isCommentableTopic ? "Bloqueado" : "Enviar";
  }
}
