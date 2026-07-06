import { insertTopicAtTop, prepareTopicFeed, reviveTopicWithMessage } from "./model.js";

/**
 * Store logic for immutable-like state updates.
 * These functions follow the pattern: (state, payload) => nextState
 */

function getUserMessageCount(topic) {
  return topic?.messages?.filter?.((message) => message.kind === "user").length ?? 0;
}

function getLastUserMessage(topic) {
  if (!topic?.messages?.length) {
    return null;
  }

  return [...topic.messages].reverse().find((message) => message.kind === "user") ?? null;
}

function getUnreadTopicIdsAfterHydration(state, payload) {
  const previousTopics = Array.isArray(state.topics) ? state.topics : [];
  const nextTopics = Array.isArray(payload.topics) ? payload.topics : [];
  const previousTopicById = new Map(previousTopics.map((topic) => [topic.id, topic]));
  const visibleNextTopicIds = new Set(nextTopics.map((topic) => topic.id));
  const viewerId = payload.viewer?.id ?? state.viewer?.id ?? state.currentUserId ?? null;
  const unreadTopicIds = new Set(
    (state.unreadTopicIds ?? []).filter((topicId) => visibleNextTopicIds.has(topicId))
  );

  if (!previousTopics.length || !viewerId) {
    return [...unreadTopicIds];
  }

  nextTopics.forEach((topic) => {
    const previousTopic = previousTopicById.get(topic.id);
    if (!previousTopic) {
      return;
    }

    const previousLastMessage = getLastUserMessage(previousTopic);
    const nextLastMessage = getLastUserMessage(topic);
    const messageCountIncreased = getUserMessageCount(topic) > getUserMessageCount(previousTopic);
    const lastMessageChanged = Boolean(nextLastMessage && previousLastMessage?.id !== nextLastMessage.id);
    if (!nextLastMessage || (!lastMessageChanged && !messageCountIncreased)) {
      return;
    }

    if (nextLastMessage.authorId === viewerId) {
      unreadTopicIds.delete(topic.id);
      return;
    }

    unreadTopicIds.add(topic.id);
  });

  return [...unreadTopicIds];
}
function updateMessageReaction(topics, messageId, updater) {
  return topics.map((topic) => {
    let changed = false;
    const messages = topic.messages.map((message) => {
      if (message.id !== messageId) {
        return message;
      }

      changed = true;
      return updater(message);
    });

    return changed ? { ...topic, messages } : topic;
  });
}

export const reducers = {
  hydrateFromBackend: (state, payload) => {
    const nextSelectedTopicId = payload.selectedTopicId && payload.topics.some((topic) => topic.id === payload.selectedTopicId)
      ? payload.selectedTopicId
      : null;
    const nextActiveConnectedUserId = payload.users.some((user) => user.id === state.activeConnectedUserId)
      ? state.activeConnectedUserId
      : null;
    const nextPublicProfileUserId = payload.users.some((user) => user.id === state.publicProfileUserId)
      ? state.publicProfileUserId
      : null;

    return {
      ...state,
      viewer: payload.viewer ?? state.viewer,
      currentUserId: payload.viewer?.id ?? state.currentUserId,
      reportedTopicIds: payload.reportedTopicIds ?? state.reportedTopicIds ?? [],
      reportedMessageIds: payload.reportedMessageIds ?? state.reportedMessageIds ?? [],
      rankings: payload.rankings ?? state.rankings ?? null,
      users: payload.users,
      topics: payload.topics,
      unreadTopicIds: getUnreadTopicIdsAfterHydration(state, payload),
      selectedTopicId: nextSelectedTopicId,
      activeConnectedUserId: nextActiveConnectedUserId,
      publicProfileUserId: nextPublicProfileUserId
    };
  },

  setTheme: (state, theme) => ({
    ...state,
    theme
  }),

  setPalette: (state, { paletteId, customPaletteHex }) => ({
    ...state,
    paletteId,
    customPaletteHex: customPaletteHex ?? state.customPaletteHex
  }),

  setSelectedTopic: (state, selectedTopicId) => ({
    ...state,
    selectedTopicId,
    unreadTopicIds: (state.unreadTopicIds ?? []).filter((topicId) => topicId !== selectedTopicId),
    // Reset message flow state if needed
    activeConnectedUserId: null
  }),

  setRankingScope: (state, rankingScope) => ({
    ...state,
    rankingScope
  }),

  setRankingIndex: (state, { scope, index }) => ({
    ...state,
    [scope === "global" ? "globalRankingIndex" : "topicRankingIndex"]: index
  }),

  setActiveUser: (state, userId) => ({
    ...state,
    activeConnectedUserId: userId
  }),

  setPublicProfileUser: (state, userId) => ({
    ...state,
    publicProfileUserId: userId
  }),

  addMessageToTopic: (state, { topicId, message }) => ({
    ...state,
    topics: reviveTopicWithMessage(state.topics, topicId, message)
  }),

  applyMessageReaction: (state, { messageId, reactionType }) => ({
    ...state,
    topics: updateMessageReaction(state.topics, messageId, (message) => {
      if (message.likedByViewer || message.dislikedByViewer) {
        return message;
      }

      if (reactionType === "dislike") {
        return {
          ...message,
          dislikes: (message.dislikes ?? 0) + 1,
          dislikedByViewer: true
        };
      }

      return {
        ...message,
        likes: (message.likes ?? 0) + 1,
        likedByViewer: true
      };
    })
  }),

  restoreTopics: (state, topics) => ({
    ...state,
    topics
  }),

  setLoadingData: (state, { users, topics }) => ({
    ...state,
    users,
    topics: prepareTopicFeed(topics)
  }),

  createTopic: (state, topic) => ({
    ...state,
    topics: insertTopicAtTop(state.topics, topic),
    unreadTopicIds: (state.unreadTopicIds ?? []).filter((topicId) => topicId !== topic.id),
    selectedTopicId: topic.id
  }),

  markTopicRead: (state, topicId) => ({
    ...state,
    unreadTopicIds: (state.unreadTopicIds ?? []).filter((unreadTopicId) => unreadTopicId !== topicId)
  }),

  incrementRefreshCount: (state) => ({
    ...state,
    refreshCount: state.refreshCount + 1
  }),

  setMobileView: (state, mobileView) => ({
    ...state,
    mobileView
  }),

  setProfileModalOpen: (state, isProfileModalOpen) => ({
    ...state,
    isProfileModalOpen
  }),

  setAdminPanelOpen: (state, isAdminPanelOpen) => ({
    ...state,
    isAdminPanelOpen
  }),

  setAdminDashboard: (state, adminDashboard) => ({
    ...state,
    adminDashboard
  }),

  setFeedback: (state, feedback) => ({
    ...state,
    feedback
  })
};

/**
 * Applies a reducer and updates the state object reference.
 * While we want immutability for the logic, the app currently shares
 * a single state object. This helper bridges both worlds.
 */
export function dispatch(state, reducer, payload) {
  const reducerName = reducer.name || "anonymous";
  const prevState = { ...state };
  const nextState = reducer(state, payload);
  
  Object.assign(state, nextState);

  // Simple DX Logger
  if (globalThis.DEBUG_STATE) {
    console.group(`[STORE] ${reducerName}`);
    console.log("Prev State:", prevState);
    console.log("Payload:", payload);
    console.log("Next State:", state);
    console.groupEnd();
  }

  return state;
}
