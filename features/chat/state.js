import {
  createMessage,
  createTopic,
  getSelectedTopic,
  trimMessages,
  limitTopics
} from "../../model.js";

const CHAT_ACTION_TYPES = {
  startComposer: "chat/startComposer",
  submitComposerMessage: "chat/submitComposerMessage",
  refreshSelectedTopic: "chat/refreshSelectedTopic"
};

// Configurable limit for active topics
const VISIBLE_TOPICS_LIMIT = 20;

export function startComposerAction() {
  return { type: CHAT_ACTION_TYPES.startComposer };
}

export function submitComposerMessageAction(payload = {}) {
  return {
    type: CHAT_ACTION_TYPES.submitComposerMessage,
    payload: {
      title: payload.title ?? "",
      text: payload.text ?? ""
    }
  };
}

export function refreshSelectedTopicAction() {
  return { type: CHAT_ACTION_TYPES.refreshSelectedTopic };
}

export function isChatStateAction(action) {
  return Object.values(CHAT_ACTION_TYPES).includes(action?.type);
}

export function reduceChatState(state, action) {
  switch (action.type) {
    case CHAT_ACTION_TYPES.startComposer:
      return {
        changed: true,
        nextState: { ...state, selectedTopicId: null }
      };

    case CHAT_ACTION_TYPES.submitComposerMessage: {
      const title = String(action.payload?.title ?? "").trim();
      const text = String(action.payload?.text ?? "").trim();
      if (!text) {
        return { changed: false, reason: "missing-text" };
      }

      const selectedTopicId = state.selectedTopicId;
      const topics = state.topics;

      // Case: Creating a NEW topic
      if (!selectedTopicId || !topics.byId[selectedTopicId]) {
        if (!title) {
          return { changed: false, reason: "missing-title" };
        }

        const createdTopic = createTopic(state.currentUserId, title, text);

        const newById = { ...topics.byId, [createdTopic.id]: createdTopic };
        let newAllIds = [createdTopic.id, ...topics.allIds];

        // Enforce limit
        if (newAllIds.length > VISIBLE_TOPICS_LIMIT) {
          const removedId = newAllIds.pop();
          delete newById[removedId];
        }

        return {
          changed: true,
          createdTopicId: createdTopic.id,
          nextState: {
            ...state,
            selectedTopicId: createdTopic.id,
            topics: { byId: newById, allIds: newAllIds }
          }
        };
      }

      // Case: Commenting on an EXISTING topic
      const topic = topics.byId[selectedTopicId];
      const newMessages = trimMessages(
        [...topic.messages, createMessage(state.currentUserId, text, 0)],
        30
      );

      const updatedTopic = { ...topic, messages: newMessages };
      const newById = { ...topics.byId, [selectedTopicId]: updatedTopic };

      // Move topic to the top of the list (re-ranking)
      const newAllIds = [selectedTopicId, ...topics.allIds.filter((id) => id !== selectedTopicId)];

      return {
        changed: true,
        topicId: selectedTopicId,
        nextState: {
          ...state,
          refreshCount: state.refreshCount + 1,
          topics: { byId: newById, allIds: newAllIds }
        }
      };
    }

    case CHAT_ACTION_TYPES.refreshSelectedTopic: {
      if (!state.selectedTopicId || !state.topics.byId[state.selectedTopicId]) {
        return { changed: false, reason: "missing-topic" };
      }

      return {
        changed: true,
        nextState: { ...state, refreshCount: state.refreshCount + 1 }
      };
    }

    default:
      return { changed: false, reason: "unknown-action" };
  }
}
