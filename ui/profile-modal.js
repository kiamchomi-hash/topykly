const PROFILE_SECTION_CONFIG = {
  name: {
    sectionKey: "profileNameSection",
    editButtonKey: "profileNameEditButton",
    controls: ["profileNameInput"]
  },
  description: {
    sectionKey: "profileDescriptionSection",
    editButtonKey: "profileDescriptionEditButton",
    controls: ["profileDescriptionInput"]
  }
};

export function setProfileSectionEditing(dom, section, editing) {
  const config = PROFILE_SECTION_CONFIG[section];
  if (!config) {
    return;
  }

  const isEditing = Boolean(editing);
  const sectionNode = dom[config.sectionKey];
  const editButton = dom[config.editButtonKey];
  sectionNode?.classList?.toggle("is-editing", isEditing);
  sectionNode?.setAttribute?.("data-editing", String(isEditing));
  editButton?.setAttribute?.("aria-pressed", String(isEditing));

  config.controls.forEach((key) => {
    const control = dom[key];
    if (!control) {
      return;
    }

    if (key === "profileAvatarPreview" || key === "profileAvatarInput" || key === "profileAvatarPickButton") {
      control.disabled = !isEditing;
      control.setAttribute("aria-disabled", String(!isEditing));
      return;
    }

    control.readOnly = !isEditing;
    control.setAttribute("aria-readonly", String(!isEditing));
  });
}

export function resetProfileEditing(dom) {
  Object.keys(PROFILE_SECTION_CONFIG).forEach((section) => setProfileSectionEditing(dom, section, false));
}
function formatProfileJoinedDate(createdAt) {
  if (!createdAt) {
    return "Fecha de registro no disponible";
  }

  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return "Fecha de registro no disponible";
  }

  return `Registro: ${date.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  })}`;
}

function getVisibilityIcon(visible) {
  return visible
    ? `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="3"/></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 3l18 18"/><path d="M10.6 10.6A3 3 0 0 0 12 15a3 3 0 0 0 2.4-1.2"/><path d="M9.9 5.3A10.8 10.8 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-2.3 3.2"/><path d="M6.2 6.8A16.6 16.6 0 0 0 2.5 12s3.5 7 9.5 7a10 10 0 0 0 4.1-.9"/></svg>`;
}

function setVisibilityButton(button, visible, label) {
  if (!button) {
    return;
  }

  button.dataset.visible = String(visible);
  button.setAttribute("aria-pressed", String(!visible));
  button.setAttribute("aria-label", visible ? `Ocultar ${label}` : `Mostrar ${label}`);
  button.innerHTML = getVisibilityIcon(visible);
}
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
    dom.profileNameInput.removeAttribute("aria-invalid");
    if (dom.profileNameFeedback) {
      dom.profileNameFeedback.textContent = "";
      dom.profileNameFeedback.hidden = true;
    }
  }

  const description = viewer.description || "";
  const showDescription = viewer.profileShowDescription !== false;
  const showJoinedAt = viewer.profileShowJoinedAt !== false;
  if (dom.profileDescriptionInput && dom.profileDescriptionInput.dataset.renderedDescription !== description) {
    dom.profileDescriptionInput.value = description;
    dom.profileDescriptionInput.dataset.renderedDescription = description;
  }
  if (dom.profileJoinedAtText) {
    dom.profileJoinedAtText.textContent = formatProfileJoinedDate(viewer.createdAt);
  }
  setVisibilityButton(dom.profileDescriptionVisibilityButton, showDescription, "descripción");
  setVisibilityButton(dom.profileJoinedAtVisibilityButton, showJoinedAt, "fecha de registro");

  if (dom.profileAvatarInput && dom.profileAvatarInput.dataset.renderedAvatarUrl !== avatarUrl) {
    dom.profileAvatarInput.dataset.renderedAvatarUrl = avatarUrl;
    dom.profileAvatarInput.dataset.selectedAvatarDataUrl = "";
    dom.profileAvatarInput.dataset.removeAvatar = "false";
    if (typeof dom.profileAvatarInput.value === "string") {
      dom.profileAvatarInput.value = "";
    }
  }

  const wasOpen = dom.profileModal?.dataset?.renderedOpen === "true";
  if (dom.profileModal) {
    dom.profileModal.dataset.renderedOpen = String(isOpen);
  }

  if (isOpen && !wasOpen) {
    resetProfileEditing(dom);
    if (dom.profileAvatarInput) {
      dom.profileAvatarInput.dataset.selectedAvatarDataUrl = "";
      dom.profileAvatarInput.dataset.removeAvatar = "false";
      if (typeof dom.profileAvatarInput.value === "string") {
        dom.profileAvatarInput.value = "";
      }
    }
  }

  const avatarRemoved = dom.profileAvatarInput?.dataset?.removeAvatar === "true";
  setPreviewImage(dom.profileAvatarPreview, avatarRemoved ? "" : dom.profileAvatarInput?.dataset?.selectedAvatarDataUrl || avatarUrl);
}