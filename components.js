import { createAvatarIcon as createProfileAvatar, createIcon } from "./ui/icons.js";
import { formatMessageTime } from "./ui/date-utils.js";
import { filterDisplayText } from "./profanity-filter.js";

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

function parseLeadingQuote(text) {
  const lines = String(text || "").split("\n");
  const quoteLines = [];
  let index = 0;

  while (index < lines.length && /^>\s?/.test(lines[index])) {
    quoteLines.push(lines[index].replace(/^>\s?/, ""));
    index += 1;
  }

  if (quoteLines.length < 2) {
    return null;
  }

  while (index < lines.length && !lines[index].trim()) {
    index += 1;
  }

  return {
    author: quoteLines[0].trim(),
    text: quoteLines.slice(1).join("\n").trim(),
    body: lines.slice(index).join("\n").trim()
  };
}

function normalizeQuoteAuthor(value) {
  return String(value || "")
    .trim()
    .replace(/^@/, "")
    .toLocaleLowerCase("es");
}

function createMessageContent(text, hiddenBlockedQuoteAuthors = []) {
  const parsedQuote = parseLeadingQuote(text);
  if (!parsedQuote) {
    return el("p", "message__text", filterDisplayText(text));
  }

  const content = el("div", "message__content");
  const quote = el("blockquote", "message__quote");
  const normalizedAuthor = normalizeQuoteAuthor(parsedQuote.author);
  const isBlockedQuote = hiddenBlockedQuoteAuthors.some(
    (author) => normalizeQuoteAuthor(author) === normalizedAuthor
  );
  quote.append(
    el("p", "message__quote-author", parsedQuote.author),
    el(
      "p",
      `message__quote-text${isBlockedQuote ? " message__quote-text--blocked" : ""}`,
      isBlockedQuote ? "-" : filterDisplayText(parsedQuote.text)
    )
  );
  content.append(quote);

  if (parsedQuote.body) {
    content.append(el("p", "message__text", filterDisplayText(parsedQuote.body)));
  }

  return content;
}
function createLikeDislikeActionButtons(message, author) {
  const likeButton = el("button", `message__action-menu-button${message.likedByViewer ? " is-active" : ""}`, "LIKE");
  likeButton.type = "button";
  likeButton.dataset.likeMessageId = message.id;
  likeButton.setAttribute("aria-label", `Marcar me gusta en el mensaje de ${author}`);

  const dislikeButton = el("button", `message__action-menu-button${message.dislikedByViewer ? " is-active" : ""}`, "DISLIKE");
  dislikeButton.type = "button";
  dislikeButton.dataset.dislikeMessageId = message.id;
  dislikeButton.setAttribute("aria-label", `Marcar no me gusta en el mensaje de ${author}`);

  return [likeButton, dislikeButton];
}

function createReportIcon() {
  const icon = el("span", "report-icon");
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 21V4"></path>
      <path d="M5 4h13.5l-3 4.5 3 4.5H5"></path>
    </svg>`;
  return icon;
}

export function createTopicItem(topic, users, selected = false, currentUserId = null, unread = false) {
  const button = el("a", `topic-item${selected ? " is-active" : ""}${unread ? " topic-item--unread" : ""}`);
  button.dataset.id = topic.id;
  button.setAttribute("href", `/tema/${encodeURIComponent(topic.id)}`);
  button.setAttribute("role", "button");
  button.setAttribute("aria-pressed", String(selected));
  button.setAttribute("aria-current", selected ? "true" : "false");

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
    el("span", "topic-item__title", filterDisplayText(topic.title)),
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
  actions.append(el("div", "user-item__skeleton-circle"));

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

export function createMessageItem(
  message,
  users,
  { reported = false, currentUserId = null, blocked = false, hiddenBlockedQuoteAuthors = [], readOnly = false } = {}
) {
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
    likeButton.disabled = readOnly;
    if (!readOnly) {
      likeButton.dataset.messageReactionTrigger = message.id;
      likeButton.setAttribute("aria-controls", reactionMenuId);
      likeButton.setAttribute("aria-expanded", "false");
    }
    likeButton.setAttribute("aria-pressed", String(Boolean(message.likedByViewer)));
    likeButton.setAttribute("aria-label", readOnly
      ? `Puntaje del mensaje de ${author}: ${likeLabel}. Tema archivado`
      : `Abrir opciones de reaccion del mensaje de ${author}`);

    const reportButton = el("button", `message__report-button${reported ? " is-reported" : ""}`);
    reportButton.type = "button";
    reportButton.dataset.reportEntityType = "message";
    reportButton.dataset.reportEntityId = message.id;
    reportButton.disabled = reported;
    reportButton.setAttribute("aria-label", reported ? `Mensaje de ${author} ya reportado` : `Reportar mensaje de ${author}`);
    reportButton.append(createReportIcon(), el("span", "button-label", reported ? "Reportado" : "Reportar"));
    meta.append(likeButton, reportButton);

    if (!readOnly) {
      const reactionMenu = el("div", "message__reaction-menu");
      reactionMenu.id = reactionMenuId;
      reactionMenu.hidden = true;
      reactionMenu.dataset.messageReactionMenu = message.id;
      reactionMenu.append(...createLikeDislikeActionButtons(message, author));
      body.append(reactionMenu);
    }

    const profileAction = el("button", "message__action-menu-button", "PERFIL");
    profileAction.type = "button";
    profileAction.dataset.messageProfileAuthorId = message.authorId;
    profileAction.setAttribute("aria-label", `Abrir perfil de ${author}`);

    const [likeAction, dislikeAction] = createLikeDislikeActionButtons(message, author);

    const quoteAction = el("button", "message__action-menu-button", "CITAR");
    quoteAction.type = "button";
    quoteAction.dataset.quoteMessageId = message.id;
    quoteAction.setAttribute("aria-label", `Citar el mensaje de ${author}`);

    const reportAction = el("button", `message__action-menu-button${reported ? " is-active" : ""}`, "REPORTAR");
    reportAction.type = "button";
    reportAction.dataset.reportEntityType = "message";
    reportAction.dataset.reportEntityId = message.id;
    reportAction.disabled = reported;
    reportAction.setAttribute("aria-label", reported ? `Mensaje de ${author} ya reportado` : `Reportar mensaje de ${author}`);

    const authorUser = users.find((user) => user.id === message.authorId);
    const currentUser = users.find((user) => user.id === currentUserId);
    const canBlockAuthor = Boolean(
      authorUser?.type === "registered"
      && currentUser?.type === "registered"
      && authorUser.id !== currentUser.id
    );
    const blockAction = el("button", "message__action-menu-button", blocked ? "DESBLOQUEAR" : "BLOQUEAR");
    blockAction.type = "button";
    blockAction.dataset.blockUserId = message.authorId;
    blockAction.dataset.blockAction = blocked ? "unblock" : "request";
    blockAction.setAttribute("aria-label", blocked ? `Desbloquear a ${author}` : `Bloquear a ${author}`);

    const actionMenu = el("div", "message__action-menu");
    actionMenu.hidden = true;
    actionMenu.dataset.messageMenu = message.id;
    actionMenu.append(profileAction);
    if (!readOnly) {
      actionMenu.append(likeAction, dislikeAction, quoteAction);
    }
    if (canBlockAuthor) {
      actionMenu.append(blockAction);
    }
    actionMenu.append(reportAction);
    body.append(actionMenu);
  } else {
    avatarButton.disabled = true;
    avatarButton.setAttribute("aria-hidden", "true");
  }

  body.append(meta, createMessageContent(message.text, hiddenBlockedQuoteAuthors));
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
export function createUserItem(user, currentUserId, activeConnectedUserId = null, menuIdScope = "user-list") {
  const isCurrentUser = user.id === currentUserId;
  const isActive = user.id === activeConnectedUserId;
  const isRegistered = user.type === "registered";
  const menuId = `user-action-menu-${menuIdScope}-${user.id}`;
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
  if (user.nickname) {
    trigger.append(el("span", "user-item__username", `@${user.nickname}`));
  }
  info.append(trigger);

  const actions = el("div", "user-item__actions");
  actions.append(createUserActionButton(isRegistered ? "Ver perfil" : "Ver aviso de invitado", "profile"));

  const menu = el("div", "user-item__menu");
  menu.id = menuId;
  menu.hidden = true;
  menu.dataset.userMenu = user.id;
  menu.setAttribute("role", "menu");
  menu.append(createUserMenuButton("Perfil", "profile"));

  if (isRegistered) {
    const friendMenuButton = createUserMenuButton("Agregar amigo", "friend");
    const friendStatus = user.friendshipStatus || "none";
    const friendActionLabel = getFriendActionLabel(friendStatus);
    friendMenuButton.textContent = friendActionLabel;
    friendMenuButton.setAttribute("aria-label", friendActionLabel);
    friendMenuButton.dataset.friendshipStatus = friendStatus;
    friendMenuButton.disabled = friendStatus === "friend" || friendStatus === "outgoing-request" || friendStatus === "self";
    menu.append(friendMenuButton, createUserMenuButton("Reportar", "report"));
  }

  node.append(info, actions, menu);
  return node;
}

function createUserActionButton(label, kind, userId = "", menuId = "") {
  const button = el("button", "user-item__action");
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;

  button.dataset.userAction = kind;

  button.appendChild(createIcon("userProfile"));
  return button;
}

const SOCIAL_PLATFORM_LABELS = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  twitter: "Twitter/X",
  discord: "Discord"
};

const SOCIAL_URL_BUILDERS = {
  whatsapp: (handle) => `https://wa.me/${encodeURIComponent(handle.replace(/[^0-9]/g, ""))}`,
  instagram: (handle) => `https://instagram.com/${encodeURIComponent(handle)}`,
  tiktok: (handle) => `https://tiktok.com/@${encodeURIComponent(handle)}`,
  facebook: (handle) => `https://facebook.com/${encodeURIComponent(handle)}`,
  twitter: (handle) => `https://twitter.com/${encodeURIComponent(handle)}`
};

export function createSocialLinkButton(platform, handle) {
  const label = SOCIAL_PLATFORM_LABELS[platform] || platform;
  const urlBuilder = SOCIAL_URL_BUILDERS[platform];
  const tag = urlBuilder ? "a" : "span";
  const link = el(tag, "icon-button icon-button--compact social-link-button");
  if (urlBuilder) {
    link.href = urlBuilder(handle);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", `${label}: ${handle}`);
  } else {
    const srLabel = el("span", "sr-only", `${label}: `);
    link.appendChild(srLabel);
  }
  link.title = `${label}: ${handle}`;
  link.dataset.socialPlatform = platform;

  const iconContainer = el("span", `social-link-button__icon social-icon--${platform}`);
  iconContainer.appendChild(createIcon(platform));
  link.appendChild(iconContainer);

  const handleText = el("span", "social-link-button__handle", handle);
  link.append(handleText);
  return link;
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
