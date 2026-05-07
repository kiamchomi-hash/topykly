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
  const isMobileViewport = document.documentElement.classList.contains("is-mobile-viewport");
  const isLoading = state.topics.length === 0;

  syncChatComposer(topic, dom, isLoading);

  if (!dom.messageStream) {
    return;
  }

  const chatHero = dom.chatTopicName?.closest(".chat-hero");
  if (chatHero) {
    chatHero.hidden = true;
  }

  dom.messageStream.hidden = isLoading || !topic;
  if (!topic) {
    if (dom.messageStream) {
      dom.messageStream.innerHTML = "";
      clearRenderedChatState(dom.messageStream);
    }
    return;
  }

  const previousRenderState = readRenderedChatState(dom.messageStream);
  const wasNearBottom = previousRenderState.topicId ? isNearMessageStreamBottom(dom.messageStream) : true;

  renderIntoTargets([dom.messageStream], "message-stream", () => {
    return topic.messages.map((message) => createMessageItem(message, state.users));
  });

  const nextRenderState = createNextRenderedChatState(dom.messageStream, topic);
  // Reconciliation can replace cards when their inline height styles differ from fresh nodes,
  // so message heights must be re-applied after every render.
  syncMessageCardHeights(dom.messageStream);
  if (shouldScrollChatToBottom(previousRenderState, nextRenderState, wasNearBottom)) {
    dom.messageStream.scrollTop = dom.messageStream.scrollHeight;
  }
  writeRenderedChatState(dom.messageStream, nextRenderState);
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
  const topicTitleField = dom.topicTitleInput?.closest(".composer__field");
  const chatHeader = dom.chatTitle?.closest(".panel__header--chat");
  const chatPanel = dom.messageForm?.closest(".panel--chat");

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
  }
  if (dom.messageInput) {
    dom.messageInput.placeholder = isCreatingTopic ? "Mensaje" : "Escribe aquí...";
    dom.messageInput.rows = isCreatingTopic ? 4 : 2;
  }
}
