import { reconcile } from "./render-utils.js";

function createLazyMascot(className) {
  const documentRef = document;
  const placeholder = documentRef.createElement("span");
  placeholder.className = `topykly-mascot ${className}`;
  placeholder.setAttribute("aria-hidden", "true");

  void import("./mascot.js").then(({ createTopyklyMascot }) => {
    placeholder.replaceWith?.(createTopyklyMascot(className, documentRef));
  }).catch(() => {
    placeholder.remove?.();
  });

  return placeholder;
}

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

export function isFriendOnline(user, state) {
  if (typeof user?.online === "boolean") {
    return user.online;
  }
  return Boolean(state?.users?.find?.((candidate) => candidate.id === user?.id)?.online);
}

export function splitFriendsByPresence(friends, state) {
  const online = [];
  const offline = [];
  (friends || []).forEach((user) => {
    (isFriendOnline(user, state) ? online : offline).push(user);
  });
  return { online, offline };
}

function createFriendRow(user, actions = [], presence = null) {
  const row = document.createElement("article");
  row.className = "friend-request-panel__row";
  row.dataset.id = String(user.id);
  row.dataset.friendUserId = user.id;

  const identity = document.createElement("div");
  identity.className = "friend-request-panel__identity";
  const name = document.createElement("strong");
  name.className = "friend-request-panel__name";
  name.textContent = user.name || "Usuario";

  if (presence) {
    row.dataset.presence = presence;
    const avatarWrap = document.createElement("span");
    avatarWrap.className = "friend-request-panel__avatar-wrap";
    const dot = document.createElement("span");
    dot.className = "friend-request-panel__presence-dot";
    dot.setAttribute("aria-hidden", "true");
    avatarWrap.append(createFriendAvatar(user), dot);

    const text = document.createElement("span");
    text.className = "friend-request-panel__text";
    const status = document.createElement("span");
    status.className = "friend-request-panel__status";
    status.textContent = presence === "online" ? "En linea" : "Desconectado";
    text.append(name, status);
    identity.append(avatarWrap, text);
  } else {
    identity.append(createFriendAvatar(user), name);
  }

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

function createEmptyState(title, copy = "") {
  const empty = document.createElement("div");
  empty.className = "friend-request-panel__empty";
  const mascot = createLazyMascot("friend-request-panel__empty-mascot");
  const heading = document.createElement("strong");
  heading.className = "friend-request-panel__empty-title";
  heading.textContent = title;
  empty.append(mascot, heading);
  if (copy) {
    const detail = document.createElement("span");
    detail.className = "friend-request-panel__empty-copy";
    detail.textContent = copy;
    empty.append(detail);
  }
  return empty;
}

function createPresenceGroupTitle(label, count, presence) {
  const heading = document.createElement("h3");
  heading.className = "friend-request-panel__group-title";
  heading.dataset.id = `group-${presence}`;
  heading.dataset.presence = presence;
  heading.textContent = label;
  const badge = document.createElement("span");
  badge.className = "friend-request-panel__group-count";
  badge.textContent = String(count);
  heading.append(badge);
  return heading;
}

function createFriendsSection(friends, state) {
  const section = document.createElement("section");
  section.className = "friend-request-panel__section";

  const heading = document.createElement("h2");
  heading.className = "friend-request-panel__section-title";
  heading.textContent = "Amigos";
  section.append(heading);

  if (!friends.length) {
    section.append(createEmptyState("Todavía no tienes amigos"));
    return section;
  }

  const { online, offline } = splitFriendsByPresence(friends, state);
  const list = document.createElement("div");
  list.className = "friend-request-panel__list";

  list.append(createPresenceGroupTitle("En línea", online.length, "online"));
  if (online.length) {
    list.append(...online.map((user) => createFriendRow(user, [], "online")));
  } else {
    const empty = document.createElement("p");
    empty.className = "friend-request-panel__empty friend-request-panel__empty--group";
    empty.textContent = "Ningún amigo está en línea.";
    list.append(empty);
  }

  if (offline.length) {
    list.append(createPresenceGroupTitle("Desconectados", offline.length, "offline"));
    list.append(...offline.map((user) => createFriendRow(user, [], "offline")));
  }

  section.append(list);
  return section;
}

function createSection(title, items, renderRow, emptyState) {
  const section = document.createElement("section");
  section.className = "friend-request-panel__section";

  const heading = document.createElement("h2");
  heading.className = "friend-request-panel__section-title";
  heading.textContent = title;
  section.append(heading);

  if (!items.length) {
    section.append(createEmptyState(emptyState.title, emptyState.copy));
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

  if (!rect.width && !rect.height) {
    // Anchor button hidden (mobile drawer flow): fall back to the CSS default position.
    panel.style.removeProperty("--friend-panel-width");
    panel.style.removeProperty("--friend-panel-right");
    panel.style.removeProperty("--friend-panel-top");
    return;
  }

  const gap = 10;
  const viewportPadding = 12;
  const panelWidth = Math.min(400, Math.max(280, window.innerWidth - viewportPadding * 2));
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
  if (!state.isFriendRequestsPanelOpen) {
    return;
  }

  const header = document.createElement("header");
  header.className = "friend-request-panel__header";
  header.dataset.id = "header";
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

  const activeTab = state.friendRequestsTab || "incoming";
  panel.dataset.activeTab = activeTab;
  const tabsContainer = document.createElement("div");
  tabsContainer.className = "friend-request-panel__tabs";
  tabsContainer.dataset.id = "tabs";

  const tabsData = [
    { id: "incoming", label: "Recibidas", count: friendships.incoming?.length || 0, isIncoming: true },
    { id: "outgoing", label: "Enviadas", count: friendships.outgoing?.length || 0 },
    { id: "friends", label: "Amigos", count: friendships.friends?.length || 0 }
  ];

  tabsData.forEach((tab) => {
    const tabBtn = document.createElement("button");
    tabBtn.className = `friend-request-panel__tab${tab.id === activeTab ? " friend-request-panel__tab--active" : ""}`;
    tabBtn.type = "button";
    tabBtn.dataset.friendTab = tab.id;
    tabBtn.textContent = tab.label;

    if (tab.count > 0) {
      const badge = document.createElement("span");
      badge.className = `friend-request-panel__tab-badge${tab.isIncoming ? " friend-request-panel__tab-badge--incoming" : ""}`;
      badge.textContent = tab.count;
      tabBtn.append(badge);
    }

    tabsContainer.append(tabBtn);
  });

  const limits = state.friendRequestsLimits || { incoming: 10, outgoing: 10 };

  let activeSection;
  if (activeTab === "incoming") {
    const limit = limits.incoming || 10;
    activeSection = createSection(
      "Solicitudes recibidas",
      (friendships.incoming || []).slice(0, limit),
      (user) => createFriendRow(user, [
        { kind: "accept", label: "Aceptar" },
        { kind: "reject", label: "Rechazar" }
      ]),
      {
        title: "No hay solicitudes pendientes"
      }
    );
  } else if (activeTab === "outgoing") {
    const limit = limits.outgoing || 10;
    activeSection = createSection(
      "Solicitudes enviadas",
      (friendships.outgoing || []).slice(0, limit),
      (user) => createFriendRow(user),
      {
        title: "No hay solicitudes enviadas"
      }
    );
  } else {
    activeSection = createFriendsSection(friendships.friends || [], state);
  }

  // Keep the active section mounted while tabs change so the mascot SVG and
  // its raster asset are not destroyed and requested again on every click.
  activeSection.dataset.id = "active-section";

  reconcile(panel, [header, tabsContainer, activeSection]);
}
