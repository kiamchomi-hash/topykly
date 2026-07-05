function setPublicProfileAvatar(container, avatarUrl) {
  if (!container) {
    return;
  }

  container.textContent = "";
  if (avatarUrl) {
    const image = document.createElement("img");
    image.src = avatarUrl;
    image.alt = "";
    image.loading = "eager";
    image.decoding = "async";
    container.append(image);
    return;
  }

  const fallback = document.createElement("span");
  fallback.textContent = "T";
  container.append(fallback);
}

function getRecentUserCafes(topics, userId) {
  if (!Array.isArray(topics) || !userId) {
    return [];
  }

  return topics
    .filter((topic) => topic?.authorId === userId)
    .map((topic, index) => ({
      topic,
      index,
      timestamp: Date.parse(topic.createdAt || topic.lastActivityAt || topic.messages?.[0]?.createdAt || "")
    }))
    .sort((a, b) => {
      const timeDelta = (Number.isNaN(b.timestamp) ? 0 : b.timestamp) - (Number.isNaN(a.timestamp) ? 0 : a.timestamp);
      return timeDelta || a.index - b.index;
    })
    .slice(0, 3)
    .map(({ topic }) => topic);
}
function formatJoinedDate(createdAt) {
  if (!createdAt) {
    return "";
  }

  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return [day, month, String(year)];
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

  setPublicProfileAvatar(dom.publicProfileAvatar, user.avatarPendingUrl || user.avatarUrl || "");

  const joinedDate = user.profileShowJoinedAt === false ? "" : formatJoinedDate(user.createdAt);
  const description = user.profileShowDescription === false ? "" : String(user.description || "").trim();

  if (dom.publicProfileDescription) {
    dom.publicProfileDescription.textContent = description || "Sin descripcion visible";
    dom.publicProfileDescription.hidden = !description;
  }

  if (dom.publicProfileJoinedAt) {
    dom.publicProfileJoinedAt.textContent = "";
    if (joinedDate) {
      joinedDate.forEach((part) => {
        const segment = document.createElement("span");
        segment.textContent = part;
        dom.publicProfileJoinedAt.append(segment);
      });
    }
    dom.publicProfileJoinedAt.hidden = !joinedDate;
  }

  if (dom.publicProfileMeta) {
    dom.publicProfileMeta.hidden = !description;
  }

  if (dom.publicProfileRecentCafes) {
    const recentCafes = getRecentUserCafes(state.topics, user.id);
    dom.publicProfileRecentCafes.textContent = "";
    dom.publicProfileRecentCafes.hidden = recentCafes.length === 0;
    if (recentCafes.length) {
      const title = document.createElement("p");
      title.className = "public-profile-modal__cafes-title";
      title.textContent = "Últimos temas";
      const list = document.createElement("ul");
      recentCafes.forEach((topic) => {
        const item = document.createElement("li");
        item.textContent = topic.title || "Tema sin título";
        list.append(item);
      });
      dom.publicProfileRecentCafes.append(title, list);
    }
  }

  if (dom.publicProfileActions) {
    dom.publicProfileActions.hidden = isCurrentUser;
  }

  if (dom.publicProfileReportButton) {
    dom.publicProfileReportButton.dataset.reportEntityId = user.id;
    dom.publicProfileReportButton.hidden = isCurrentUser;
  }
}
