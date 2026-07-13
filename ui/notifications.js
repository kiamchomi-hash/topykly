import { getActiveAccentColor } from "../palettes.js";
import { filterDisplayText } from "../profanity-filter.js";
import { reconcile } from "./render-utils.js";

const NOTIFICATION_LIMIT = 120;
const MESSAGE_PREVIEW_LIMIT = 86;
const MENTION_BOUNDARY = String.raw`(?:^|[^a-z0-9_.-])`;
const SVG_NS = "http://www.w3.org/2000/svg";

function normalizeToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_.-]+/g, "");
}

function getUserName(users, userId) {
  return users.find((user) => user.id === userId)?.name || "Alguien";
}

function getLastUserMessage(topic) {
  if (!topic?.messages?.length) {
    return null;
  }

  return [...topic.messages].reverse().find((message) => message.kind === "user") ?? null;
}

function getUserMessageCount(topic) {
  return topic?.messages?.filter?.((message) => message.kind === "user").length ?? 0;
}
function getRootMessage(topic) {
  return topic?.messages?.find?.((message) => message.isRoot) || topic?.messages?.[0] || null;
}

function didRootLikeIncrease(previousTopic, topic) {
  const previousRoot = getRootMessage(previousTopic);
  const nextRoot = getRootMessage(topic);
  return Boolean(previousRoot && nextRoot && (nextRoot.likes ?? 0) > (previousRoot.likes ?? 0));
}


function getViewerMentionTokens(state, payload) {
  const viewer = payload.viewer ?? state.viewer;
  const viewerUser = payload.users?.find?.((user) => user.id === viewer?.id) ?? null;
  const username = viewer?.nickname || viewerUser?.nickname || null;
  const legacyNames = username
    ? []
    : [viewer?.name, viewer?.displayName, viewerUser?.name, viewerUser?.displayName];
  return [viewer?.id, username, ...legacyNames]
    .map(normalizeToken)
    .filter(Boolean);
}

function messageMentionsViewer(message, mentionTokens) {
  const normalized = String(message?.text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return mentionTokens.some((token) => {
    const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const mentionPattern = new RegExp(`${MENTION_BOUNDARY}@${escapedToken}(?![a-z0-9_.-])`, "i");
    return mentionPattern.test(normalized);
  });
}


function getMessageIdentity(message) {
  return String(message?.id || "");
}

function getMessageKindForNotification(topic, message, viewerId, mentionTokens, followedTopicIds) {
  const text = String(message?.text || "");
  const isQuote = /^>\s*[^\n]+/m.test(text) && messageMentionsViewer(message, mentionTokens);
  if (isQuote) {
    return "quote";
  }
  if (messageMentionsViewer(message, mentionTokens)) {
    return "mention";
  }
  if (topic.authorId === viewerId) {
    return "post-comment";
  }
  if (followedTopicIds.has(topic.id)) {
    return "followed-topic";
  }
  return "";
}

function getNotificationTitle(kind) {
  const titles = {
    mention: "Te mencionaron",
    "followed-topic": "Actividad en tema seguido",
    "post-comment": "Comentaron tu posteo",
    quote: "Citaron tu comentario",
    "post-like": "Like en tu posteo",
    "comment-like": "Like en tu comentario"
  };
  return titles[kind] || "Notificacion";
}

const LIKE_NOTIFICATION_KINDS = new Set(["post-like", "comment-like"]);
const GROUPED_NOTIFICATION_KINDS = new Set(["post-like", "comment-like", "post-comment"]);

function getActivityTargetLabel(kind) {
  return kind === "comment-like" ? "tu comentario" : "tu posteo";
}

function getActivityVerb(kind, count) {
  if (kind === "post-comment") {
    return count === 1 ? "comento" : "comentaron";
  }
  return count === 1 ? "le dio like a" : "likearon";
}

function uniqueActors(actors) {
  const seen = new Set();
  return actors.filter((actor) => {
    const key = actor.id || actor.name;
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function getNotificationActors(notification) {
  const actors = Array.isArray(notification.actors) ? notification.actors : [];
  if (actors.length) {
    return uniqueActors(actors.map((actor) => ({
      id: actor.id || actor.name || "",
      name: actor.name || "Alguien",
      avatarUrl: actor.avatarUrl || null
    })));
  }

  return [{
    id: notification.actorId || notification.actorName || notification.id,
    name: notification.actorName || "Alguien",
    avatarUrl: notification.actorAvatarUrl || null
  }];
}

function formatActorList(names, totalCount) {
  const visibleNames = names.filter(Boolean).slice(0, 2);
  const extraCount = Math.max(0, totalCount - visibleNames.length);
  if (!visibleNames.length) {
    return `${totalCount} personas`;
  }
  if (extraCount > 0) {
    return `${visibleNames.join(", ")} y ${extraCount} ${extraCount === 1 ? "persona mas" : "personas mas"}`;
  }
  if (visibleNames.length === 1) {
    return visibleNames[0];
  }
  return `${visibleNames[0]} y ${visibleNames[1]}`;
}

function formatGroupedActivityBody(group) {
  const names = group.actors.map((actor) => actor.name);
  const actorText = formatActorList(names, group.totalCount);
  const targetLabel = getActivityTargetLabel(group.kind);
  const verb = getActivityVerb(group.kind, group.totalCount);
  return `${actorText} ${verb} ${targetLabel}.`;
}

export function groupNotificationsForDisplay(notifications) {
  const groups = new Map();
  const displayItems = [];

  notifications.forEach((notification) => {
    if (!GROUPED_NOTIFICATION_KINDS.has(notification.kind)) {
      displayItems.push(notification);
      return;
    }

    const targetId = notification.targetMessageId || notification.messageTargetId || notification.messageId;
    const key = `${notification.kind}:${notification.topicId}:${targetId}`;
    const actors = getNotificationActors(notification);
    const existing = groups.get(key);
    if (existing) {
      existing.notificationIds.push(notification.id);
      existing.actors = uniqueActors([...existing.actors, ...actors]);
      existing.totalCount = Math.max(existing.totalCount, notification.totalCount || existing.actors.length);
      existing.createdAt = Math.max(existing.createdAt || 0, notification.createdAt || 0);
      existing.read = existing.read && Boolean(notification.read);
      existing.body = formatGroupedActivityBody(existing);
      return;
    }

    const group = {
      ...notification,
      id: `group-${key}`,
      notificationIds: [notification.id],
      targetMessageId: targetId,
      actors,
      totalCount: Math.max(notification.totalCount || 0, actors.length),
      title: notification.kind === "post-comment" ? "Comentarios en tu posteo" : notification.kind === "comment-like" ? "Likes en tu comentario" : "Likes en tu posteo",
      read: Boolean(notification.read)
    };
    group.body = formatGroupedActivityBody(group);
    groups.set(key, group);
    displayItems.push(group);
  });

  return displayItems.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function collectLikeNotifications({ previousTopic, topic, viewerId, users, notifiedMessageIds, now, suppressRootPostLike = false }) {
  const previousMessages = new Map((previousTopic.messages || []).map((message) => [getMessageIdentity(message), message]));
  return (topic.messages || []).flatMap((message) => {
    const messageId = getMessageIdentity(message);
    const previousMessage = previousMessages.get(messageId);
    if (!messageId || !previousMessage || message.authorId !== viewerId || notifiedMessageIds.has(`like-${messageId}-${message.likes || 0}`)) {
      return [];
    }

    const previousLikes = previousMessage.likes ?? 0;
    const nextLikes = message.likes ?? 0;
    if (nextLikes <= previousLikes) {
      return [];
    }

    if (message.isRoot && suppressRootPostLike) {
      return [];
    }

    const kind = message.isRoot ? "post-like" : "comment-like";
    const delta = nextLikes - previousLikes;
    const knownLiker = delta === 1 && message.lastLikeByName
      ? { id: message.lastLikeById || message.lastLikeByName, name: message.lastLikeByName, avatarUrl: null }
      : null;
    return [{
      id: `toast-${kind}-${messageId}-${nextLikes}`,
      kind,
      topicId: topic.id,
      messageId: `like-${messageId}-${nextLikes}`,
      targetMessageId: messageId,
      totalCount: nextLikes,
      actors: [knownLiker || { name: "Alguien", avatarUrl: null }],
      title: getNotificationTitle(kind),
      body: knownLiker
        ? `${knownLiker.name} le dio like a ${message.isRoot ? "tu posteo" : "tu comentario"}.`
        : `${delta === 1 ? "Alguien dio" : `${delta} personas dieron`} like a ${message.isRoot ? "tu posteo" : "tu comentario"}.`,
      topicTitle: topic.title || "Tema",
      createdAt: now
    }];
  });
}
function truncatePreview(text) {
  const normalized = filterDisplayText(String(text || "")).replace(/\s+/g, " ").trim();
  if (normalized.length <= MESSAGE_PREVIEW_LIMIT) {
    return normalized;
  }

  return `${normalized.slice(0, MESSAGE_PREVIEW_LIMIT - 1).trim()}...`;
}

export function collectTopicNotifications(state, payload, now = Date.now()) {
  const previousTopics = Array.isArray(state.topics) ? state.topics : [];
  const nextTopics = Array.isArray(payload.topics) ? payload.topics : [];
  const previousTopicById = new Map(previousTopics.map((topic) => [topic.id, topic]));
  const followedTopicIds = new Set(state.followedTopicIds || []);
  const notifiedMessageIds = new Set(state.notifiedMessageIds || []);
  const viewerId = payload.viewer?.id ?? state.viewer?.id ?? state.currentUserId ?? null;
  const mentionTokens = getViewerMentionTokens(state, payload);

  if (!previousTopics.length || !viewerId) {
    return [];
  }

  return nextTopics.flatMap((topic) => {
    const previousTopic = previousTopicById.get(topic.id);
    if (!previousTopic) {
      return [];
    }

    const users = payload.users || state.users || [];
    const previousLastMessage = getLastUserMessage(previousTopic);
    const nextLastMessage = getLastUserMessage(topic);
    const previousUserMessageCount = getUserMessageCount(previousTopic);
    const nextUserMessageCount = getUserMessageCount(topic);
    const messageCountIncreased = nextUserMessageCount > previousUserMessageCount;
    const firstCommentCountsAsPostLike = Boolean(
      topic.authorId === viewerId &&
      previousUserMessageCount <= 1 &&
      messageCountIncreased &&
      didRootLikeIncrease(previousTopic, topic)
    );
    const lastMessageChanged = Boolean(nextLastMessage && previousLastMessage?.id !== nextLastMessage.id);
    const likeNotifications = collectLikeNotifications({
      previousTopic,
      topic,
      viewerId,
      users,
      notifiedMessageIds,
      now,
      suppressRootPostLike: topic.authorId === viewerId && messageCountIncreased && !firstCommentCountsAsPostLike
    });

    if (!nextLastMessage || (!lastMessageChanged && !messageCountIncreased)) {
      return likeNotifications;
    }

    if (nextLastMessage.authorId === viewerId || notifiedMessageIds.has(nextLastMessage.id)) {
      return likeNotifications;
    }

    const kind = getMessageKindForNotification(topic, nextLastMessage, viewerId, mentionTokens, followedTopicIds);
    if (!kind || (kind === "post-comment" && firstCommentCountsAsPostLike)) {
      return likeNotifications;
    }

    const author = users.find((user) => user.id === nextLastMessage.authorId) || null;
    const authorName = author?.name || getUserName(users, nextLastMessage.authorId);
    return [{
      id: `toast-${kind}-${nextLastMessage.id}`,
      kind,
      topicId: topic.id,
      messageId: nextLastMessage.id,
      targetMessageId: kind === "post-comment" ? topic.messages?.[0]?.id || `${topic.id}-root` : nextLastMessage.id,
      actors: [{ id: nextLastMessage.authorId, name: authorName, avatarUrl: author?.avatarUrl || null }],
      totalCount: 1,
      title: getNotificationTitle(kind),
      body: `${authorName}: ${truncatePreview(nextLastMessage.text)}`,
      topicTitle: topic.title || "Tema",
      createdAt: now
    }, ...likeNotifications];
  });
}
export function filterNotificationsForFriends(notifications, friendships) {
  const friendIds = new Set((friendships?.friends || []).map((friend) => friend.id).filter(Boolean));
  return notifications.filter((notification) => {
    const actors = Array.isArray(notification.actors) ? notification.actors : [];
    return actors.some((actor) => actor.id && friendIds.has(actor.id));
  });
}

export function createNotificationStateUpdate(state, notifications) {
  if (!notifications.length) {
    return null;
  }

  const notificationIds = new Set();
  const normalizedNotifications = notifications.map((notification) => ({
    ...notification,
    read: Boolean(notification.read),
    seen: Boolean(notification.seen || notification.read || state.isNotificationsPanelOpen)
  }));
  const nextNotifications = [...normalizedNotifications, ...(state.notifications || [])]
    .filter((notification) => {
      if (notificationIds.has(notification.id)) {
        return false;
      }
      notificationIds.add(notification.id);
      return true;
    })
    .slice(0, NOTIFICATION_LIMIT);

  const nextNotifiedMessageIds = [
    ...new Set([
      ...(state.notifiedMessageIds || []),
      ...notifications.map((notification) => notification.messageId)
    ])
  ].slice(-80);

  return {
    notifications: nextNotifications,
    notifiedMessageIds: nextNotifiedMessageIds
  };
}

function positionNotificationPanel(panel, button) {
  if (!panel || !button || typeof window === "undefined") {
    return;
  }

  const rect = button.getBoundingClientRect?.();
  if (!rect) {
    return;
  }

  if (!rect.width && !rect.height) {
    // Anchor button hidden (mobile viewport): fall back to the CSS default position.
    panel.style.removeProperty("--notification-panel-width");
    panel.style.removeProperty("--notification-panel-right");
    panel.style.removeProperty("--notification-panel-left");
    panel.style.removeProperty("--notification-panel-top");
    panel.style.removeProperty("--notification-panel-bottom");
    return;
  }

  const gap = 10;
  const viewportPadding = 12;
  const right = Math.max(viewportPadding, window.innerWidth - rect.right);
  const isMobileFloatingButton = document.documentElement?.classList?.contains("is-mobile-viewport");

  if (isMobileFloatingButton) {
    const panelWidth = Math.min(420, Math.max(292, window.innerWidth - viewportPadding * 2));
    const buttonCenterX = rect.left + rect.width / 2;
    const buttonCenterY = rect.top + rect.height / 2;
    panel.style.setProperty("--notification-panel-width", `${panelWidth}px`);

    if (buttonCenterX <= window.innerWidth / 2) {
      const left = Math.min(
        window.innerWidth - panelWidth - viewportPadding,
        Math.max(viewportPadding, rect.left)
      );
      panel.style.setProperty("--notification-panel-left", `${left}px`);
      panel.style.removeProperty("--notification-panel-right");
    } else {
      panel.style.setProperty("--notification-panel-right", `${right}px`);
      panel.style.removeProperty("--notification-panel-left");
    }

    if (buttonCenterY <= window.innerHeight / 2) {
      const top = Math.max(viewportPadding, rect.bottom + gap);
      panel.style.setProperty("--notification-panel-top", `${top}px`);
      panel.style.removeProperty("--notification-panel-bottom");
    } else {
      const bottom = Math.max(viewportPadding, window.innerHeight - rect.top + gap);
      panel.style.removeProperty("--notification-panel-top");
      panel.style.setProperty("--notification-panel-bottom", `${bottom}px`);
    }
    return;
  }

  const panelWidth = Math.min(420, Math.max(292, window.innerWidth - viewportPadding * 2));
  const top = Math.min(
    window.innerHeight - viewportPadding,
    Math.max(viewportPadding, rect.bottom + gap)
  );

  panel.style.setProperty("--notification-panel-width", `${panelWidth}px`);
  panel.style.setProperty("--notification-panel-right", `${right}px`);
  panel.style.removeProperty("--notification-panel-left");
  panel.style.setProperty("--notification-panel-top", `${top}px`);
  panel.style.removeProperty("--notification-panel-bottom");
}

function createNotificationPanelHeader(notifications) {
  const header = document.createElement("header");
  header.className = "notification-panel__header";
  header.dataset.id = "header";

  const heading = document.createElement("div");
  heading.className = "notification-panel__heading";

  const title = document.createElement("h2");
  title.className = "notification-panel__title";
  title.textContent = "Notificaciones";

  const unreadCount = notifications.filter((notification) => !notification.read).length;
  const subtitle = document.createElement("span");
  subtitle.className = "notification-panel__subtitle";
  subtitle.textContent = unreadCount ? `${unreadCount} sin abrir` : "Actividad reciente";

  const closeButton = document.createElement("button");
  closeButton.className = "notification-panel__close";
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Cerrar notificaciones");
  closeButton.dataset.closeNotifications = "true";

  heading.append(title, subtitle);
  header.append(heading, closeButton);
  return header;
}

function hexToRgb(hex) {
  const normalized = (hex || "").replace(/^#/, "");
  if (normalized.length === 3) {
    const r = parseInt(normalized[0] + normalized[0], 16) || 0;
    const g = parseInt(normalized[1] + normalized[1], 16) || 0;
    const b = parseInt(normalized[2] + normalized[2], 16) || 0;
    return { r, g, b };
  }
  const r = parseInt(normalized.slice(0, 2), 16) || 0;
  const g = parseInt(normalized.slice(2, 4), 16) || 0;
  const b = parseInt(normalized.slice(4, 6), 16) || 0;
  return { r, g, b };
}

function colorDistance(c1, c2) {
  return Math.sqrt(
    Math.pow(c1.r - c2.r, 2) +
    Math.pow(c1.g - c2.g, 2) +
    Math.pow(c1.b - c2.b, 2)
  );
}

const EASTER_EGGS = [
  {
    id: "cocacola",
    name: "Coca-Cola",
    hex: "#F40009",
    title: "Destapa la felicidad (pero no hay notificaciones)",
    draw: (accentColor) => `
      <svg viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M30 82c6 3 30 3 36 0" stroke="rgba(0,0,0,0.15)" stroke-width="4" stroke-linecap="round" />
        <!-- Symmetrical Cap -->
        <rect x="42" y="16" width="12" height="5" rx="1" fill="#a2aaad" stroke="#1f1a17" stroke-width="3" />
        <!-- Classic Contour Glass Bottle Silhouette -->
        <path d="M44 21h8v4c0 1 2 2 2 4l-1 12c-1 3 3 5 3 9v16c0 6-4 10-10 10H46c-6 0-10-4-10-10V49c0-4 4-6 3-9l-1-12c0-2 2-3 2-4v-4Z" fill="${accentColor}" stroke="#1f1a17" stroke-width="3" stroke-linejoin="round" />
        <!-- Glass ridges -->
        <path d="M45 44v20M48 43v22M51 44v20" stroke="rgba(255,255,255,0.22)" stroke-width="1.8" stroke-linecap="round" />
        <!-- Arms (Waving pose) -->
        <path d="M30 46c-6-4-10-8-12-14" stroke="#1f1a17" stroke-width="3" stroke-linecap="round" fill="none" />
        <path d="M66 46c6 1 10 6 12 12" stroke="#1f1a17" stroke-width="3" stroke-linecap="round" fill="none" />
        <!-- Face Expression: Normal Smile -->
        <circle cx="43" cy="46" r="2.2" fill="#1f1a17" />
        <circle cx="53" cy="46" r="2.2" fill="#1f1a17" />
        <path d="M46 49q2 1.5 4 0" stroke="#1f1a17" stroke-width="1.6" stroke-linecap="round" fill="none" />
      </svg>
    `
  },
  {
    id: "pepsi",
    name: "Pepsi",
    hex: "#003087",
    title: "Toma Topy-Pepsi (aunque sigas sin notificaciones)",
    draw: (accentColor) => `
      <svg viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M28 82c8 3 32 3 40 0" stroke="rgba(0,0,0,0.15)" stroke-width="4" stroke-linecap="round" />
        <!-- Symmetrical Can Body -->
        <rect x="35" y="24" width="26" height="50" rx="4" fill="${accentColor}" stroke="#1f1a17" stroke-width="3" />
        <!-- Rims -->
        <ellipse cx="48" cy="24" rx="13" ry="3" fill="#a2aaad" stroke="#1f1a17" stroke-width="3" />
        <ellipse cx="48" cy="74" rx="13" ry="3" fill="#a2aaad" stroke="#1f1a17" stroke-width="3" />
        <!-- Red/White Striped Straw -->
        <line x1="43" y1="12" x2="38" y2="24" stroke="#ff4500" stroke-width="3.2" stroke-linecap="round" />
        <line x1="43" y1="12" x2="38" y2="24" stroke="#ffffff" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="2.5 2.5" />
        <!-- Can tab -->
        <ellipse cx="48" cy="22" rx="3.5" ry="1.5" fill="none" stroke="#a2aaad" stroke-width="2" />
        <!-- Highlight shine -->
        <path d="M37 26 L47 26 L39 72 L37 72 Z" fill="#ffffff" opacity="0.12" />
        <!-- Arms -->
        <path d="M35 48c-4 2-6 8-4 12" stroke="#1f1a17" stroke-width="3" stroke-linecap="round" fill="none" />
        <path d="M61 48c4 2 6 8 4 12" stroke="#1f1a17" stroke-width="3" stroke-linecap="round" fill="none" />
        <!-- Face Expression: Serious / Neutral -->
        <circle cx="42" cy="38" r="2.5" fill="#1f1a17" />
        <circle cx="54" cy="38" r="2.5" fill="#1f1a17" />
        <line x1="45" y1="42" x2="51" y2="42" stroke="#1f1a17" stroke-width="1.8" stroke-linecap="round" />
      </svg>
    `
  },
  {
    id: "mcdonalds",
    name: "McDonald's",
    hex: "#FFC72C",
    title: "Me encanta... ver que no tienes notificaciones",
    draw: (accentColor) => `
      <svg viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M26 82c8 3 36 3 44 0" stroke="rgba(0,0,0,0.15)" stroke-width="4" stroke-linecap="round" />
        <!-- Symmetrical yellow fries -->
        <rect x="37" y="20" width="4" height="20" rx="1.5" fill="${accentColor}" stroke="#1f1a17" stroke-width="2" />
        <rect x="43" y="16" width="5" height="24" rx="2" fill="${accentColor}" stroke="#1f1a17" stroke-width="2" />
        <rect x="50" y="14" width="4" height="26" rx="1.5" fill="${accentColor}" stroke="#1f1a17" stroke-width="2" />
        <rect x="55" y="18" width="4" height="22" rx="1.5" fill="${accentColor}" stroke="#1f1a17" stroke-width="2" />
        <!-- Symmetrical carton box -->
        <path d="M32 40 L35 76 H61 L64 40 Z" fill="#dd2222" stroke="#1f1a17" stroke-width="3" stroke-linejoin="round" />
        <!-- Arms -->
        <path d="M28 44c-4-6-10-8-12-6" stroke="#1f1a17" stroke-width="3" stroke-linecap="round" fill="none" />
        <path d="M68 44c4-6 10-8 12-6" stroke="#1f1a17" stroke-width="3" stroke-linecap="round" fill="none" />
        <!-- Face Expression: Surprised (o_o) -->
        <circle cx="39" cy="48" r="3" fill="#1f1a17" />
        <circle cx="57" cy="48" r="3" fill="#1f1a17" />
        <circle cx="48" cy="53" r="2.5" fill="#1f1a17" />
      </svg>
    `
  },
  {
    id: "starbucks",
    name: "Starbucks",
    hex: "#00704A",
    title: "Vaso grande de notificaciones vacías",
    draw: (accentColor) => `
      <svg viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M28 82c8 3 32 3 40 0" stroke="rgba(0,0,0,0.15)" stroke-width="4" stroke-linecap="round" />
        <!-- Straw -->
        <rect x="46" y="12" width="4" height="10" fill="${accentColor}" stroke="#1f1a17" stroke-width="2" />
        <!-- Green lid -->
        <rect x="32" y="22" width="32" height="5" rx="1" fill="${accentColor}" stroke="#1f1a17" stroke-width="3" />
        <!-- White paper cup -->
        <path d="M34 27 L38 76 H58 L62 27 Z" fill="#ffffff" stroke="#1f1a17" stroke-width="3" stroke-linejoin="round" />
        <!-- Starbucks green circle sleeve/logo -->
        <path d="M36 44 L37 58 H59 L60 44 Z" fill="${accentColor}" stroke="#1f1a17" stroke-width="2" stroke-linejoin="round" />
        <!-- Donut -->
        <circle cx="48" cy="66" r="4.5" fill="#d2691e" stroke="#1f1a17" stroke-width="1.5" />
        <circle cx="48" cy="66" r="1.5" fill="#ffffff" />
        <!-- Face Expression: Sleepy -->
        <path d="M40 48c0.8 1.5 2.5 1.5 3.2 0" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" fill="none" />
        <path d="M52 48c0.8 1.5 2.5 1.5 3.2 0" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" fill="none" />
        <circle cx="48" cy="52" r="2" fill="#ffffff" />
      </svg>
    `
  },
  {
    id: "facebook",
    name: "Facebook",
    hex: "#1877F2",
    title: "No le gusta a nadie (0 notificaciones)",
    draw: (accentColor) => `
      <svg viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path class="notification-panel__empty-shadow" d="M27 78c7 4 34 4 42 0" />
        <!-- Book Cover -->
        <rect x="32" y="22" width="32" height="52" rx="4" fill="${accentColor}" stroke="#1f1a17" stroke-width="3" />
        <!-- Book Pages -->
        <path d="M64 26v44h4V26h-4Z" fill="#faf0e6" stroke="#1f1a17" stroke-width="2" />
        <!-- Book Spine -->
        <rect x="29" y="22" width="4" height="52" rx="1" fill="#152428" />
        <!-- Arms -->
        <path d="M32 54c-4 2-6 8-2 10" stroke="#1f1a17" stroke-width="2.5" stroke-linecap="round" fill="none" />
        <!-- Glasses -->
        <circle cx="42" cy="43" r="5" stroke="#1f1a17" stroke-width="2.2" fill="none" />
        <circle cx="54" cy="43" r="5" stroke="#1f1a17" stroke-width="2.2" fill="none" />
        <line x1="47" y1="43" x2="49" y2="43" stroke="#1f1a17" stroke-width="2.2" />
        <!-- Small eyes -->
        <circle cx="42" cy="43" r="1.5" fill="#1f1a17" />
        <circle cx="54" cy="43" r="1.5" fill="#1f1a17" />
        <!-- Smile -->
        <path d="M46 51q2 1.5 4 0" stroke="#1f1a17" stroke-width="1.6" stroke-linecap="round" fill="none" />
      </svg>
    `
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    hex: "#25D366",
    title: "Silenciado para siempre (no hay notificaciones)",
    draw: (accentColor) => `
      <svg viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M26 82c8 3 36 3 44 0" stroke="rgba(0,0,0,0.15)" stroke-width="4" stroke-linecap="round" />
        <!-- Symmetrical single-path speech bubble -->
        <path d="M48 20c-14.4 0-26 10.7-26 24 0 5 1.4 9.6 3.8 13.5L22 69l12.5-3.3c3.8 2.5 8.4 3.9 13.5 3.9 14.4 0 26-10.7 26-24S62.4 20 48 20Z" fill="${accentColor}" stroke="#1f1a17" stroke-width="3" stroke-linejoin="round" />
        <!-- WhatsApp 2 Meme: Clean official phone receiver centered, with a big bold "2" badge overlapping on top -->
        <!-- White phone receiver -->
        <g transform="translate(21.6, 17.6) scale(2.2)">
          <path d="M17.66 16.577c-.24.67-1.4 1.24-1.9 1.32-.48.08-.96.1-1.34.02-.38-.08-1-.34-2.22-.86-2.58-1.07-4.22-3.7-4.35-3.87-.13-.17-1-1.33-1-2.54s.62-1.8 1-1.92c.16-.06.32-.1.48-.1.16 0 .32 0 .46.06.14.06.34.08.52.52.18.44.62 1.52.68 1.64.06.12.1.26.02.42-.08.16-.18.26-.3.4-.12.14-.26.32-.38.42-.14.12-.28.26-.12.54.16.28.71 1.18 1.53 1.91.82.73 1.51 1.25 1.79 1.37.28.12.44.1.6-.08.16-.18.68-.8 1-.92.12-.12.26-.08.42-.02.16.06 1.02.48 1.2.58.18.1.3.14.34.22.04.08.04.48-.2.16" fill="#ffffff" />
        </g>
        <!-- Big bold "2" badge for WhatsApp 2 -->
        <text x="62" y="62" font-family="'Outfit', 'Inter', sans-serif" font-size="28" font-weight="900" fill="#ffffff" stroke="#1f1a17" stroke-width="4.5" paint-order="stroke fill" text-anchor="middle">2</text>
      </svg>
    `
  },
  {
    id: "barbie",
    name: "Barbie",
    hex: "#E0218A",
    title: "Sé lo que quieras ser (incluso sin notificaciones)",
    draw: (accentColor) => `
      <svg viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path class="notification-panel__empty-shadow" d="M27 78c7 4 34 4 42 0" />
        <!-- Cute Heart Mascot -->
        <path d="M48 34 C44 24, 28 24, 28 38 C28 52, 48 68, 48 68 C48 68, 68 52, 68 38 C68 24, 52 24, 48 34 Z" fill="${accentColor}" stroke="#1f1a17" stroke-width="3" stroke-linejoin="round" />
        <!-- Gold Crown on head -->
        <path d="M34 26l2-4l4 4l4-4l2 4Z" fill="#ffd700" stroke="#1f1a17" stroke-width="1.5" stroke-linejoin="round" />
        <!-- Face Expression: Normal Smile -->
        <circle cx="41" cy="40" r="2.5" fill="#1f1a17" />
        <circle cx="55" cy="40" r="2.5" fill="#1f1a17" />
        <path d="M46 44q2 1.5 4 0" stroke="#1f1a17" stroke-width="1.6" stroke-linecap="round" fill="none" />
      </svg>
    `
  },
  {
    id: "apple",
    name: "Apple",
    hex: "#FFFFFF",
    title: "Piensa diferente (cero notificaciones)",
    draw: (accentColor) => `
      <svg viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path class="notification-panel__empty-shadow" d="M27 78c7 4 34 4 42 0" />
        <!-- White Pear/Apple Character (Satire of Apple logo) -->
        <path d="M48 24c-6 0-11 4-11 10 0 8 5 22 11 22s11-14 11-22c0-6-5-10-11-10Z" fill="${accentColor}" stroke="#1f1a17" stroke-width="3" stroke-linejoin="round" />
        <!-- Green leaf on top -->
        <path d="M48 24c0-4 3-6 5-6s2 3 0 5-5 1-5 1Z" fill="#25d366" stroke="#1f1a17" stroke-width="1.5" />
        <!-- Face Expression: Normal Smile -->
        <circle cx="43" cy="38" r="2.5" fill="#1f1a17" />
        <circle cx="53" cy="38" r="2.5" fill="#1f1a17" />
        <path d="M46 42q2 1.5 4 0" stroke="#1f1a17" stroke-width="1.6" stroke-linecap="round" fill="none" />
      </svg>
    `
  },
  {
    id: "zara",
    name: "Zara",
    hex: "#1A1A1A",
    title: "Estilo elegante (pero sin notificaciones)",
    draw: (accentColor) => `
      <svg viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path class="notification-panel__empty-shadow" d="M27 78c7 4 34 4 42 0" />
        <!-- Handles of the bag -->
        <path d="M40 32a8 8 0 0 1 16 0" stroke="#1f1a17" stroke-width="3" fill="none" />
        <!-- Black shopping bag -->
        <rect x="32" y="32" width="32" height="40" fill="${accentColor}" stroke="#1f1a17" stroke-width="3" stroke-linejoin="round" />
        <!-- Face Expression: Normal Smile -->
        <circle cx="42" cy="46" r="2.5" fill="#ffffff" />
        <circle cx="54" cy="46" r="2.5" fill="#ffffff" />
        <path d="M45 50q3 2 6 0" stroke="#ffffff" stroke-width="2" stroke-linecap="round" fill="none" />
      </svg>
    `
  }
];

const GENERIC_MASCOTS = [
  {
    id: "rojo",
    name: "Rojo",
    hex: "#F40009",
    title: "Frutilla (cero notificaciones)",
    draw: (accentColor) => `
      <svg viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path class="notification-panel__empty-shadow" d="M27 78c7 4 34 4 42 0" />
        <!-- Strawberry Body -->
        <path d="M48 24 C40 24, 30 28, 30 46 C30 64, 48 76, 48 76 C48 76, 66 64, 66 46 C66 28, 56 24, 48 24 Z" fill="${accentColor}" stroke="#1f1a17" stroke-width="3" stroke-linejoin="round" />
        <!-- Seeds -->
        <circle cx="38" cy="42" r="1.2" fill="#ffd700" />
        <circle cx="44" cy="50" r="1.2" fill="#ffd700" />
        <circle cx="52" cy="50" r="1.2" fill="#ffd700" />
        <circle cx="58" cy="42" r="1.2" fill="#ffd700" />
        <circle cx="48" cy="60" r="1.2" fill="#ffd700" />
        <!-- Green leaf crown -->
        <path d="M38 25 C42 20, 44 16, 48 22 C52 16, 54 20, 58 25 C54 26, 42 26, 38 25 Z" fill="#34c759" stroke="#1f1a17" stroke-width="1.5" />
        <!-- Face Expression: Normal Smile -->
        <circle cx="43" cy="40" r="2.5" fill="#1f1a17" />
        <circle cx="53" cy="40" r="2.5" fill="#1f1a17" />
        <path d="M46 44q2 1.5 4 0" stroke="#1f1a17" stroke-width="1.6" stroke-linecap="round" fill="none" />
      </svg>
    `
  },
  {
    id: "naranja",
    name: "Naranja",
    hex: "#FF6600",
    title: "Naranja (cero notificaciones)",
    draw: (accentColor) => `
      <svg viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path class="notification-panel__empty-shadow" d="M27 78c7 4 34 4 42 0" />
        <!-- Orange Body -->
        <circle cx="48" cy="48" r="22" fill="${accentColor}" stroke="#1f1a17" stroke-width="3" />
        <!-- Green leaf -->
        <path d="M48 26 C48 20, 54 16, 58 18 C58 24, 52 26, 48 26 Z" fill="#34c759" stroke="#1f1a17" stroke-width="1.5" />
        <!-- Branch -->
        <line x1="48" y1="26" x2="48" y2="21" stroke="#1f1a17" stroke-width="3" stroke-linecap="round" />
        <!-- Face Expression: Normal Smile -->
        <circle cx="42" cy="44" r="2.5" fill="#1f1a17" />
        <circle cx="54" cy="44" r="2.5" fill="#1f1a17" />
        <path d="M45 50q3 2 6 0" stroke="#1f1a17" stroke-width="1.8" stroke-linecap="round" fill="none" />
      </svg>
    `
  },
  {
    id: "amarillo",
    name: "Amarillo",
    hex: "#FFC72C",
    title: "Limón (cero notificaciones)",
    draw: (accentColor) => `
      <svg viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path class="notification-panel__empty-shadow" d="M27 78c7 4 34 4 42 0" />
        <!-- Lemon Body -->
        <path d="M26 48 C26 48, 30 40, 48 34 C66 28, 70 48, 70 48 C70 48, 66 56, 48 62 C30 68, 26 48, 26 48 Z" fill="${accentColor}" stroke="#1f1a17" stroke-width="3" stroke-linejoin="round" />
        <!-- Green leaf on top -->
        <path d="M48 34 C48 28, 54 24, 58 26 C58 32, 52 34, 48 34 Z" fill="#34c759" stroke="#1f1a17" stroke-width="1.5" />
        <!-- Face Expression: Normal Smile -->
        <circle cx="42" cy="46" r="2.2" fill="#1f1a17" />
        <circle cx="54" cy="46" r="2.2" fill="#1f1a17" />
        <path d="M45 50q3 2 6 0" stroke="#1f1a17" stroke-width="1.8" stroke-linecap="round" fill="none" />
      </svg>
    `
  },
  {
    id: "verde",
    name: "Verde",
    hex: "#25D366",
    title: "Hoja (cero notificaciones)",
    draw: (accentColor) => `
      <svg viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path class="notification-panel__empty-shadow" d="M27 78c7 4 34 4 42 0" />
        <!-- Green Leaf Body -->
        <path d="M48 22 C32 36, 36 62, 48 74 C60 62, 64 36, 48 22 Z" fill="${accentColor}" stroke="#1f1a17" stroke-width="3" stroke-linejoin="round" />
        <!-- Leaf center vein/stem -->
        <path d="M48 22 V74" stroke="#1f1a17" stroke-width="2" stroke-linecap="round" />
        <!-- Face Expression: Normal Smile -->
        <circle cx="42" cy="48" r="2.2" fill="#1f1a17" />
        <circle cx="54" cy="48" r="2.2" fill="#1f1a17" />
        <path d="M45 52q3 2 6 0" stroke="#1f1a17" stroke-width="1.6" stroke-linecap="round" fill="none" />
      </svg>
    `
  },
  {
    id: "azul",
    name: "Azul",
    hex: "#003087",
    title: "Gota de agua (cero notificaciones)",
    draw: (accentColor) => `
      <svg viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path class="notification-panel__empty-shadow" d="M27 78c7 4 34 4 42 0" />
        <!-- Raindrop Body -->
        <path d="M48 22 C48 22, 30 46, 30 56 C30 66, 38 74, 48 74 C58 74, 66 66, 66 56 C66 46, 48 22, 48 22 Z" fill="${accentColor}" stroke="#1f1a17" stroke-width="3" stroke-linejoin="round" />
        <!-- Shimmer shine -->
        <path d="M36 54 A 12 12 0 0 1 44 42" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.35" />
        <!-- Face Expression: Normal Smile -->
        <circle cx="43" cy="54" r="2.5" fill="#1f1a17" />
        <circle cx="53" cy="54" r="2.5" fill="#1f1a17" />
        <path d="M46 59q2 1.5 4 0" stroke="#1f1a17" stroke-width="1.6" stroke-linecap="round" fill="none" />
      </svg>
    `
  },
  {
    id: "violeta",
    name: "Violeta",
    hex: "#E0218A",
    title: "Uvas (cero notificaciones)",
    draw: (accentColor) => `
      <svg viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path class="notification-panel__empty-shadow" d="M27 78c7 4 34 4 42 0" />
        <!-- Grape Stem -->
        <path d="M48 27 C48 20, 52 18, 52 18" stroke="#1f1a17" stroke-width="3" fill="none" stroke-linecap="round" />
        <!-- Grapes -->
        <circle cx="48" cy="36" r="9" fill="${accentColor}" stroke="#1f1a17" stroke-width="2" />
        <circle cx="39" cy="45" r="9" fill="${accentColor}" stroke="#1f1a17" stroke-width="2" />
        <circle cx="57" cy="45" r="9" fill="${accentColor}" stroke="#1f1a17" stroke-width="2" />
        <circle cx="48" cy="54" r="9" fill="${accentColor}" stroke="#1f1a17" stroke-width="2" />
        <circle cx="39" cy="63" r="9" fill="${accentColor}" stroke="#1f1a17" stroke-width="2" />
        <circle cx="57" cy="63" r="9" fill="${accentColor}" stroke="#1f1a17" stroke-width="2" />
        <circle cx="48" cy="72" r="9" fill="${accentColor}" stroke="#1f1a17" stroke-width="2" />
        <!-- Face Expression: Normal Smile -->
        <circle cx="44" cy="51" r="2" fill="#1f1a17" />
        <circle cx="52" cy="51" r="2" fill="#1f1a17" />
        <path d="M46 55q2 1.5 4 0" stroke="#1f1a17" stroke-width="1.6" stroke-linecap="round" fill="none" />
      </svg>
    `
  },
  {
    id: "blanco",
    name: "Blanco",
    hex: "#FFFFFF",
    title: "Yin (cero notificaciones)",
    draw: () => `
      <svg viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path class="notification-panel__empty-shadow" d="M27 78c7 4 34 4 42 0" />
        <!-- Yin (White half of Yin Yang) -->
        <path d="M48 18 A26 26 0 0 0 48 70 A13 13 0 0 0 48 44 A13 13 0 0 1 48 18 Z" fill="#ffffff" stroke="#1f1a17" stroke-width="3" />
        <!-- Black dot in white half -->
        <circle cx="48" cy="31" r="4.5" fill="#1a1a1a" />
        <!-- Cute face on the white half -->
        <circle cx="38" cy="44" r="2" fill="#1f1a17" />
        <circle cx="44" cy="44" r="2" fill="#1f1a17" />
        <path d="M39 47q1 1 2 0" stroke="#1f1a17" stroke-width="1" stroke-linecap="round" fill="none" />
      </svg>
    `
  },
  {
    id: "negro",
    name: "Negro",
    hex: "#1A1A1A",
    title: "Yang (cero notificaciones)",
    draw: () => `
      <svg viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path class="notification-panel__empty-shadow" d="M27 78c7 4 34 4 42 0" />
        <!-- Yang (Black half of Yin Yang) -->
        <path d="M48 18 A26 26 0 0 1 48 70 A13 13 0 0 1 48 44 A13 13 0 0 0 48 18 Z" fill="#1a1a1a" stroke="#1f1a17" stroke-width="3" />
        <!-- White dot in black half -->
        <circle cx="48" cy="57" r="4.5" fill="#ffffff" />
        <!-- Cute face on the black half -->
        <circle cx="52" cy="44" r="2" fill="#ffffff" />
        <circle cx="58" cy="44" r="2" fill="#ffffff" />
        <path d="M53 47q1 1 2 0" stroke="#ffffff" stroke-width="1" stroke-linecap="round" fill="none" />
      </svg>
    `
  }
];

const BRANDS = [...EASTER_EGGS, ...GENERIC_MASCOTS];

function findBrand(hexColor) {
  const c = hexToRgb(hexColor);

  // 1. Check Easter Eggs first with a tight threshold (distance < 4)
  for (const brand of EASTER_EGGS) {
    const brandColor = hexToRgb(brand.hex);
    if (colorDistance(c, brandColor) < 4) {
      return brand;
    }
  }

  // 2. Otherwise, fallback to matching the closest generic mascot (any distance)
  let bestGeneric = null;
  let minDistance = Infinity;
  for (const mascot of GENERIC_MASCOTS) {
    const mascotColor = hexToRgb(mascot.hex);
    const dist = colorDistance(c, mascotColor);
    if (dist < minDistance) {
      minDistance = dist;
      bestGeneric = mascot;
    }
  }
  return bestGeneric;
}

function getProceduralMascot(hexColor) {
  const hexVal = (hexColor || "").replace(/^#/, "");
  const r = parseInt(hexVal.slice(0, 2), 16) || 0;
  const g = parseInt(hexVal.slice(2, 4), 16) || 0;
  const b = parseInt(hexVal.slice(4, 6), 16) || 0;
  const seed = r + g + b;

  let bodyPath = "";
  if (seed % 3 === 0) {
    bodyPath = `
      <path class="notification-panel__empty-body" d="M31 42c0-12 8-22 19-22s19 10 19 22v16c0 10-8 18-19 18s-19-8-19-18V42Z" />
    `;
  } else if (seed % 3 === 1) {
    bodyPath = `
      <path class="notification-panel__empty-body" d="M28 44c0-14 10-24 22-24s22 10 22 24v12c0 12-10 20-22 20s-22-8-22-20V44Z" />
    `;
  } else {
    bodyPath = `
      <path class="notification-panel__empty-body" d="M34 40c0-10 7-18 16-18s16 8 16 18v22c0 8-7 14-16 14s-16-6-16-14V40Z" />
    `;
  }

  let facePath = "";

  if (seed % 4 === 0) {
    facePath = `
      <!-- Left Eye (Solid black dot) -->
      <circle cx="41" cy="45" r="4.5" fill="var(--text)" />
      <!-- Right Eye (Solid black dot) -->
      <circle cx="59" cy="45" r="4.5" fill="var(--text)" />
    `;
  } else if (seed % 4 === 1) {
    facePath = `
      <!-- Left Eye (Wink) -->
      <path d="M37 45c1-1.5 3-1.5 5 0" stroke="var(--text)" stroke-width="3" stroke-linecap="round" fill="none" />
      <!-- Right Eye (Solid black dot) -->
      <circle cx="59" cy="45" r="4.5" fill="var(--text)" />
    `;
  } else if (seed % 4 === 2) {
    facePath = `
      <path d="M37 45c1-1.5 3-1.5 5 0" stroke="var(--text)" stroke-width="3" stroke-linecap="round" fill="none" />
      <path d="M55 45c1-1.5 3-1.5 5 0" stroke="var(--text)" stroke-width="3" stroke-linecap="round" fill="none" />
    `;
  } else {
    facePath = `
      <!-- Left Eye (Solid black dot) -->
      <circle cx="41" cy="45" r="3.2" fill="var(--text)" />
      <!-- Right Eye (Solid black dot) -->
      <circle cx="59" cy="45" r="3.2" fill="var(--text)" />
      <!-- Glasses Frame -->
      <circle cx="41" cy="45" r="6.5" stroke="var(--text)" stroke-width="2.2" fill="none" />
      <circle cx="59" cy="45" r="6.5" stroke="var(--text)" stroke-width="2.2" fill="none" />
      <path d="M47.5 45h5" stroke="var(--text)" stroke-width="2.2" />
    `;
  }

  let mouthPath = "";
  if (seed % 3 === 0) {
    mouthPath = `<path d="M47 51q1.5 2 3 0q1.5 2 3 0" stroke="var(--text)" stroke-width="2.2" stroke-linecap="round" fill="none" />`;
  } else if (seed % 3 === 1) {
    mouthPath = `
      <circle cx="50" cy="51" r="2.2" fill="var(--text)" />
    `;
  } else {
    mouthPath = `<path d="M47 51q3 2.5 6 0" stroke="var(--text)" stroke-width="2.2" stroke-linecap="round" fill="none" />`;
  }

  let armPath = "";
  if (seed % 2 === 0) {
    armPath = `
      <path class="notification-panel__empty-arm" d="M29 50c-8 1-13 6-15 13" />
      <path class="notification-panel__empty-arm" d="M71 50c8 1 13 6 15 13" />
    `;
  } else {
    armPath = `
      <path class="notification-panel__empty-arm" d="M29 50c-6-4-10-8-12-14" />
      <path class="notification-panel__empty-arm" d="M71 50c8 1 13 6 15 13" />
    `;
  }

  let accessory = "";
  if (seed % 5 === 0) {
    accessory = `<path d="M43 20l7-12l7 12Z" fill="${hexColor}" stroke="var(--accent-strong)" stroke-width="4" stroke-linejoin="round" />`;
  } else if (seed % 5 === 1) {
    accessory = `<path d="M46 68l4-2l4 2l-2-3l2-3l-4 2l-4-2l2 3Z" fill="${hexColor}" stroke="var(--accent-strong)" stroke-width="3" />`;
  } else if (seed % 5 === 2) {
    accessory = `<ellipse cx="50" cy="10" rx="10" ry="3" stroke="#ffd700" stroke-width="3" fill="none" />`;
  }

  return `
    <svg viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path class="notification-panel__empty-shadow" d="M27 78c7 4 34 4 42 0" />
      ${bodyPath}
      ${armPath}
      ${facePath}
      ${mouthPath}
      <path class="notification-panel__empty-bell" d="M50 13v6" />
      ${accessory}
    </svg>
  `;
}

export function createNotificationEmptyState(state) {
  const empty = document.createElement("section");
  empty.className = "notification-panel__empty";
  empty.setAttribute("aria-live", "polite");

  const hexColor = state
    ? getActiveAccentColor(state.theme, state.paletteId, state.customPaletteHex)
    : "#B25B33";

  const rawCustomHex = state?.customPaletteHex || "#B25B33";
  const isCustom = state && state.paletteId === "custom";
  const brand = isCustom ? findBrand(rawCustomHex) : null;
  let mascotSvg = "";
  let titleText = "Aun no hay comentarios";

  if (brand) {
    mascotSvg = brand.draw(rawCustomHex);
  } else {
    mascotSvg = getProceduralMascot(hexColor);
  }

  const mascot = document.createElement("span");
  mascot.className = "notification-panel__empty-mascot";
  mascot.setAttribute("aria-hidden", "true");
  mascot.style.setProperty("--accent", hexColor);
  mascot.innerHTML = mascotSvg;

  const title = document.createElement("strong");
  title.className = "notification-panel__empty-title";
  title.textContent = titleText;

  const copy = document.createElement("span");
  copy.className = "notification-panel__empty-copy";
  copy.textContent = "Cuando alguien comente, cite o reaccione a tus posteos, aparecera aca.";

  empty.append(mascot, title, copy);
  return empty;
}

function getInitials(name) {
  return String(name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase() || "?";
}

function appendSvgPath(svg, tagName, attributes) {
  const node = document.createElementNS(SVG_NS, tagName);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  svg.append(node);
}

function createEventIcon(kind) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  if (LIKE_NOTIFICATION_KINDS.has(kind)) {
    appendSvgPath(svg, "path", { d: "M20.8 4.6a5.4 5.4 0 0 0-7.6 0L12 5.8l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.8a5.4 5.4 0 0 0 0-7.6Z" });
  } else if (kind === "post-comment") {
    appendSvgPath(svg, "path", { d: "M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" });
  } else if (kind === "quote") {
    appendSvgPath(svg, "path", { d: "M8 21H4a2 2 0 0 1-2-2v-7a7 7 0 0 1 7-7" });
    appendSvgPath(svg, "path", { d: "M22 21h-4a2 2 0 0 1-2-2v-7a7 7 0 0 1 7-7" });
  } else if (kind === "mention") {
    appendSvgPath(svg, "circle", { cx: "12", cy: "12", r: "4" });
    appendSvgPath(svg, "path", { d: "M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" });
  } else {
    appendSvgPath(svg, "path", { d: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20" });
    appendSvgPath(svg, "path", { d: "M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" });
  }

  return svg;
}

function createNotificationGlyph(kind) {
  const node = document.createElement("span");
  node.className = `notification-toast__glyph notification-toast__glyph--${kind}`;
  node.setAttribute("aria-hidden", "true");
  node.append(createEventIcon(kind));
  return node;
}

function createActorStack(actors, kind) {
  const marker = document.createElement("span");
  marker.className = "notification-toast__marker";
  marker.setAttribute("aria-hidden", "true");

  const icon = document.createElement("span");
  icon.className = `notification-toast__event notification-toast__event--${kind}`;
  icon.append(createEventIcon(kind));

  const stack = document.createElement("span");
  stack.className = "notification-toast__avatars";
  actors.slice(0, 1).forEach((actor) => {
    const avatar = document.createElement("span");
    avatar.className = "notification-toast__avatar";
    if (actor.avatarUrl) {
      const image = document.createElement("img");
      image.src = actor.avatarUrl;
      image.alt = "";
      avatar.append(image);
    } else {
      avatar.textContent = getInitials(actor.name);
    }
    stack.append(avatar);
  });

  marker.append(icon, stack);
  return marker;
}

function appendStrong(parent, text) {
  const strong = document.createElement("strong");
  strong.textContent = text;
  parent.append(strong);
}

function appendNotificationText(parent, text) {
  parent.append(document.createTextNode(text));
}

function appendGroupedActivityBody(parent, notification) {
  const actors = notification.actors || [];
  const names = actors.map((actor) => actor.name).filter(Boolean);
  const visibleNames = names.slice(0, 2);
  const totalCount = Math.max(notification.totalCount || 0, names.length);
  const extraCount = Math.max(0, totalCount - visibleNames.length);

  if (!visibleNames.length) {
    appendStrong(parent, `${totalCount} personas`);
  } else {
    visibleNames.forEach((name, index) => {
      if (index > 0) {
        appendNotificationText(parent, ", ");
      }
      appendStrong(parent, name);
    });
  }

  if (extraCount > 0) {
    appendNotificationText(parent, " y ");
    appendStrong(parent, `${extraCount} ${extraCount === 1 ? "persona mas" : "personas mas"}`);
  }

  appendNotificationText(parent, ` ${getActivityVerb(notification.kind, totalCount)} ${getActivityTargetLabel(notification.kind)}.`);
}

function appendDefaultBody(parent, notification) {
  const match = String(notification.body || "").match(/^([^:]{1,64}):\s*(.+)$/);
  if (match) {
    appendStrong(parent, match[1]);
    appendNotificationText(parent, `: ${match[2]}`);
    return;
  }
  appendNotificationText(parent, notification.body || notification.title || "Nueva actividad.");
}

function appendNotificationBody(parent, notification) {
  if (GROUPED_NOTIFICATION_KINDS.has(notification.kind)) {
    appendGroupedActivityBody(parent, notification);
    return;
  }
  appendDefaultBody(parent, notification);
}

function formatNotificationAge(createdAt, now = Date.now()) {
  const timestamp = new Date(createdAt).getTime();
  if (!Number.isFinite(timestamp)) {
    return "";
  }

  const elapsedMinutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (elapsedMinutes < 1) {
    return "Ahora";
  }
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes} min`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours} h`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) {
    return `${elapsedDays} d`;
  }

  return new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(timestamp);
}

function createToast(notification) {
  const node = document.createElement("button");
  node.className = `notification-toast notification-toast--${notification.kind} ${notification.read ? "notification-toast--read" : "notification-toast--unread"}`;
  node.type = "button";
  node.dataset.id = notification.id;
  node.dataset.notificationId = (notification.notificationIds || [notification.id]).join(",");
  node.dataset.openNotificationTopic = notification.topicId;

  const marker = GROUPED_NOTIFICATION_KINDS.has(notification.kind)
    ? createActorStack(notification.actors || [], notification.kind)
    : createNotificationGlyph(notification.kind);

  const text = document.createElement("span");
  text.className = "notification-toast__text";

  const body = document.createElement("span");
  body.className = "notification-toast__body";
  appendNotificationBody(body, notification);

  const meta = document.createElement("span");
  meta.className = "notification-toast__meta";

  const topic = document.createElement("span");
  topic.className = "notification-toast__topic";
  topic.textContent = notification.topicTitle || "Actividad";

  const age = formatNotificationAge(notification.createdAt);
  meta.append(topic);
  if (age) {
    const time = document.createElement("time");
    time.className = "notification-toast__time";
    time.dateTime = new Date(notification.createdAt).toISOString();
    time.textContent = age;
    meta.append(time);
  }

  text.append(body, meta);
  node.append(marker, text);
  return node;
}

function syncNotificationButton(state, dom) {
  const button = dom.notificationsButton;
  if (!button) {
    return;
  }

  const notifications = state.notifications || [];
  const notificationCount = notifications.filter((notification) => !notification.read && !notification.seen).length;
  const permission = state.webNotificationsPermission || getWebNotificationPermission();
  button.setAttribute("aria-expanded", String(Boolean(state.isNotificationsPanelOpen)));
  if (typeof document !== "undefined" && document.documentElement?.classList?.contains("is-mobile-viewport")) {
    button.setAttribute("aria-description", "Puedes arrastrar este botón para moverlo");
  } else {
    button.removeAttribute?.("aria-description");
  }
  button.setAttribute("title", notificationCount ? `${notificationCount} notificaciones` : "Notificaciones");
  button.dataset.notificationPermission = permission;
  if (notificationCount > 0) {
    button.dataset.pendingNotifications = notificationCount > 99 ? "99+" : String(notificationCount);
  } else {
    delete button.dataset.pendingNotifications;
  }
}

export function renderNotifications(state, dom) {
  syncNotificationButton(state, dom);

  const node = dom.notificationToasts;
  if (!node) {
    return;
  }

  const notifications = state.notifications || [];
  const groupedNotifications = groupNotificationsForDisplay(notifications);
  const isOpen = Boolean(state.isNotificationsPanelOpen);
  positionNotificationPanel(node, dom.notificationsButton);
  node.hidden = !isOpen;
  node.setAttribute("aria-hidden", String(!isOpen));

  const body = document.createElement("div");
  body.className = "notification-panel__body";
  body.dataset.id = "body";
  body.append(
    ...(groupedNotifications.length ? groupedNotifications.map(createToast) : [createNotificationEmptyState(state)])
  );
  reconcile(node, [createNotificationPanelHeader(notifications), body]);
}

export function getWebNotificationPermission() {
  if (typeof Notification === "undefined") {
    return "unsupported";
  }

  return Notification.permission;
}

export async function requestWebNotificationPermission() {
  if (typeof Notification === "undefined") {
    return "unsupported";
  }

  if (Notification.permission !== "default") {
    return Notification.permission;
  }

  return Notification.requestPermission();
}

export function showWebNotification(notification) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") {
    return false;
  }

  const webNotification = new Notification(notification.title, {
    body: `${notification.topicTitle} - ${notification.body}`,
    tag: notification.id,
    renotify: false
  });

  webNotification.onclick = () => {
    globalThis.focus?.();
  };

  return true;
}
