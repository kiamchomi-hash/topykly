import { createAvatarIcon as createProfileAvatar, createIcon } from "./ui/icons.js";

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

export function createTopicItem(topic, users, selected = false) {
  const button = el("button", `topic-item${selected ? " is-active" : ""}`);
  button.type = "button";
  button.dataset.id = topic.id;

  const topicCommentCount = topic.messages.filter((message) => message.kind === "user").length;
  const lastCommentAuthor = [...topic.messages].reverse().find((message) => message.kind === "user");
  const lastCommenterName = lastCommentAuthor
    ? getUserName(users, lastCommentAuthor.authorId)
    : "Sin actividad";

  const avatar = createProfileAvatar();
  const content = el("span", "topic-item__content");
  content.append(
    el("span", "topic-item__title", topic.title),
    el("span", "topic-item__meta", `${topicCommentCount}, ${lastCommenterName}`)
  );

  button.append(avatar, content);
  return button;
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

export function createMessageItem(message, users) {
  const node = el("article", `message${message.kind === "system" ? " message--system" : ""}`);
  node.dataset.id = message.id;
  const author = message.kind === "system" ? "Sistema" : getUserName(users, message.authorId);
  const avatar = createProfileAvatar("message__avatar");
  const body = el("div", "message__body");

  const meta = el("div", "message__meta");
  meta.append(
    el("span", "message__author", author),
    el("span", "message__time", message.timestamp.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }))
  );

  body.append(meta, el("p", "message__text", message.text));
  node.append(avatar, body);
  return node;
}

export function createUserItem(user, currentUserId, activeConnectedUserId = null) {
  const isCurrentUser = user.id === currentUserId;
  const isActive = user.id === activeConnectedUserId;
  const node = el("article", `user-item${isCurrentUser ? " is-current" : ""}${isActive ? " is-active" : ""}`);
  node.dataset.id = user.id;
  node.dataset.connectedUserId = user.id;

  const info = el("div", "user-item__info");
  const trigger = el("button", "user-item__trigger");
  trigger.type = "button";
  trigger.dataset.connectedUserId = user.id;
  trigger.setAttribute("aria-pressed", String(isActive));
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

  node.append(info, actions);
  return node;
}

function createUserActionButton(label, kind) {
  const button = el("button", "user-item__action");
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.dataset.userAction = kind;

  const iconName = kind === "profile" ? "userProfile" : "userMessage";
  button.appendChild(createIcon(iconName));
  
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
