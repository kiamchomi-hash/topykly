import { getSelectedTopic } from "../../model.js";
import { formatMessageTime, getUserNameById } from "../shared/entities.js";

const CREATE_TOPIC_DESCRIPTION = "Escribe un titulo y el primer mensaje para abrir un tema nuevo.";
const CHAT_PLACEHOLDER = "Escribe aqui...";
const CREATE_TOPIC_PLACEHOLDER = "Mensaje";

export function selectChatViewModel(state, { isMobileViewport = false } = {}) {
  const topic = getSelectedTopic(state.topics, state.selectedTopicId);
  const isLoading = state.topics.allIds.length === 0;
  const isCreatingTopic = !topic;

  return {
    isLoading,
    isCreatingTopic,
    showHero: !isLoading && !!topic && isMobileViewport,
    showStream: !isLoading && !!topic, // Reverted to this less restrictive logic
    showChatHeader: !isLoading && !!topic,
    showTopicTitleField: !isLoading && isCreatingTopic,
    showComposer: !isLoading,
    chatPanelCreateMode: !isLoading && isCreatingTopic,
    chatTitle: topic?.title ?? "",
    chatTitleVisible: !!topic,
    heroTopicName: topic?.title ?? "Crear un tema",
    heroTopicDescription: topic?.subtitle ?? CREATE_TOPIC_DESCRIPTION,
    messagePlaceholder: isCreatingTopic ? CREATE_TOPIC_PLACEHOLDER : CHAT_PLACEHOLDER,
    messageRows: isCreatingTopic ? 4 : 2,
    messages: topic
      ? topic.messages.map((message) => ({
          kind: message.kind,
          author:
            message.kind === "system" ? "Sistema" : getUserNameById(state.users, message.authorId),
          timeText: formatMessageTime(message.timestamp),
          text: message.text
        }))
      : []
  };
}
