import { createAvatarIcon as createProfileAvatar, createIcon } from "./ui/icons.js";
import { formatMessageTime } from "./ui/date-utils.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function getUserName(users, userId, fallback = "Anonimo") {
  return users.find((user) => user.id === userId)?.name ?? fallback;
}

function getUserAvatarUrl(users, userId, currentUserId = null) {
  const user = users.find((entry) => entry.id === userId);
  if (!user) {
    return "";
  }

  return user.avatarUrl || (user.id === currentUserId ? user.avatarPendingUrl : "") || "";
}

function createReportIcon() {
  const icon = el("span", "report-icon");
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3 3.8 18.5h16.4L12 3Z"></path>
      <path d="M12 9v4"></path>
      <path d="M12 17h.01"></path>
    </svg>`;
  return icon;
}

export function createTopicItem(topic, users, selected = false, currentUserId = null, unread = false) {
  const button = el("button", `topic-item${selected ? " is-active" : ""}${unread ? " topic-item--unread" : ""}`);
  button.type = "button";
  button.dataset.id = topic.id;

  const topicCommentCount = topic.messages.filter((message) => message.kind === "user").length;
  const lastCommentAuthor = [...topic.messages].reverse().find((message) => message.kind === "user");
  const lastCommenterName = lastCommentAuthor
    ? getUserName(users, lastCommentAuthor.authorId)
    : "Sin actividad";
  const avatar = createProfileAvatar("topic-item__avatar", getUserAvatarUrl(users, topic.authorId, currentUserId));
  const content = el("span", "topic-item__content");
  const meta = el("span", "topic-item__meta");
  const commentCount = el(
    "span",
    `topic-item__meta-count${unread ? " topic-item__meta-count--unread" : ""}`,
    String(topicCommentCount)
  );
  const separator = el("span", "topic-item__meta-separator", ", ");
  const lastCommenter = el("span", "topic-item__meta-user", lastCommenterName);
  if (lastCommentAuthor) {
    meta.dataset.lastAuthorId = lastCommentAuthor.authorId;
  }
  meta.append(commentCount, separator, lastCommenter);
  content.append(
    el("span", "topic-item__title", topic.title),
    meta
  );

  button.append(avatar, content);
  return button;
}

export function createEmptyState(title, copy = "") {
  const node = el("article", "empty-state");
  node.dataset.id = `empty-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "state"}`;
  node.append(el("p", "empty-state__title", title));
  if (copy) {
    node.append(el("p", "empty-state__copy", copy));
  }
  return node;
}
export function createTopicSkeleton(index) {
  const button = el("button", "topic-item topic-item--skeleton");
  button.type = "button";
  button.disabled = true;
  button.dataset.id = `skeleton-topic-${index}`;

  const avatar = createProfileAvatar();
  const content = el("span", "topic-item__content");
  content.append(
    el("span", "topic-item__title"),
    el("span", "topic-item__meta")
  );

  button.append(avatar, content);
  return button;
}

export function createUserSkeleton(index) {
  const node = el("article", "user-item user-item--skeleton");
  node.dataset.id = `skeleton-user-${index}`;
  const info = el("div", "user-item__info");
  info.append(el("div", "user-item__skeleton-line"));

  const actions = el("div", "user-item__actions");
  actions.append(
    el("div", "user-item__skeleton-circle"),
    el("div", "user-item__skeleton-circle")
  );

  node.append(info, actions);
  return node;
}

export function createRankingSkeleton(index) {
  const node = el("article", `ranking-item ranking-item--skeleton ranking-item--rank-${index + 1}`);
  node.dataset.id = `skeleton-ranking-${index}`;
  const badge = el("span", "ranking-item__badge");
  badge.setAttribute("aria-hidden", "true");

  const content = el("div", "ranking-item__content");
  content.append(
    el("div", "ranking-item__skeleton-line"),
    el("div", "ranking-item__skeleton-line ranking-item__skeleton-line--short")
  );

  node.append(badge, content);
  return node;
}

export function createMessageSkeleton(index) {
  const node = el("article", "message message--skeleton");
  node.dataset.id = `skeleton-message-${index}`;
  node.setAttribute("aria-hidden", "true");

  const avatar = createProfileAvatar("message__avatar");
  const body = el("div", "message__body");
  const meta = el("div", "message__meta");
  meta.append(
    el("span", "message__skeleton-line message__skeleton-line--author"),
    el("span", "message__skeleton-line message__skeleton-line--time")
  );

  body.append(
    meta,
    el("span", "message__skeleton-line message__skeleton-line--text"),
    el("span", "message__skeleton-line message__skeleton-line--text message__skeleton-line--short")
  );
  node.append(avatar, body);
  return node;
}

export function createMessageItem(message, users, { reported = false, currentUserId = null } = {}) {
  const node = el("article", `message${message.kind === "system" ? " message--system" : ""}`);
  node.dataset.id = message.id;
  const author = message.kind === "system" ? "Sistema" : getUserName(users, message.authorId);
  const avatar = createProfileAvatar("message__avatar", getUserAvatarUrl(users, message.authorId, currentUserId));
  const avatarButton = el("button", "message__avatar-button");
  avatarButton.type = "button";
  avatarButton.append(avatar);

  const body = el("div", "message__body");
  const meta = el("div", "message__meta");
  meta.append(
    el("span", "message__author", author),
    el("span", "message__time", formatMessageTime(message.timestamp))
  );

  if (message.kind !== "system") {
    avatarButton.dataset.messageMenuTrigger = message.id;
    avatarButton.dataset.messageAuthorId = message.authorId;
    avatarButton.setAttribute("aria-label", `Abrir opciones de ${author}`);
    avatarButton.setAttribute("aria-expanded", "false");

    const hasViewerReaction = Boolean(message.likedByViewer || message.dislikedByViewer);
    const likeScore = (message.likes ?? 0) - (message.dislikes ?? 0);
    const likeToneClass = likeScore > 0
      ? " message__like-button--positive"
      : likeScore < 0
        ? " message__like-button--negative"
        : "";
    const likeLabel = likeScore > 0 ? `+${likeScore}` : String(likeScore);
    const reactionMenuId = `message-reaction-menu-${message.id}`;
    const likeButton = el("button", `message__like-button${message.likedByViewer ? " is-liked" : ""}${likeToneClass}`, likeLabel);
    likeButton.type = "button";
    likeButton.dataset.messageReactionTrigger = message.id;
    likeButton.setAttribute("aria-controls", reactionMenuId);
    likeButton.setAttribute("aria-expanded", "false");
    likeButton.setAttribute("aria-pressed", String(Boolean(message.likedByViewer)));
    likeButton.setAttribute("aria-label", `Abrir opciones de reaccion del mensaje de ${author}`);

    const reportButton = el("button", `message__report-button${reported ? " is-reported" : ""}`);
    reportButton.type = "button";
    reportButton.dataset.reportEntityType = "message";
    reportButton.dataset.reportEntityId = message.id;
    reportButton.disabled = reported;
    reportButton.setAttribute("aria-label", reported ? `Mensaje de ${author} ya reportado` : `Reportar mensaje de ${author}`);
    reportButton.append(createReportIcon(), el("span", "button-label", reported ? "Reportado" : "Reportar"));
    meta.append(likeButton, reportButton);

    const reactionMenu = el("div", "message__reaction-menu");
    reactionMenu.id = reactionMenuId;
    reactionMenu.hidden = true;
    reactionMenu.dataset.messageReactionMenu = message.id;
    reactionMenu.append(
      el("button", `message__action-menu-button${message.likedByViewer ? " is-active" : ""}`, "LIKE"),
      el("button", `message__action-menu-button${message.dislikedByViewer ? " is-active" : ""}`, "DISLIKE")
    );
    const [reactionLikeAction, reactionDislikeAction] = reactionMenu.querySelectorAll("button");
    reactionLikeAction.type = "button";
    reactionLikeAction.dataset.likeMessageId = message.id;
    reactionLikeAction.disabled = hasViewerReaction;
    reactionLikeAction.setAttribute("aria-label", `Marcar me gusta en el mensaje de ${author}`);
    reactionDislikeAction.type = "button";
    reactionDislikeAction.dataset.dislikeMessageId = message.id;
    reactionDislikeAction.disabled = hasViewerReaction;
    reactionDislikeAction.setAttribute("aria-label", `Marcar no me gusta en el mensaje de ${author}`);
    body.append(reactionMenu);

    const actionMenu = el("div", "message__action-menu");
    actionMenu.hidden = true;
    actionMenu.dataset.messageMenu = message.id;
    actionMenu.append(
      el("button", "message__action-menu-button", "PERFIL"),
      el("button", `message__action-menu-button${message.likedByViewer ? " is-active" : ""}`, "LIKE"),
      el("button", `message__action-menu-button${message.dislikedByViewer ? " is-active" : ""}`, "DISLIKE"),
      el("button", "message__action-menu-button", "CITAR"),
      el("button", `message__action-menu-button${reported ? " is-active" : ""}`, "REPORTAR")
    );
    const [profileAction, likeAction, dislikeAction, quoteAction, reportAction] = actionMenu.querySelectorAll("button");
    profileAction.type = "button";
    profileAction.dataset.messageProfileAuthorId = message.authorId;
    profileAction.setAttribute("aria-label", `Abrir perfil de ${author}`);
    likeAction.type = "button";
    likeAction.dataset.likeMessageId = message.id;
    likeAction.setAttribute("aria-label", `Marcar me gusta en el mensaje de ${author}`);
    dislikeAction.type = "button";
    dislikeAction.dataset.dislikeMessageId = message.id;
    dislikeAction.setAttribute("aria-label", `Marcar no me gusta en el mensaje de ${author}`);
    likeAction.disabled = hasViewerReaction;
    dislikeAction.disabled = hasViewerReaction;
    quoteAction.type = "button";
    quoteAction.dataset.quoteMessageId = message.id;
    quoteAction.setAttribute("aria-label", `Citar el mensaje de ${author}`);
    reportAction.type = "button";
    reportAction.dataset.reportEntityType = "message";
    reportAction.dataset.reportEntityId = message.id;
    reportAction.disabled = reported;
    reportAction.setAttribute("aria-label", reported ? `Mensaje de ${author} ya reportado` : `Reportar mensaje de ${author}`);
    body.append(actionMenu);
  } else {
    avatarButton.disabled = true;
    avatarButton.setAttribute("aria-hidden", "true");
  }

  body.append(meta, el("p", "message__text", message.text));
  node.append(avatarButton, body);
  return node;
}
function getFriendActionLabel(status) {
  if (status === "friend") {
    return "Amigos";
  }
  if (status === "outgoing-request") {
    return "Solicitud enviada";
  }
  if (status === "incoming-request") {
    return "Aceptar amistad";
  }
  return "Agregar amigo";
}
export function createUserItem(user, currentUserId, activeConnectedUserId = null) {
  const isCurrentUser = user.id === currentUserId;
  const isActive = user.id === activeConnectedUserId;
  const menuId = `user-action-menu-${user.id}`;
  const node = el("article", `user-item${isCurrentUser ? " is-current" : ""}${isActive ? " is-active" : ""}`);
  node.dataset.id = user.id;
  node.dataset.connectedUserId = user.id;

  const info = el("div", "user-item__info");
  const trigger = el("button", "user-item__trigger");
  trigger.type = "button";
  trigger.dataset.userMenuTrigger = user.id;
  trigger.setAttribute("aria-pressed", String(isActive));
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", menuId);
  trigger.setAttribute("aria-label", `${isActive ? "Usuario activo" : "Seleccionar usuario"}: ${user.name}${isCurrentUser ? ", usuario actual" : ""}`);
  if (isCurrentUser) {
    trigger.setAttribute("aria-current", "true");
  }
  trigger.append(el("p", "user-item__name", user.name));
  info.append(trigger);

  const actions = el("div", "user-item__actions");
  actions.append(
    createUserActionButton("Ver perfil", "profile"),
    createUserActionButton("Mensaje directo", "message")
  );

  const friendMenuButton = createUserMenuButton("Agregar amigo", "friend");
  const friendStatus = user.friendshipStatus || "none";
  const friendActionLabel = getFriendActionLabel(friendStatus);
  friendMenuButton.textContent = friendActionLabel;
  friendMenuButton.setAttribute("aria-label", friendActionLabel);
  friendMenuButton.dataset.friendshipStatus = friendStatus;
  friendMenuButton.disabled = friendStatus === "friend" || friendStatus === "outgoing-request" || friendStatus === "self";

  const menu = el("div", "user-item__menu");
  menu.id = menuId;
  menu.hidden = true;
  menu.dataset.userMenu = user.id;
  menu.setAttribute("role", "menu");
  menu.append(
    createUserMenuButton("Perfil", "profile"),
    friendMenuButton,
    createUserMenuButton("Reportar", "report")
  );

  node.append(info, actions, menu);
  return node;
}

function createUserActionButton(label, kind, userId = "", menuId = "") {
  const button = el("button", "user-item__action");
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;

  button.dataset.userAction = kind;

  const iconName = kind === "profile" ? "userProfile" : "userMessage";
  button.appendChild(createIcon(iconName));
  return button;
}

function createUserMenuButton(label, kind, status = "") {
  const button = el("button", "user-item__menu-button", label);
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.setAttribute("role", "menuitem");
  button.dataset.userAction = kind;
  if (status) {
    button.dataset.friendshipStatus = status;
  }
  if (kind === "friend" && (status === "friend" || status === "outgoing-request" || status === "self")) {
    button.disabled = true;
  }
  return button;
}

export function createRankingItem(entry, index, scope = "global") {
  const node = el(
    "article",
    `ranking-item ranking-item--rank-${index + 1}${scope === "global" ? " ranking-item--global" : ""}${entry.active ? " is-active" : ""}`
  );
  node.dataset.id = entry.id;
  const badge = el("span", "ranking-item__badge", String(index + 1));
  badge.setAttribute("aria-hidden", "true");
  if (scope === "topic") {
    badge.classList.add("ranking-item__badge--topic");
  }

  const content = el("div", "ranking-item__content");
  content.append(
    el("p", "ranking-item__title", entry.title),
    el("p", "ranking-item__meta", entry.meta)
  );

  node.append(badge, content);
  return node;
}
