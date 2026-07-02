function setPreviewImage(preview, avatarUrl) {
  if (!preview) {
    return;
  }

  preview.textContent = "";
  if (avatarUrl) {
    const image = document.createElement("img");
    image.src = avatarUrl;
    image.alt = "";
    image.loading = "lazy";
    preview.append(image);
    return;
  }

  const fallback = document.createElement("span");
  fallback.textContent = "T";
  preview.append(fallback);
}

export function renderProfileModal(state, dom) {
  const isOpen = Boolean(state.isProfileModalOpen);
  const viewer = state.viewer || {};
  const displayName = viewer.profilePending
    ? viewer.profileSuggestedName || viewer.displayName || "Usuario"
    : viewer.displayName || "Usuario";
  const avatarUrl = viewer.avatarPendingUrl || viewer.avatarUrl || "";

  if (dom.profileModalBackdrop) {
    dom.profileModalBackdrop.hidden = !isOpen;
  }

  if (dom.profileModal) {
    dom.profileModal.setAttribute("aria-hidden", String(!isOpen));
  }

  if (dom.profileDisplayName) {
    dom.profileDisplayName.textContent = viewer.profilePending ? "Completa tu perfil" : displayName;
  }

  if (dom.profileNameInput && dom.profileNameInput.dataset.renderedDisplayName !== displayName) {
    dom.profileNameInput.value = displayName;
    dom.profileNameInput.dataset.renderedDisplayName = displayName;
  }

  if (dom.profileAvatarInput && dom.profileAvatarInput.dataset.renderedAvatarUrl !== avatarUrl) {
    dom.profileAvatarInput.dataset.renderedAvatarUrl = avatarUrl;
    dom.profileAvatarInput.dataset.selectedAvatarDataUrl = "";
    if (typeof dom.profileAvatarInput.value === "string") {
      dom.profileAvatarInput.value = "";
    }
  }

  setPreviewImage(dom.profileAvatarPreview, dom.profileAvatarInput?.dataset?.selectedAvatarDataUrl || avatarUrl);
}