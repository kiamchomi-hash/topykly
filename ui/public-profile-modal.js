import { formatJoinedDateParts } from "./date-utils.js";
import { createSocialLinkButton } from "../components.js";

const SOCIAL_PLATFORMS = ["whatsapp", "instagram", "tiktok", "facebook", "twitter", "discord"];

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function setPublicProfileAvatar(container, avatarUrl) {
  if (!container) {
    return;
  }

  container.textContent = "";
  if (avatarUrl) {
    const image = document.createElement("img");
    image.src = avatarUrl;
    image.alt = "";
    image.width = 232;
    image.height = 232;
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

function isTopicAvailable(topic) {
  return topic?.visible !== false && topic?.status !== "blocked" && topic?.status !== "expelled";
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
    dom.publicProfileName.textContent = user.name || "Usuario";
  }

  if (dom.publicProfileUsername) {
    dom.publicProfileUsername.textContent = user.nickname ? `@${user.nickname}` : "";
  }

  const publicAvatarUrl = isCurrentUser ? user.avatarPendingUrl || user.avatarUrl || "" : user.avatarUrl || "";
  setPublicProfileAvatar(dom.publicProfileAvatar, publicAvatarUrl);

  const joinedDate = user.profileShowJoinedAt === false ? [] : formatJoinedDateParts(user.createdAt);
  const description = user.profileShowDescription === false ? "" : String(user.description || "").trim();

  if (dom.publicProfileDescription) {
    dom.publicProfileDescription.textContent = description || "Sin descripción";
    dom.publicProfileDescription.classList.toggle("public-profile-modal__description--empty", !description);
  }

  if (dom.publicProfileJoinedAt) {
    dom.publicProfileJoinedAt.textContent = "";
    if (joinedDate.length) {
      joinedDate.forEach((part) => {
        const segment = document.createElement("span");
        segment.textContent = part;
        dom.publicProfileJoinedAt.append(segment);
      });
    }
    dom.publicProfileJoinedAt.hidden = !joinedDate.length;
    const joinedAtContainer = dom.publicProfileJoinedAt.closest?.(".public-profile-modal__joined-wrap");
    if (joinedAtContainer) {
      joinedAtContainer.hidden = !joinedDate.length;
    }
  }

  if (dom.publicProfileSocial) {
    const showSocial = user.profileShowSocial !== false;
    const socialEntries = showSocial
      ? SOCIAL_PLATFORMS
          .map((platform) => ({ platform, handle: String(user[`social${capitalize(platform)}`] || "").trim() }))
          .filter((entry) => entry.handle)
      : [];
    dom.publicProfileSocial.textContent = "";
    dom.publicProfileSocial.hidden = !showSocial;
    if (showSocial) {
      const title = document.createElement("p");
      title.className = "public-profile-modal__social-title";
      title.textContent = "Redes sociales";
      dom.publicProfileSocial.append(title);
    }
    socialEntries.forEach(({ platform, handle }) => {
      dom.publicProfileSocial.append(createSocialLinkButton(platform, handle));
    });
    if (showSocial && socialEntries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "public-profile-modal__social-empty";
      empty.textContent = "Sin redes públicas";
      dom.publicProfileSocial.append(empty);
    }
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
        const topicName = document.createElement("span");
        topicName.className = "public-profile-modal__cafe-name";
        topicName.textContent = topic.title || "Tema sin título";
        item.append(topicName);
        if (isTopicAvailable(topic)) {
          const openButton = document.createElement("button");
          openButton.className = "text-button public-profile-modal__cafe-button";
          openButton.type = "button";
          openButton.textContent = "Ir al tema";
          openButton.dataset.publicProfileTopicId = topic.id;
          openButton.setAttribute("aria-label", `Ir al tema ${topicName.textContent}`);
          item.append(openButton);
        }
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
