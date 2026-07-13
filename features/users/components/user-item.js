import { el } from "../../shared/components/base.js";

export function createUserSkeleton() {
  const node = el("article", "user-item user-item--skeleton");
  const info = el("div", "user-item__info");
  info.append(el("div", "user-item__skeleton-line"));

  const actions = el("div", "user-item__actions");
  actions.append(el("div", "user-item__skeleton-circle"));

  node.append(info, actions);
  return node;
}

function createUserActionButton(label, kind) {
  const button = el("button", "user-item__action");
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.dataset.userAction = kind;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");

  const head = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  head.setAttribute("cx", "12");
  head.setAttribute("cy", "8.5");
  head.setAttribute("r", "3.2");

  const shoulders = document.createElementNS("http://www.w3.org/2000/svg", "path");
  shoulders.setAttribute("d", "M5.5 19c1.4-3.6 4-5.4 6.5-5.4s5.1 1.8 6.5 5.4");

  svg.append(head, shoulders);

  button.appendChild(svg);
  return button;
}

export function createUserItem(user) {
  const node = el("article", `user-item${user.isCurrent ? " is-current" : ""}${user.isActive ? " is-active" : ""}`);
  node.dataset.id = user.id;
  node.tabIndex = 0;
  node.setAttribute("role", "button");
  node.setAttribute("aria-pressed", String(user.isActive));
  node.setAttribute("aria-label", `${user.name}${user.isCurrent ? ", usuario actual" : ""}`);
  node.dataset.connectedUserId = user.id;

  const info = el("div", "user-item__info");
  info.append(el("p", "user-item__name", user.name));

  const actions = el("div", "user-item__actions");
  actions.append(createUserActionButton("Ver perfil", "profile"));

  node.append(info, actions);
  return node;
}
