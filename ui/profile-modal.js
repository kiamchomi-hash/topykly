import { formatProfileJoinedDate } from "./date-utils.js";
import { createIcon } from "./icons.js";

const SOCIAL_PLATFORMS = ["Whatsapp", "Instagram", "Tiktok", "Facebook", "Twitter", "Discord"];

function ensureSocialIcons(dom) {
  SOCIAL_PLATFORMS.forEach((platform) => {
    const iconContainer = dom[`social${platform}Icon`];
    if (iconContainer && iconContainer.childElementCount === 0) {
      iconContainer.appendChild(createIcon(platform.toLowerCase()));
    }
  });
}

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
  resetSocialEditing(dom);
}

export function setSocialFieldEditing(field, editing) {
  const input = field?.querySelector?.("input");
  const button = field?.querySelector?.("[data-profile-social-edit]");
  if (!input || !button) {
    return;
  }

  const isEditing = Boolean(editing);
  const platform = field.querySelector(".profile-modal__social-label span:last-child")?.textContent || "red social";
  field.classList.toggle("is-editing", isEditing);
  field.dataset.editing = String(isEditing);
  input.readOnly = !isEditing;
  input.setAttribute("aria-readonly", String(!isEditing));
  button.setAttribute("aria-pressed", String(isEditing));
  button.setAttribute("aria-label", (isEditing ? "Confirmar " : "Editar ") + platform);
}

export function resetSocialEditing(dom) {
  dom.profileSocialSection?.querySelectorAll?.(".profile-modal__social-field")?.forEach((field) => {
    setSocialFieldEditing(field, false);
  });
}

function getVisibilityIcon(visible) {
  return visible
    ? `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="3"/></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 3l18 18"/><path d="M10.6 10.6A3 3 0 0 0 12 15a3 3 0 0 0 2.4-1.2"/><path d="M9.9 5.3A10.8 10.8 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-2.3 3.2"/><path d="M6.2 6.8A16.6 16.6 0 0 0 2.5 12s3.5 7 9.5 7a10 10 0 0 0 4.1-.9"/></svg>`;
}

function setVisibilityButton(button, visible, label, force = false) {
  if (!button) {
    return;
  }

  const sourceValue = String(visible);
  if (!force && button.dataset.renderedSourceVisible === sourceValue) {
    return;
  }

  button.dataset.renderedSourceVisible = sourceValue;
  button.dataset.visible = sourceValue;
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
    image.width = 232;
    image.height = 232;
    image.loading = "lazy";
    preview.append(image);
    return;
  }

  const fallback = document.createElement("span");
  fallback.textContent = "T";
  preview.append(fallback);
}

export function renderProfileModal(state, dom) {
  ensureSocialIcons(dom);
  const isOpen = Boolean(state.isProfileModalOpen);
  const wasOpen = dom.profileModal?.dataset?.renderedOpen === "true";
  const justOpened = isOpen && !wasOpen;
  if (dom.profileModal) {
    dom.profileModal.dataset.renderedOpen = String(isOpen);
  }
  const viewer = state.viewer || {};
  const displayName = viewer.profilePending
    ? viewer.profileSuggestedName || viewer.displayName || "Usuario"
    : viewer.displayName || "Usuario";
  const avatarUrl = viewer.avatarPendingUrl || viewer.avatarUrl || "";

  if (dom.profileLinkGoogleButton) {
    dom.profileLinkGoogleButton.hidden = !viewer.canLinkGoogle;
    dom.profileLinkGoogleButton.disabled = !viewer.canLinkGoogle;
  }

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

  const username = viewer.nickname || "";
  const usernameEditable = Boolean(viewer.profilePending);
  if (dom.profileUsernameInput && dom.profileUsernameInput.dataset.renderedUsername !== username) {
    dom.profileUsernameInput.value = username;
    dom.profileUsernameInput.dataset.renderedUsername = username;
    dom.profileUsernameInput.removeAttribute("aria-invalid");
    if (dom.profileUsernameFeedback) {
      dom.profileUsernameFeedback.textContent = "";
      dom.profileUsernameFeedback.hidden = true;
    }
  }
  if (dom.profileUsernameInput) {
    dom.profileUsernameInput.readOnly = !usernameEditable;
    dom.profileUsernameInput.setAttribute("aria-readonly", String(!usernameEditable));
    dom.profileUsernameInput.required = usernameEditable;
  }
  if (dom.profileUsernameSection) {
    dom.profileUsernameSection.dataset.editing = String(usernameEditable);
    dom.profileUsernameSection.classList.toggle("is-editing", usernameEditable);
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
  setVisibilityButton(dom.profileDescriptionVisibilityButton, showDescription, "descripción", justOpened);
  setVisibilityButton(dom.profileJoinedAtVisibilityButton, showJoinedAt, "fecha de registro", justOpened);

  const showSocial = viewer.profileShowSocial !== false;
  setVisibilityButton(dom.profileSocialVisibilityButton, showSocial, "redes sociales", justOpened);
  SOCIAL_PLATFORMS.forEach((platform) => {
    const input = dom[`social${platform}Input`];
    if (!input) {
      return;
    }
    const value = viewer[`social${platform}`] || "";
    if (justOpened || input.dataset.renderedValue !== value) {
      input.value = value;
      input.dataset.renderedValue = value;
    }
  });

  if (dom.profileAvatarInput && dom.profileAvatarInput.dataset.renderedAvatarUrl !== avatarUrl) {
    dom.profileAvatarInput.dataset.renderedAvatarUrl = avatarUrl;
    dom.profileAvatarInput.dataset.selectedAvatarDataUrl = "";
    dom.profileAvatarInput.dataset.removeAvatar = "false";
    if (typeof dom.profileAvatarInput.value === "string") {
      dom.profileAvatarInput.value = "";
    }
  }

  if (justOpened) {
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
