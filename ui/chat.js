import { createMessageItem, createMessageSkeleton } from "../components.js";
import { getSelectedTopic } from "../model.js";
import { renderIntoTargets } from "./render-utils.js";

const CHAT_SCROLL_BOTTOM_THRESHOLD_PX = 24;
const COMPOSER_TEXTAREA_SCROLL_TOLERANCE_PX = 1;
const MESSAGE_CARD_MIN_HEIGHT_PX = 112;

export function syncComposerTextareaHeight(textarea) {
  if (typeof HTMLTextAreaElement === "undefined" || !(textarea instanceof HTMLTextAreaElement)) {
    return;
  }

  textarea.style.height = "";
  const visibleHeight = textarea.clientHeight || textarea.offsetHeight;
  textarea.classList.toggle(
    "is-scrollable",
    visibleHeight > 0 && textarea.scrollHeight > visibleHeight + COMPOSER_TEXTAREA_SCROLL_TOLERANCE_PX
  );
}

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
  const isReadOnlyTopic = Boolean(topic && topic.status !== "active" && topic.status !== "pinned");
  const isLoading = !state.viewer;
  const reportedMessageIds = new Set(state.reportedMessageIds || []);
  const isTopicReported = Boolean(topic && state.reportedTopicIds?.includes?.(topic.id));

  syncChatComposer(topic, dom, isLoading, state.mobileView);
  syncTopicReportButton(topic, dom, isLoading, isTopicReported);
  syncTopicShareButton(topic, dom, isLoading);

  if (!dom.messageStream) {
    return;
  }

  const chatHero = dom.chatTopicName?.closest(".chat-hero");
  if (chatHero) {
    chatHero.hidden = true;
  }

  dom.messageStream.hidden = !isLoading && !topic;
  dom.messageStream.setAttribute("aria-busy", String(isLoading));
  if (isLoading) {
    dom.messageStream.setAttribute("role", "status");
    renderIntoTargets([dom.messageStream], "message-stream message-stream--loading", () =>
      Array.from({ length: 4 }, (_, index) => createMessageSkeleton(index))
    );
    clearRenderedChatState(dom.messageStream);
    return;
  }

  dom.messageStream.removeAttribute("role");
  if (!topic) {
    dom.messageStream.innerHTML = "";
    clearRenderedChatState(dom.messageStream);
    return;
  }

  const previousRenderState = readRenderedChatState(dom.messageStream);
  const wasNearBottom = previousRenderState.topicId ? isNearMessageStreamBottom(dom.messageStream) : true;
  const hiddenBlockedQuoteAuthors = (state.blockedUsers || [])
    .filter((user) => user.hideContent)
    .flatMap((user) => [user.nickname, user.name])
    .filter(Boolean);

  renderIntoTargets([dom.messageStream], "message-stream", () =>
    topic.messages.map((message) => createMessageItem(message, state.users, {
      reported: reportedMessageIds.has(message.id),
      currentUserId: state.viewer?.id || null,
      blocked: (state.blockedUsers || []).some((user) => user.id === message.authorId),
      hiddenBlockedQuoteAuthors,
      readOnly: isReadOnlyTopic
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

function syncTopicShareButton(topic, dom, isLoading) {
  if (typeof HTMLButtonElement === "undefined" || !(dom.shareTopicButton instanceof HTMLButtonElement)) {
    return;
  }

  dom.shareTopicButton.hidden = isLoading || !topic;
  dom.shareTopicButton.disabled = isLoading || !topic;
  dom.shareTopicButton.dataset.topicId = topic?.id || "";
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

function getMessageBodyMeasuredScrollHeight(body) {
  const openOverlays = Array.from(body.querySelectorAll(".message__action-menu:not([hidden]), .message__reaction-menu:not([hidden])"));
  openOverlays.forEach((overlay) => {
    overlay.hidden = true;
  });

  const measuredHeight = body.scrollHeight;

  openOverlays.forEach((overlay) => {
    overlay.hidden = false;
  });

  return measuredHeight;
}

function syncMessageCardHeights(messageStream) {
  const messageCards = messageStream.querySelectorAll(".message");

  messageCards.forEach((card) => {
    const body = card.querySelector(".message__body");
    if (!body) {
      return;
    }

    const nextMinHeight = `${Math.max(MESSAGE_CARD_MIN_HEIGHT_PX, getMessageBodyMeasuredScrollHeight(body))}px`;
    if (card.style.height !== "auto") {
      card.style.height = "auto";
    }
    if (card.style.minHeight !== nextMinHeight) {
      card.style.minHeight = nextMinHeight;
    }
  });
}

function syncChatComposer(topic, dom, isLoading, mobileView = "browse") {
  const isCreatingTopic = !topic;
  const isCommentableTopic = !topic || topic.status === "active" || topic.status === "pinned";
  const isArchivedTopic = topic?.status === "expelled" || topic?.isArchived === true;
  const topicTitleField = dom.topicTitleInput?.closest(".composer__field");
  const chatHeader = dom.chatTitle?.closest(".panel__header--chat");
  const chatPanel = dom.messageForm?.closest(".panel--chat");
  const submitButton = dom.composerSubmitButton;
  const submitLabel = submitButton?.querySelector(".button-label");

  if (topicTitleField) {
    topicTitleField.hidden = isLoading || !isCreatingTopic;
  }
  if (chatHeader) {
    chatHeader.hidden = isLoading || (isCreatingTopic && mobileView !== "chat");
  }
  if (chatPanel) {
    chatPanel.classList.toggle("panel--topic-create", !isLoading && isCreatingTopic);
  }
  if (dom.messageForm) {
    dom.messageForm.hidden = isLoading;
    dom.messageForm.classList.toggle("composer--topic-create", isCreatingTopic);
    dom.messageForm.classList.toggle("composer--read-only", !isCreatingTopic && !isCommentableTopic);
    dom.messageForm.dataset.topicStatus = topic?.status || "draft";
    dom.messageForm.setAttribute("aria-label", isArchivedTopic
      ? "Tema archivado disponible solo para lectura"
      : isCreatingTopic
        ? "Crear un tema"
        : "Publicar un comentario");
  }
  if (dom.messageInput) {
    dom.messageInput.disabled = !isCreatingTopic && !isCommentableTopic;
    dom.messageInput.placeholder = isCreatingTopic
      ? "Primer mensaje"
      : isCommentableTopic
        ? "Escribe un comentario..."
        : isArchivedTopic
          ? "Tema archivado: solo lectura"
          : "Tema cerrado para comentarios";
    dom.messageInput.rows = isCreatingTopic ? 4 : 2;
    dom.messageInput.setAttribute("aria-label", isCreatingTopic ? "Primer mensaje del nuevo tema" : "Comentario para el tema seleccionado");
    syncComposerTextareaHeight(dom.messageInput);
  }
  if (submitButton) {
    submitButton.disabled = isLoading || (!isCreatingTopic && !isCommentableTopic);
    submitButton.setAttribute("aria-disabled", String(submitButton.disabled));
    submitButton.setAttribute("aria-label", !isCreatingTopic && !isCommentableTopic
      ? isArchivedTopic
        ? "Tema archivado: no admite nuevos mensajes"
        : "No se pueden enviar mensajes en este tema cerrado"
      : isCreatingTopic
        ? "Crear tema con el primer mensaje"
        : "Enviar comentario al tema seleccionado");
  }
  if (submitLabel) {
    submitLabel.textContent = !isCreatingTopic && !isCommentableTopic
      ? isArchivedTopic ? "Archivado" : "Bloqueado"
      : isCreatingTopic ? "Crear tema" : "Enviar";
  } else if (submitButton) {
    submitButton.textContent = !isCreatingTopic && !isCommentableTopic
      ? isArchivedTopic ? "Archivado" : "Bloqueado"
      : isCreatingTopic ? "Crear tema" : "Enviar";
  }
}
