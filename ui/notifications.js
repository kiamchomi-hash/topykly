const NOTIFICATION_LIMIT = 120;
const MESSAGE_PREVIEW_LIMIT = 86;
const MENTION_BOUNDARY = String.raw`(?:^|[^a-z0-9_])`;
const SVG_NS = "http://www.w3.org/2000/svg";

function normalizeToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_]+/g, "");
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
  return [
    viewer?.id,
    viewer?.name,
    viewer?.displayName,
    viewerUser?.name,
    viewerUser?.displayName
  ]
    .map(normalizeToken)
    .filter(Boolean);
}

function messageMentionsViewer(message, mentionTokens) {
  const normalized = String(message?.text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return mentionTokens.some((token) => {
    const mentionPattern = new RegExp(`${MENTION_BOUNDARY}@${token}(?![a-z0-9_])`, "i");
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
    return [{
      id: `toast-${kind}-${messageId}-${nextLikes}`,
      kind,
      topicId: topic.id,
      messageId: `like-${messageId}-${nextLikes}`,
      targetMessageId: messageId,
      totalCount: nextLikes,
      actors: [{ name: "Alguien", avatarUrl: null }],
      title: getNotificationTitle(kind),
      body: `${delta === 1 ? "Alguien dio" : `${delta} personas dieron`} like a ${message.isRoot ? "tu posteo" : "tu comentario"}.`,
      topicTitle: topic.title || "Tema",
      createdAt: now
    }];
  });
}
function truncatePreview(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
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
export function createNotificationStateUpdate(state, notifications) {
  if (!notifications.length) {
    return null;
  }

  const notificationIds = new Set();
  const normalizedNotifications = notifications.map((notification) => ({
    ...notification,
    read: Boolean(notification.read)
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

  const gap = 10;
  const viewportPadding = 12;
  const panelWidth = Math.min(380, Math.max(292, window.innerWidth - viewportPadding * 2));
  const right = Math.max(viewportPadding, window.innerWidth - rect.right);
  const top = Math.min(
    window.innerHeight - viewportPadding,
    Math.max(viewportPadding, rect.bottom + gap)
  );

  panel.style.setProperty("--notification-panel-width", `${panelWidth}px`);
  panel.style.setProperty("--notification-panel-right", `${right}px`);
  panel.style.setProperty("--notification-panel-top", `${top}px`);
}

function createNotificationPanelHeader() {
  const header = document.createElement("header");
  header.className = "notification-panel__header";
  const title = document.createElement("h1");
  title.className = "notification-panel__title";
  title.textContent = "Notificaciones";
  const closeButton = document.createElement("button");
  closeButton.className = "notification-panel__close";
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Cerrar notificaciones");
  closeButton.dataset.closeNotifications = "true";
  header.append(title, closeButton);
  return header;
}

function createNotificationEmptyState() {
  const empty = document.createElement("section");
  empty.className = "notification-panel__empty";
  empty.setAttribute("aria-live", "polite");

  const mascot = document.createElement("span");
  mascot.className = "notification-panel__empty-mascot";
  mascot.setAttribute("aria-hidden", "true");
  mascot.innerHTML = `
    <svg viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path class="notification-panel__empty-shadow" d="M27 78c7 4 34 4 42 0" />
      <path class="notification-panel__empty-body" d="M31 42c0-12 8-22 19-22s19 10 19 22v16c0 10-8 18-19 18s-19-8-19-18V42Z" />
      <path class="notification-panel__empty-arm" d="M29 50c-8 1-13 6-15 13" />
      <path class="notification-panel__empty-arm" d="M71 50c8 1 13 6 15 13" />
      <path class="notification-panel__empty-face" d="M42 48h.01M58 48h.01" />
      <path class="notification-panel__empty-mouth" d="M44 61c4 3 8 3 12 0" />
      <path class="notification-panel__empty-bell" d="M50 13v6" />
    </svg>
  `;

  const title = document.createElement("strong");
  title.className = "notification-panel__empty-title";
  title.textContent = "Aun no hay comentarios";

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
  meta.className = "notification-toast__topic";
  meta.textContent = notification.topicTitle;

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
  const notificationCount = notifications.filter((notification) => !notification.read).length;
  const permission = state.webNotificationsPermission || getWebNotificationPermission();
  button.setAttribute("aria-expanded", String(Boolean(state.isNotificationsPanelOpen)));
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
  node.replaceChildren(
    createNotificationPanelHeader(),
    ...(groupedNotifications.length ? groupedNotifications.map(createToast) : [createNotificationEmptyState()])
  );
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
