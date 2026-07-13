const SETTING_TOGGLE_KEYS = {
  likesAnonymous: "settingsLikesAnonymousToggle",
  filterProfanity: "settingsFilterProfanityToggle",
  notificationsFriendsOnly: "settingsFriendsOnlyToggle"
};

function syncSettingToggle(button, enabled, pending) {
  if (!button) {
    return;
  }

  button.setAttribute("aria-checked", String(Boolean(enabled)));
  button.classList.toggle("is-on", Boolean(enabled));
  button.disabled = Boolean(pending);
  button.setAttribute("aria-busy", String(Boolean(pending)));
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

  const pending = Boolean(state.settingsUpdatePending);
  syncSettingToggle(dom[SETTING_TOGGLE_KEYS.likesAnonymous], viewer.likesAnonymous, pending);
  syncSettingToggle(dom[SETTING_TOGGLE_KEYS.filterProfanity], viewer.filterProfanity, pending);
  syncSettingToggle(
    dom[SETTING_TOGGLE_KEYS.notificationsFriendsOnly],
    viewer.notificationsFriendsOnly,
    pending
  );

  const confirming = Boolean(state.settingsDeleteConfirming);
  if (dom.settingsDeleteAccountButton) {
    dom.settingsDeleteAccountButton.hidden = confirming;
  }
  if (dom.settingsDeleteConfirmRow) {
    dom.settingsDeleteConfirmRow.hidden = !confirming;
  }
}
