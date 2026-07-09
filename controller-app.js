import { openDrawer, closeDrawers } from "./ui/drawers.js";
import { bindPageEvents } from "./ui/events.js?v=20260709-palettefocus5";
import { cacheDom } from "./ui/dom.js";
import { createActionHandlers } from "./controller-actions.js?v=20260709-palettefocus5";
import { createResponsiveHelpers } from "./controller-responsive.js";
import { createRenderers } from "./controller-render.js?v=20260709-palettefocus5";
import { closeTimerRef, dom, state } from "./app-store.js";
import { applyStoredTheme, createBackToTopicsHandler, createResizeHandler } from "./controller-runtime.js";
import { dispatch, reducers } from "./store-logic.js";
import { syncRankingListHeights } from "./ui/ranking-panel-state.js";
import { getTransitionDurationMs } from "./ui/transition-utils.js";
import { api } from "./services/api.js?v=20260709-palettefocus5";
import {
  collectTopicNotifications,
  createNotificationStateUpdate,
  getWebNotificationPermission,
  showWebNotification
} from "./ui/notifications.js";

const LIVE_TOPIC_REFRESH_INTERVAL_MS = 1000;
const FAKE_SOCIAL_PARAM_VALUES = new Set(["1", "true", "yes", "demo"]);

function readBootstrapLocationParams() {
  if (typeof window === "undefined") {
    return {
      selectedTopicId: null,
      authError: null,
      fakeSocial: false
    };
  }

  const url = new URL(window.location.href);
  return {
    selectedTopicId: url.searchParams.get("selectedTopicId") || null,
    authError: url.searchParams.get("authError") || null,
    fakeSocial: FAKE_SOCIAL_PARAM_VALUES.has(String(url.searchParams.get("fakeSocial") || "").trim().toLowerCase())
  };
}

export function getAuthErrorFeedbackMessage(authError) {
  const code = String(authError || "").trim().toLowerCase();
  if (!code) {
    return "No se pudo completar el inicio de sesion.";
  }

  if (code === "access_denied") {
    return "Inicio de sesion cancelado.";
  }

  if (code === "auth_flow_expired") {
    return "La solicitud de inicio de sesion expiro. Intentalo de nuevo.";
  }

  if (code === "auth_not_configured") {
    return "El login externo todavia no esta configurado.";
  }

  if (code === "invalid_auth_callback" || code === "invalid_auth_flow") {
    return "No se pudo validar el inicio de sesion. Intentalo de nuevo.";
  }

  if (code === "auth_provider_error" || code === "auth_provider_misconfigured") {
    return "El proveedor de login no respondio correctamente.";
  }

  return "No se pudo completar el inicio de sesion.";
}

function clearBootstrapLocationParams() {
  if (typeof window === "undefined" || typeof window.history?.replaceState !== "function") {
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.delete("selectedTopicId");
  url.searchParams.delete("authError");
  window.history.replaceState({}, "", url.toString());
}

function createFakeSocialPreview(payload, now = Date.now()) {
  const users = Array.isArray(payload.users) ? payload.users : [];
  const topics = Array.isArray(payload.topics) ? payload.topics : [];
  const currentUser = users.find((user) => user.type === "registered") || users[0] || null;
  const candidates = users.filter((user) => user.id !== currentUser?.id).slice(0, 9);
  const summarizeUser = (user) => ({
    id: user.id,
    name: user.name,
    avatarUrl: user.avatarUrl || null
  });
  const friendships = {
    incoming: candidates.slice(0, 3).map(summarizeUser),
    outgoing: candidates.slice(3, 5).map(summarizeUser),
    friends: candidates.slice(5, 9).map(summarizeUser)
  };
  const statusByUserId = new Map([
    ...friendships.incoming.map((user) => [user.id, "incoming-request"]),
    ...friendships.outgoing.map((user) => [user.id, "outgoing-request"]),
    ...friendships.friends.map((user) => [user.id, "friend"])
  ]);
  const viewer = currentUser
    ? {
        ...(payload.viewer || {}),
        id: currentUser.id,
        type: "registered",
        displayName: currentUser.name,
        nickname: currentUser.nickname || currentUser.name,
        profilePending: false
      }
    : payload.viewer;
  const previewTopics = Array.from({ length: 3 }, (_, index) => topics[index % Math.max(topics.length, 1)]).filter(Boolean);
  const fallbackActors = ["Mora", "Leo", "Iara", "Nico", "Cami", "Santi", "Valen", "Juli", "Tomi"];
  const fakeActors = Array.from({ length: 9 }, (_, index) => {
    const user = candidates[index] || users[index] || null;
    return {
      id: user?.id || `fake-actor-${index + 1}`,
      name: user?.name || fallbackActors[index] || `Usuario ${index + 1}`,
      avatarUrl: user?.avatarUrl || null
    };
  });
  const postLikeTopic = previewTopics[0];
  const commentLikeTopic = previewTopics[1] || postLikeTopic;
  const activityTopic = previewTopics[2] || postLikeTopic;
  const notifications = [
    ...fakeActors.slice(0, 5).map((actor, index) => ({
      id: `fake-social-post-like-${index + 1}`,
      kind: "post-like",
      topicId: postLikeTopic.id,
      messageId: `fake-post-like-${index + 1}`,
      targetMessageId: `${postLikeTopic.id}-root`,
      totalCount: 45,
      actors: [actor],
      title: "Likes en tu posteo",
      body: `${actor.name} le dio like a tu posteo.`,
      topicTitle: postLikeTopic.title || "Tema",
      createdAt: now - index * 45_000,
      read: index >= 3
    })),
    ...fakeActors.slice(5, 7).map((actor, index) => ({
      id: `fake-social-comment-like-${index + 1}`,
      kind: "comment-like",
      topicId: commentLikeTopic.id,
      messageId: `fake-comment-like-${index + 1}`,
      targetMessageId: `${commentLikeTopic.id}-reply-1`,
      totalCount: 2,
      actors: [actor],
      title: "Likes en tu comentario",
      body: `${actor.name} le dio like a tu comentario.`,
      topicTitle: commentLikeTopic.title || "Tema",
      createdAt: now - (index + 5) * 45_000,
      read: true
    })),
    ...fakeActors.slice(7, 9).map((actor, index) => ({
      id: `fake-social-post-comment-${index + 1}`,
      kind: "post-comment",
      topicId: activityTopic.id,
      messageId: `fake-social-comment-${index + 1}`,
      targetMessageId: `${activityTopic.id}-root`,
      totalCount: 2,
      actors: [actor],
      title: "Comentarios en tu posteo",
      body: `${actor.name}: dejo una respuesta nueva en tu posteo.`,
      topicTitle: activityTopic.title || "Tema",
      createdAt: now - (index + 7) * 45_000,
      read: index === 1
    })),
    {
      id: "fake-social-quote-1",
      kind: "quote",
      topicId: activityTopic.id,
      messageId: "fake-social-quote-1",
      title: "Citaron tu comentario",
      body: `${fakeActors[8]?.name || "Alguien"}: cito tu comentario para seguir la conversacion.`,
      topicTitle: activityTopic.title || "Tema",
      createdAt: now - 8 * 45_000,
      read: true
    }
  ];

  return {
    payload: {
      ...payload,
      viewer,
      users: users.map((user) => ({
        ...user,
        online: true,
        friendshipStatus: user.id === viewer?.id ? "self" : statusByUserId.get(user.id) || user.friendshipStatus || "none"
      })),
      friendships
    },
    notifications
  };
}

function createFakeSocialApiClient(baseApi, stateRef) {
  let refreshCommentCount = 0;
  return {
    ...baseApi,
    async refreshTopics(selectedTopicId = null) {
      refreshCommentCount += 1;
      const viewerId = stateRef.viewer?.id ?? stateRef.currentUserId ?? null;
      const topics = Array.isArray(stateRef.topics) ? stateRef.topics : [];
      const users = Array.isArray(stateRef.users) ? stateRef.users : [];
      const targetTopic = topics.find((topic) => topic.authorId === viewerId) || topics[0] || null;
      if (!targetTopic) {
        return { viewer: stateRef.viewer, users, topics, friendships: stateRef.friendships };
      }

      const actor = users.find((user) => user.id !== viewerId) || { id: "fake-refresh-user", name: "Usuario fake" };
      const createdAt = new Date(Date.now()).toISOString();
      const comment = {
        id: `fake-refresh-comment-${refreshCommentCount}`,
        authorId: actor.id,
        text: `Comentario fake de refresco ${refreshCommentCount}`,
        kind: "user",
        likes: 0,
        isRoot: false,
        createdAt,
        timestamp: createdAt
      };
      const nextTopics = topics.map((topic) => topic.id === targetTopic.id
        ? {
            ...topic,
            messages: [...(topic.messages || []), comment],
            subtitle: comment.text,
            commentCount: (topic.commentCount || Math.max(0, (topic.messages || []).length - 1)) + 1
          }
        : topic);

      return {
        viewer: stateRef.viewer,
        users,
        topics: nextTopics,
        friendships: stateRef.friendships,
        selectedTopicId: selectedTopicId || stateRef.selectedTopicId
      };
    }
  };
}

async function hydrateInitialData(render, initialSelectedTopicId = null, { fakeSocial = false } = {}) {
  try {
    const payload = await api.fetchInitialData(initialSelectedTopicId ?? state.selectedTopicId);
    const preview = fakeSocial ? createFakeSocialPreview(payload) : null;
    const nextPayload = preview?.payload || payload;
    dispatch(state, reducers.hydrateFromBackend, nextPayload);
    dispatch(state, reducers.setWebNotificationsPermission, getWebNotificationPermission());
    if (preview) {
      dispatch(state, reducers.setFriendRequestsPanelOpen, false);
      dispatch(state, reducers.addNotifications, {
        notifications: preview.notifications,
        notifiedMessageIds: preview.notifications.map((notification) => notification.messageId)
      });
      dispatch(state, reducers.setNotificationsPanelOpen, true);
    }
    if (nextPayload.viewer?.profilePending) {
      dispatch(state, reducers.setProfileModalOpen, true);
    }
  } catch (error) {
    console.error(error);
  }
  render();
}
function scheduleInitialDataHydration(render, initialSelectedTopicId = null, options = {}) {
  const applyData = () => {
    hydrateInitialData(render, initialSelectedTopicId, options);
  };

  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => requestAnimationFrame(applyData));
    return;
  }

  setTimeout(applyData, 0);
}

export function createLiveTopicSync({
  state,
  render,
  apiClient = api,
  intervalMs = LIVE_TOPIC_REFRESH_INTERVAL_MS,
  onError = console.error
}) {
  let timer = 0;
  let inFlight = false;

  async function refreshNow() {
    if (inFlight || !state.viewer) {
      return false;
    }

    inFlight = true;
    try {
      const payload = await apiClient.refreshTopics(state.selectedTopicId);
      const notifications = collectTopicNotifications(state, payload);
      dispatch(state, reducers.hydrateFromBackend, payload);
      const notificationStateUpdate = createNotificationStateUpdate(state, notifications);
      if (notificationStateUpdate) {
        dispatch(state, reducers.addNotifications, notificationStateUpdate);
        notifications.forEach(showWebNotification);
      }
      render();
      return true;
    } catch (error) {
      onError?.(error);
      return false;
    } finally {
      inFlight = false;
    }
  }

  function start() {
    if (timer || intervalMs <= 0 || typeof setInterval !== "function") {
      return;
    }

    timer = setInterval(refreshNow, intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (!timer) {
      return;
    }

    clearInterval(timer);
    timer = 0;
  }

  return {
    refreshNow,
    start,
    stop
  };
}
export function bootstrap() {
  const bootstrapLocationParams = readBootstrapLocationParams();
  applyStoredTheme(state);
  Object.assign(dom, cacheDom());

  const responsive = createResponsiveHelpers({ state, dom });
  const renderRef = { current: () => {} };
  const actions = createActionHandlers({
    state,
    dom,
    renderRef,
    syncResponsiveView: responsive.syncResponsiveView,
    isMobileViewport: responsive.isMobileViewport,
    closeDrawers: () => closeDrawers(dom, responsive.isMobileViewport, getTransitionDurationMs, closeTimerRef),
    apiClient: bootstrapLocationParams.fakeSocial ? createFakeSocialApiClient(api, state) : api
  });
  const renderers = createRenderers({
    state,
    dom,
    actions,
    responsive,
    closeTimerRef,
    getTransitionDurationMs
  });

  renderRef.current = renderers.render;

  responsive.syncResponsiveView();
  responsive.updateLayoutMetrics();
  renderers.render();

  // Reveal the interface after the first render
  if (dom.workspace) {
    dom.workspace.classList.add("workspace--visible");
  }

  const backToTopics = createBackToTopicsHandler(state, responsive, renderers.render);
  const handleResize = createResizeHandler({
    responsive,
    render: renderers.render,
    actions,
    syncRankingListHeights: () => syncRankingListHeights(dom)
  });

  bindPageEvents(dom, {
    state: actions.state,
    setAuthUiSync: actions.setAuthUiSync,
    toggleTheme: actions.toggleTheme,
    setRankingScope: actions.setRankingScope,
    toggleRankingScope: actions.toggleRankingScope,
    refreshCurrentTopic: actions.refreshCurrentTopic,
    toggleMessageLike: actions.toggleMessageLike,
    toggleMessageDislike: actions.toggleMessageDislike,
    reportEntity: actions.reportEntity,
    createNewTopic: actions.createNewTopic,
    submitMessage: actions.submitMessage,
    setRankingStep: actions.setRankingStep,
    setScopeRankingStep: actions.setScopeRankingStep,
    selectRankingStep: actions.selectRankingStep,
    openPaletteModal: actions.openPaletteModal,
    closePaletteModal: actions.closePaletteModal,
    openProfileModal: actions.openProfileModal,
    closeProfileModal: actions.closeProfileModal,
    skipProfileSetup: actions.skipProfileSetup,
    closePublicProfileModal: actions.closePublicProfileModal,
    openAdminPanel: actions.openAdminPanel,
    closeAdminPanel: actions.closeAdminPanel,
    applyAdminAction: actions.applyAdminAction,
    saveProfile: actions.saveProfile,
    selectPalette: actions.selectPalette,
    updateCustomPaletteHex: actions.updateCustomPaletteHex,
    randomizeCustomPalette: actions.randomizeCustomPalette,
    activateConnectedUser: actions.activateConnectedUser,
    openDrawer: (side, trigger) => openDrawer(side, dom, closeTimerRef, trigger),
    closeDrawers: actions.closeDrawers,
    flashTitle: actions.flashTitle,
    getAuthStatus: actions.getAuthStatus,
    login: actions.login,
    loginWithPassword: actions.loginWithPassword,
    registerWithPassword: actions.registerWithPassword,
    logout: actions.logout,
    enableWebNotifications: actions.enableWebNotifications,
    toggleFriendRequestsPanel: actions.toggleFriendRequestsPanel,
    toggleNotificationsPanel: actions.toggleNotificationsPanel,
    acceptFriendRequest: actions.acceptFriendRequest,
    rejectFriendRequest: actions.rejectFriendRequest,
    dismissNotification: actions.dismissNotification,
    openNotificationTopic: actions.openNotificationTopic,
    backToTopics,
    onResize: handleResize,
    onWheel: responsive.handleScrollableWheel
  });

  if (bootstrapLocationParams.authError) {
    actions.showFeedback(getAuthErrorFeedbackMessage(bootstrapLocationParams.authError), { kind: "error" });
  }

  clearBootstrapLocationParams();
  scheduleInitialDataHydration(renderers.render, bootstrapLocationParams.selectedTopicId, {
    fakeSocial: bootstrapLocationParams.fakeSocial
  });
  if (!bootstrapLocationParams.fakeSocial) {
    createLiveTopicSync({
      state,
      render: renderers.render
    }).start();
  }
}

