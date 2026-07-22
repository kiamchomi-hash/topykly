import { createMessageItem } from "./components/message-item.js";
import { selectChatViewModel } from "./selectors.js";
import { renderIntoTargets } from "../../ui/render-utils.js";

export function renderChatPanel(state, dom) {
  const isMobileViewport = document.documentElement.classList.contains("is-mobile-viewport");
  const viewModel = selectChatViewModel(state, { isMobileViewport });

  syncChatComposer(viewModel, dom);

  if (!dom.messageStream) {
    return;
  }

  const chatHero = dom.chatTopicName?.closest(".chat-hero");
  if (chatHero) {
    chatHero.hidden = !viewModel.showHero;
  }

  dom.messageStream.hidden = !viewModel.showStream;

  if (!viewModel.showStream) {
    dom.messageStream.innerHTML = "";
    return;
  }

  // Use renderIntoTargets for Smart Rendering
  renderIntoTargets([dom.messageStream], "panel__stream message-stream", () => {
    return viewModel.messages.map((message) => createMessageItem(message));
  });

  syncMessageCardHeights(dom.messageStream);
  dom.messageStream.scrollTop = dom.messageStream.scrollHeight;
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

function syncChatComposer(viewModel, dom) {
  const topicTitleField = dom.topicTitleInput?.closest(".composer__field");
  const chatHeader = dom.chatTitle?.closest(".panel__header--chat");
  const chatPanel = dom.messageForm?.closest(".panel--chat");

  if (topicTitleField) {
    topicTitleField.hidden = !viewModel.showTopicTitleField;
  }
  if (chatHeader) {
    chatHeader.hidden = !viewModel.showChatHeader;
  }
  if (chatPanel) {
    chatPanel.classList.toggle("panel--topic-create", viewModel.chatPanelCreateMode);
  }
  if (dom.messageForm) {
    dom.messageForm.hidden = !viewModel.showComposer;
    dom.messageForm.classList.toggle("composer--topic-create", viewModel.isCreatingTopic);
  }
  if (dom.messageInput) {
    dom.messageInput.placeholder = viewModel.messagePlaceholder;
    dom.messageInput.rows = viewModel.messageRows;
  }
}
