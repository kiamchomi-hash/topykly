function setPublicProfileAvatar(container, avatarUrl) {
  if (!container) {
    return;
  }

  container.textContent = "";
  if (avatarUrl) {
    const image = document.createElement("img");
    image.src = avatarUrl;
    image.alt = "";
    image.loading = "lazy";
    container.append(image);
    return;
  }

  const fallback = document.createElement("span");
  fallback.textContent = "T";
  container.append(fallback);
}

function formatJoinedDate(createdAt) {
  if (!createdAt) {
    return "";
  }

  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return `Desde ${date.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  })}`;
}

export function renderPublicProfileModal(state, dom) {
  const user = state.users.find((candidate) => candidate.id === state.publicProfileUserId) || null;
  const isOpen = Boolean(user);
  const isCurrentUser = Boolean(user && user.id === state.currentUserId);

  if (dom.publicProfileModalBackdrop) {
    dom.publicProfileModalBackdrop.hidden = !isOpen;
  }

  if (dom.publicProfileModal) {
    dom.publicProfileModal.setAttribute("aria-hidden", String(!isOpen));
  }

  if (!user) {
    return;
  }

  if (dom.publicProfileName) {
    dom.publicProfileName.textContent = user.nickname || user.name || "Usuario";
  }

  setPublicProfileAvatar(dom.publicProfileAvatar, user.avatarUrl || "");

  if (dom.publicProfileMeta) {
    const joinedDate = formatJoinedDate(user.createdAt);
    dom.publicProfileMeta.textContent = joinedDate || "Perfil de usuario";
  }

  if (dom.publicProfileReportButton) {
    dom.publicProfileReportButton.dataset.reportEntityId = user.id;
    dom.publicProfileReportButton.hidden = isCurrentUser;
  }
}
