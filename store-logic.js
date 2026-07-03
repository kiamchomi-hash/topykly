import { insertTopicAtTop, prepareTopicFeed, reviveTopicWithMessage } from "./model.js";

/**
 * Store logic for immutable-like state updates.
 * These functions follow the pattern: (state, payload) => nextState
 */

export const reducers = {
  hydrateFromBackend: (state, payload) => {
    const nextSelectedTopicId = payload.selectedTopicId && payload.topics.some((topic) => topic.id === payload.selectedTopicId)
      ? payload.selectedTopicId
      : null;
    const nextActiveConnectedUserId = payload.users.some((user) => user.id === state.activeConnectedUserId)
      ? state.activeConnectedUserId
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
      selectedTopicId: nextSelectedTopicId,
      activeConnectedUserId: nextActiveConnectedUserId
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

  addMessageToTopic: (state, { topicId, message }) => ({
    ...state,
    topics: reviveTopicWithMessage(state.topics, topicId, message)
  }),

  setLoadingData: (state, { users, topics }) => ({
    ...state,
    users,
    topics: prepareTopicFeed(topics)
  }),

  createTopic: (state, topic) => ({
    ...state,
    topics: insertTopicAtTop(state.topics, topic),
    selectedTopicId: topic.id
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
