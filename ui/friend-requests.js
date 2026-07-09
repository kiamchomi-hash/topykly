function createFriendAvatar(user) {
  const avatar = document.createElement("span");
  avatar.className = "friend-request-panel__avatar";
  const avatarUrl = user.avatarUrl || "";
  if (avatarUrl) {
    const image = document.createElement("img");
    image.src = avatarUrl;
    image.alt = "";
    image.width = 32;
    image.height = 32;
    image.loading = "lazy";
    avatar.append(image);
    return avatar;
  }

  avatar.textContent = String(user.name || "?").trim().slice(0, 1).toUpperCase() || "?";
  return avatar;
}

function createFriendRow(user, actions = []) {
  const row = document.createElement("article");
  row.className = "friend-request-panel__row";
  row.dataset.friendUserId = user.id;

  const identity = document.createElement("div");
  identity.className = "friend-request-panel__identity";
  const name = document.createElement("strong");
  name.className = "friend-request-panel__name";
  name.textContent = user.name || "Usuario";
  identity.append(createFriendAvatar(user), name);

  const actionGroup = document.createElement("div");
  actionGroup.className = "friend-request-panel__actions";
  actions.forEach((action) => {
    const button = document.createElement("button");
    button.className = `friend-request-panel__button friend-request-panel__button--${action.kind}`;
    button.type = "button";
    button.textContent = action.label;
    button.dataset.friendAction = action.kind;
    button.dataset.friendUserId = user.id;
    actionGroup.append(button);
  });

  row.append(identity, actionGroup);
  return row;
}

function createSection(title, items, renderRow, emptyText) {
  const section = document.createElement("section");
  section.className = "friend-request-panel__section";

  const heading = document.createElement("h2");
  heading.className = "friend-request-panel__section-title";
  heading.textContent = title;
  section.append(heading);

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "friend-request-panel__empty";
    empty.textContent = emptyText;
    section.append(empty);
    return section;
  }

  const list = document.createElement("div");
  list.className = "friend-request-panel__list";
  list.append(...items.map(renderRow));
  section.append(list);
  return section;
}


function positionFriendRequestsPanel(panel, button) {
  if (!panel || !button || typeof window === "undefined") {
    return;
  }

  const rect = button.getBoundingClientRect?.();
  if (!rect) {
    return;
  }

  const gap = 10;
  const viewportPadding = 12;
  const panelWidth = Math.min(360, Math.max(280, window.innerWidth - viewportPadding * 2));
  const right = Math.max(viewportPadding, window.innerWidth - rect.right);
  const top = Math.min(
    window.innerHeight - viewportPadding,
    Math.max(viewportPadding, rect.bottom + gap)
  );

  panel.style.setProperty("--friend-panel-width", `${panelWidth}px`);
  panel.style.setProperty("--friend-panel-right", `${right}px`);
  panel.style.setProperty("--friend-panel-top", `${top}px`);
}
function syncFriendRequestsButton(state, dom) {
  const button = dom.friendRequestsButton;
  if (!button) {
    return;
  }

  const incomingCount = state.friendships?.incoming?.length ?? 0;
  if (incomingCount > 0) {
    button.dataset.pendingFriends = incomingCount > 99 ? "99+" : String(incomingCount);
  } else {
    delete button.dataset.pendingFriends;
  }
  button.setAttribute("aria-expanded", String(Boolean(state.isFriendRequestsPanelOpen)));
  button.setAttribute("title", incomingCount ? `${incomingCount} solicitudes pendientes` : "Solicitudes de amistad");
}

export function renderFriendRequests(state, dom) {
  syncFriendRequestsButton(state, dom);

  const panel = dom.friendRequestsPanel;
  if (!panel) {
    return;
  }

  const friendships = state.friendships || { incoming: [], outgoing: [], friends: [] };
  positionFriendRequestsPanel(panel, dom.friendRequestsButton);
  panel.hidden = !state.isFriendRequestsPanelOpen;
  panel.setAttribute("aria-hidden", String(!state.isFriendRequestsPanelOpen));

  const header = document.createElement("header");
  header.className = "friend-request-panel__header";
  const title = document.createElement("h1");
  title.className = "friend-request-panel__title";
  title.textContent = "Amigos";
  const closeButton = document.createElement("button");
  closeButton.className = "friend-request-panel__close";
  closeButton.type = "button";
  closeButton.textContent = "x";
  closeButton.setAttribute("aria-label", "Cerrar solicitudes de amistad");
  closeButton.dataset.closeFriendRequests = "true";
  header.append(title, closeButton);

  panel.replaceChildren(
    header,
    createSection(
      "Solicitudes recibidas",
      friendships.incoming || [],
      (user) => createFriendRow(user, [
        { kind: "accept", label: "Aceptar" },
        { kind: "reject", label: "Rechazar" }
      ]),
      "No hay solicitudes pendientes."
    ),
    createSection(
      "Solicitudes enviadas",
      friendships.outgoing || [],
      (user) => createFriendRow(user),
      "No hay solicitudes enviadas."
    ),
    createSection(
      "Amigos",
      friendships.friends || [],
      (user) => createFriendRow(user),
      "Todavia no agregaste amigos."
    )
  );
}