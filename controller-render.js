import { renderAdminPanel } from "./ui/admin-panel.js";
import { renderChat } from "./ui/chat.js";
import { renderFeedback } from "./ui/feedback.js";
import { renderFriendRequests } from "./ui/friend-requests.js";
import { renderNotifications } from "./ui/notifications.js";
import { renderPaletteModal } from "./ui/palette-modal.js?v=20260709-topicrace1";
import { renderProfileModal } from "./ui/profile-modal.js";
import { renderPublicProfileModal } from "./ui/public-profile-modal.js";
import { renderRankings } from "./ui/rankings.js";
import { renderReportModal } from "./ui/report-modal.js";
import { renderTitles } from "./ui/titles.js";
import { renderUsers } from "./ui/users.js";
import { renderTopicsWithFocus } from "./ui/topic-renderers.js";
import { renderSettingsModal } from "./ui/settings-modal.js";
import { setProfanityFilterEnabled } from "./profanity-filter.js";
import { topicPath } from "./services/seo-pages.js";

export function getAppLocationPath(state) {
  const profileUser = state.publicProfileUserId
    ? (state.users ?? []).find((user) => user.id === state.publicProfileUserId)
    : null;
  if (profileUser && profileUser.type === "registered" && profileUser.nickname) {
    return `/u/${encodeURIComponent(profileUser.nickname)}`;
  }

  const topic = state.selectedTopicId
    ? (state.topics ?? []).find((candidate) => candidate.id === state.selectedTopicId)
    : null;
  if (topic) {
    return topicPath(topic);
  }

  return "/";
}

// Refleja en la barra de direcciones el enlace estándar de lo que está en
// pantalla (/u/<nickname> o /tema/<id>/<slug>) sin recargar ni tocar el
// historial: al recargar, el servidor sirve la página pública equivalente.
function syncLocationWithState(state) {
  if (typeof window === "undefined" || typeof window.history?.replaceState !== "function") {
    return;
  }

  const nextPath = getAppLocationPath(state);
  if (window.location.pathname !== nextPath) {
    window.history.replaceState({}, "", `${nextPath}${window.location.search}${window.location.hash}`);
  }
}

export function createRenderers({ state, dom, actions, responsive, closeTimerRef, getTransitionDurationMs }) {
  function render() {
    setProfanityFilterEnabled(Boolean(state.viewer?.filterProfanity));
    responsive.syncResponsiveView();
    renderTopicsWithFocus({
      state,
      dom,
      actions,
      responsive,
      closeTimerRef,
      getTransitionDurationMs
    });
    renderChat(state, dom);
    renderUsers(state, dom);
    renderRankings(state, dom);
    renderTitles(state, dom);
    renderPaletteModal(state, dom);
    renderProfileModal(state, dom);
    renderSettingsModal(state, dom);
    renderPublicProfileModal(state, dom);
    renderAdminPanel(state, dom);
    renderReportModal(state, dom);
    renderFeedback(state, dom);
    renderFriendRequests(state, dom);
    renderNotifications(state, dom);
    actions.syncAuthUi?.();
    responsive.updateLayoutMetrics();
    syncLocationWithState(state);
  }

  return { render };
}
