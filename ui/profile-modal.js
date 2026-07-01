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
  const avatarUrl = viewer.avatarUrl || "";

  if (dom.profileModalBackdrop) {
    dom.profileModalBackdrop.hidden = !isOpen;
  }

  if (dom.profileModal) {
    dom.profileModal.setAttribute("aria-hidden", String(!isOpen));
  }

  if (dom.profileDisplayName) {
    dom.profileDisplayName.textContent = viewer.displayName || "Usuario";
  }

  if (dom.profileAvatarInput && dom.profileAvatarInput.dataset.renderedAvatarUrl !== avatarUrl) {
    dom.profileAvatarInput.value = avatarUrl;
    dom.profileAvatarInput.dataset.renderedAvatarUrl = avatarUrl;
  }

  setPreviewImage(dom.profileAvatarPreview, dom.profileAvatarInput?.value?.trim() || avatarUrl);
}