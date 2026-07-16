const SETTING_TOGGLE_KEYS = {
  likesAnonymous: "settingsLikesAnonymousToggle",
  profileIndexable: "settingsProfileIndexableToggle",
  filterProfanity: "settingsFilterProfanityToggle",
  notificationsFriendsOnly: "settingsFriendsOnlyToggle",
  emailActivityEnabled: "settingsEmailActivityToggle",
  slowMode: "settingsSlowModeToggle"
};

const SETTINGS_SECTIONS = new Set(["privacy", "experience", "blocks", "account"]);

function syncSettingsSection(state, dom) {
  const activeSection = SETTINGS_SECTIONS.has(state.settingsSection) ? state.settingsSection : "privacy";
  dom.settingsModal?.querySelectorAll?.("[data-settings-section]").forEach((button) => {
    const isActive = button.dataset.settingsSection === activeSection;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    button.tabIndex = isActive ? 0 : -1;
  });
  dom.settingsModal?.querySelectorAll?.("[data-settings-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.settingsPanel !== activeSection;
  });
}

function syncSettingToggle(button, enabled, pending) {
  if (!button) {
    return;
  }

  button.setAttribute("aria-checked", String(Boolean(enabled)));
  button.classList.toggle("is-on", Boolean(enabled));
  button.disabled = Boolean(pending);
  button.setAttribute("aria-busy", String(Boolean(pending)));
}

function createBlockedUserRow(user, pendingUserId) {
  const row = document.createElement("div");
  row.className = "settings-modal__blocked-user";

  const avatar = document.createElement("span");
  avatar.className = "settings-modal__blocked-avatar";
  avatar.setAttribute("aria-hidden", "true");
  if (user.avatarUrl) {
    const image = document.createElement("img");
    image.src = user.avatarUrl;
    image.alt = "";
    image.width = 40;
    image.height = 40;
    avatar.append(image);
  } else {
    avatar.textContent = String(user.name || "U").charAt(0).toUpperCase();
  }

  const identity = document.createElement("div");
  identity.className = "settings-modal__blocked-identity";
  const name = document.createElement("strong");
  name.textContent = user.name || "Usuario";
  const detail = document.createElement("span");
  detail.textContent = user.nickname ? `@${user.nickname}` : "Cuenta bloqueada";
  identity.append(name, detail);

  const hideControl = document.createElement("div");
  hideControl.className = "settings-modal__blocked-hide";
  const hideLabel = document.createElement("span");
  hideLabel.textContent = "Ocultar contenido";
  const hideToggle = document.createElement("button");
  hideToggle.className = `settings-switch${user.hideContent ? " is-on" : ""}`;
  hideToggle.type = "button";
  hideToggle.setAttribute("role", "switch");
  hideToggle.setAttribute("aria-checked", String(Boolean(user.hideContent)));
  hideToggle.setAttribute("aria-label", `Ocultar contenido de ${user.name || "esta cuenta"}`);
  hideToggle.dataset.blockedUserAction = "toggle-content";
  hideToggle.dataset.blockedUserId = user.id;
  hideToggle.disabled = pendingUserId === user.id;
  const thumb = document.createElement("span");
  thumb.className = "settings-switch__thumb";
  thumb.setAttribute("aria-hidden", "true");
  hideToggle.append(thumb);
  hideControl.append(hideLabel, hideToggle);

  const unblockButton = document.createElement("button");
  unblockButton.className = "text-button settings-modal__unblock-button";
  unblockButton.type = "button";
  unblockButton.textContent = "Desbloquear";
  unblockButton.dataset.blockedUserAction = "unblock";
  unblockButton.dataset.blockedUserId = user.id;
  unblockButton.disabled = pendingUserId === user.id;

  row.append(avatar, identity, hideControl, unblockButton);
  return row;
}

function renderBlockedUsers(state, dom) {
  if (!dom.settingsBlockedUsers) {
    return;
  }

  const blockedUsers = Array.isArray(state.blockedUsers) ? state.blockedUsers : [];
  const renderKey = JSON.stringify(blockedUsers.map((user) => [
    user.id,
    user.name,
    user.nickname,
    user.avatarUrl,
    Boolean(user.hideContent),
    state.blockedUserActionPending === user.id
  ]));
  if (dom.settingsBlockedUsers.dataset.renderedBlockedUsers === renderKey) {
    return;
  }
  dom.settingsBlockedUsers.dataset.renderedBlockedUsers = renderKey;
  dom.settingsBlockedUsers.textContent = "";
  if (!blockedUsers.length) {
    const empty = document.createElement("p");
    empty.className = "settings-modal__blocked-empty";
    empty.textContent = "No bloqueaste ninguna cuenta.";
    dom.settingsBlockedUsers.append(empty);
    return;
  }

  blockedUsers.forEach((user) => {
    dom.settingsBlockedUsers.append(createBlockedUserRow(user, state.blockedUserActionPending));
  });
}

export function renderSettingsModal(state, dom) {
  const isOpen = Boolean(state.isSettingsModalOpen);
  const viewer = state.viewer || {};

  if (dom.settingsModalBackdrop) {
    dom.settingsModalBackdrop.hidden = !isOpen;
  }
  if (dom.settingsModal) {
    dom.settingsModal.setAttribute("aria-hidden", String(!isOpen));
  }
  if (dom.settingsButton) {
    dom.settingsButton.setAttribute("aria-expanded", String(isOpen));
  }

  if (!isOpen) {
    return;
  }

  syncSettingsSection(state, dom);
  const pending = Boolean(state.settingsUpdatePending);
  syncSettingToggle(dom[SETTING_TOGGLE_KEYS.likesAnonymous], viewer.likesAnonymous, pending);
  syncSettingToggle(dom[SETTING_TOGGLE_KEYS.profileIndexable], viewer.profileIndexable !== false, pending);
  syncSettingToggle(dom[SETTING_TOGGLE_KEYS.filterProfanity], viewer.filterProfanity, pending);
  syncSettingToggle(dom[SETTING_TOGGLE_KEYS.slowMode], viewer.slowMode, pending);
  syncSettingToggle(
    dom[SETTING_TOGGLE_KEYS.notificationsFriendsOnly],
    viewer.notificationsFriendsOnly,
    pending
  );
  syncSettingToggle(
    dom[SETTING_TOGGLE_KEYS.emailActivityEnabled],
    viewer.emailActivityEnabled,
    pending
  );
  renderBlockedUsers(state, dom);

  const confirming = Boolean(state.settingsDeleteConfirming);
  if (dom.settingsDeleteAccountButton) {
    dom.settingsDeleteAccountButton.hidden = confirming;
  }
  if (dom.settingsDeleteConfirmRow) {
    dom.settingsDeleteConfirmRow.hidden = !confirming;
  }
}
