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
    control.readOnly = !isEditing;
    control.setAttribute("aria-readonly", String(!isEditing));
  });
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

export function resetProfileEditing(dom) {
  Object.keys(PROFILE_SECTION_CONFIG).forEach((section) => setProfileSectionEditing(dom, section, false));
  resetSocialEditing(dom);
}
