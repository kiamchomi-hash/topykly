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
    const lastMessageChanged = Boolean(
      nextLastMessage && previousLastMessage?.id !== nextLastMessage.id
    );
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

function resolveHydratedSelectedTopicId(state, payload) {
  const nextTopicIds = new Set((payload.topics ?? []).map((topic) => topic.id));
  const currentSelectedTopicId = state.selectedTopicId || null;
  const payloadSelectedTopicId = payload.selectedTopicId || null;

  if (currentSelectedTopicId && nextTopicIds.has(currentSelectedTopicId)) {
    return currentSelectedTopicId;
  }

  return payloadSelectedTopicId && nextTopicIds.has(payloadSelectedTopicId)
    ? payloadSelectedTopicId
    : null;
}

// Reorders new topic data to match the position topics already held on screen,
// appending topics that are new to the viewer at the end. Used to update topic
// content (unread state, message counts) from the live poll without visibly
// reshuffling the list; the explicit topics-list refresh applies the backend order instead.
function reorderTopicsToMatchPreviousPositions(previousTopics, nextTopics) {
  const previousOrder = Array.isArray(previousTopics) ? previousTopics : [];
  const nextById = new Map(nextTopics.map((topic) => [topic.id, topic]));
  const seenIds = new Set();
  const ordered = [];

  previousOrder.forEach((topic) => {
    const nextTopic = nextById.get(topic.id);
    if (nextTopic) {
      seenIds.add(topic.id);
      ordered.push(nextTopic);
    }
  });

  nextTopics.forEach((topic) => {
    if (!seenIds.has(topic.id)) {
      ordered.push(topic);
    }
  });

  return ordered;
}

function buildHydratedState(state, payload, topics) {
  const nextSelectedTopicId = resolveHydratedSelectedTopicId(state, payload);
  const nextActiveConnectedUserId = payload.users.some(
    (user) => user.id === state.activeConnectedUserId
  )
    ? state.activeConnectedUserId
    : null;
  // Mantiene abierto el modal de perfil aunque el payload de refresco ya no
  // incluya a ese usuario (p. ej. perfiles compartidos que solo llegan en el
  // bootstrap): se conserva la última copia conocida hasta cerrar el modal.
  const payloadHasProfileUser = payload.users.some((user) => user.id === state.publicProfileUserId);
  const previousProfileUser = payloadHasProfileUser
    ? null
    : (state.users ?? []).find((user) => user.id === state.publicProfileUserId) || null;
  const nextPublicProfileUserId =
    payloadHasProfileUser || previousProfileUser ? state.publicProfileUserId : null;
  const nextUsers = previousProfileUser ? [...payload.users, previousProfileUser] : payload.users;
  const nextTopicIds = new Set(payload.topics.map((topic) => topic.id));
  const followedTopicIds = Array.isArray(payload.followedTopicIds)
    ? payload.followedTopicIds
    : (state.followedTopicIds ?? []);

  return {
    ...state,
    viewer: payload.viewer ?? state.viewer,
    currentUserId: payload.viewer?.id ?? state.currentUserId,
    reportedTopicIds: payload.reportedTopicIds ?? state.reportedTopicIds ?? [],
    reportedMessageIds: payload.reportedMessageIds ?? state.reportedMessageIds ?? [],
    rankings: payload.rankings ?? state.rankings ?? null,
    friendships: payload.friendships ??
      state.friendships ?? {
        incoming: [],
        outgoing: [],
        friends: []
      },
    blockedUsers: payload.blockedUsers ?? state.blockedUsers ?? [],
    users: nextUsers,
    topics,
    unreadTopicIds: getUnreadTopicIdsAfterHydration(state, payload),
    followedTopicIds: followedTopicIds.filter((topicId) => nextTopicIds.has(topicId)),
    selectedTopicId: nextSelectedTopicId,
    activeConnectedUserId: nextActiveConnectedUserId,
    publicProfileUserId: nextPublicProfileUserId,
    pendingModerationCount: payload.pendingModerationCount ?? state.pendingModerationCount ?? 0,
    onlineCount: payload.onlineCount ?? state.onlineCount ?? 0
  };
}

export const reducers = {
  hydrateFromBackend: (state, payload) => buildHydratedState(state, payload, payload.topics),

  // Same as hydrateFromBackend but keeps the topics list in its current on-screen
  // order instead of adopting the backend's order, so background live-polling
  // updates message counts/unread state without reshuffling the topics list.
  mergeLiveTopics: (state, payload) =>
    buildHydratedState(
      state,
      payload,
      reorderTopicsToMatchPreviousPositions(state.topics, payload.topics)
    ),

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
    followedTopicIds: selectedTopicId
      ? [...new Set([...(state.followedTopicIds ?? []), selectedTopicId])]
      : (state.followedTopicIds ?? []),
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
    publicProfileUserId: userId,
    publicProfileBlockConfirming: false,
    publicProfileBlockHideContent: true
  }),

  setPublicProfileBlockConfirming: (state, publicProfileBlockConfirming) => ({
    ...state,
    publicProfileBlockConfirming,
    publicProfileBlockHideContent: publicProfileBlockConfirming
      ? state.publicProfileBlockHideContent
      : true
  }),

  setPublicProfileBlockHideContent: (state, publicProfileBlockHideContent) => ({
    ...state,
    publicProfileBlockHideContent
  }),

  addMessageToTopic: (state, { topicId, message }) => ({
    ...state,
    topics: reviveTopicWithMessage(state.topics, topicId, message),
    followedTopicIds: topicId
      ? [...new Set([...(state.followedTopicIds ?? []), topicId])]
      : (state.followedTopicIds ?? [])
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

  setMessageReactionPending: (state, { messageId, pending }) => {
    const pendingIds = new Set(state.pendingMessageReactionIds ?? []);
    const wasPending = pendingIds.has(messageId);

    if (pending) {
      pendingIds.add(messageId);
    } else {
      pendingIds.delete(messageId);
    }

    if (wasPending === pending) {
      return state;
    }

    return {
      ...state,
      pendingMessageReactionIds: [...pendingIds],
      messageReactionRevision: (state.messageReactionRevision ?? 0) + 1
    };
  },

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
    followedTopicIds: [...new Set([...(state.followedTopicIds ?? []), topic.id])],
    selectedTopicId: topic.id
  }),

  markTopicRead: (state, topicId) => ({
    ...state,
    unreadTopicIds: (state.unreadTopicIds ?? []).filter(
      (unreadTopicId) => unreadTopicId !== topicId
    ),
    followedTopicIds: topicId
      ? [...new Set([...(state.followedTopicIds ?? []), topicId])]
      : (state.followedTopicIds ?? [])
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

  setSettingsModalOpen: (state, isSettingsModalOpen) => ({
    ...state,
    isSettingsModalOpen,
    settingsDeleteConfirming: false
  }),

  setStoreModalOpen: (state, isStoreModalOpen) => ({
    ...state,
    isStoreModalOpen
  }),

  setStoreCategory: (state, storeCategory) => ({
    ...state,
    storeCategory
  }),

  setSettingsSection: (state, settingsSection) => ({
    ...state,
    settingsSection,
    settingsDeleteConfirming: false
  }),

  setSettingsDeleteConfirming: (state, settingsDeleteConfirming) => ({
    ...state,
    settingsDeleteConfirming
  }),

  setFriendRequestsPanelOpen: (state, isFriendRequestsPanelOpen) => ({
    ...state,
    isFriendRequestsPanelOpen
  }),

  setFriendRequestsTab: (state, friendRequestsTab) => ({
    ...state,
    friendRequestsTab
  }),

  increaseFriendRequestsLimit: (state, tab) => ({
    ...state,
    friendRequestsLimits: {
      ...state.friendRequestsLimits,
      [tab]: (state.friendRequestsLimits?.[tab] || 10) + 10
    }
  }),

  resetFriendRequestsLimits: (state) => ({
    ...state,
    friendRequestsLimits: {
      incoming: 10,
      outgoing: 10
    }
  }),

  setNotificationsPanelOpen: (state, isNotificationsPanelOpen) => ({
    ...state,
    isNotificationsPanelOpen,
    notifications: isNotificationsPanelOpen
      ? (state.notifications ?? []).map((notification) =>
          notification.seen ? notification : { ...notification, seen: true }
        )
      : state.notifications
  }),

  setAdminPanelOpen: (state, isAdminPanelOpen) => ({
    ...state,
    isAdminPanelOpen
  }),

  setAdminSection: (state, adminSection) => ({
    ...state,
    adminSection
  }),

  setAdminDashboard: (state, adminDashboard) => {
    const avatarCount = Number.isFinite(adminDashboard.avatarPagination?.total)
      ? adminDashboard.avatarPagination.total
      : Array.isArray(adminDashboard.pendingAvatars)
        ? adminDashboard.pendingAvatars.length
        : 0;
    const reportCount = Number.isFinite(adminDashboard.reportPagination?.total)
      ? adminDashboard.reportPagination.total
      : Array.isArray(adminDashboard.reports)
        ? adminDashboard.reports.length
        : 0;
    const pendingModerationCount = avatarCount + reportCount;

    return {
      ...state,
      adminDashboard,
      pendingModerationCount
    };
  },

  setReportModalOpen: (state, reportModal) => ({
    ...state,
    reportModal
  }),

  setAdminConfirmAction: (state, adminConfirmAction) => ({
    ...state,
    adminConfirmAction
  }),

  setFeedback: (state, feedback) => ({
    ...state,
    feedback
  }),

  addNotifications: (state, { notifications, notifiedMessageIds }) => ({
    ...state,
    notifications,
    notifiedMessageIds
  }),

  dismissNotification: (state, notificationId) => ({
    ...state,
    notifications: (state.notifications ?? []).filter(
      (notification) => notification.id !== notificationId
    )
  }),

  markNotificationRead: (state, notificationIds) => {
    const ids = new Set(
      String(notificationIds || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    );
    if (!ids.size) {
      return state;
    }
    return {
      ...state,
      notifications: (state.notifications ?? []).map((notification) =>
        ids.has(notification.id) ? { ...notification, read: true, seen: true } : notification
      )
    };
  },

  setWebNotificationsPermission: (state, permission) => ({
    ...state,
    webNotificationsPermission: permission
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
