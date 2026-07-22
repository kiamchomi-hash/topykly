import { renderChat } from "./ui/chat.js";
import { renderFeedback } from "./ui/feedback.js";
import { renderFriendRequests } from "./ui/friend-requests.js?v=20260716-quality1";
import { renderNotifications } from "./ui/notifications.js?v=20260716-quality1";
import { renderRankings } from "./ui/rankings.js";
import { renderTitles } from "./ui/titles.js";
import { renderUsers } from "./ui/users.js";
import { renderTopicsWithFocus } from "./ui/topic-renderers.js";
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
    window.history.replaceState(
      {},
      "",
      `${nextPath}${window.location.search}${window.location.hash}`
    );
  }
}

export function createRenderers({
  state,
  dom,
  actions,
  responsive,
  closeTimerRef,
  getTransitionDurationMs
}) {
  const secondaryRenderers = {
    admin: {
      load: () => import("./ui/admin-panel.js?v=20260716-quality1"),
      exportName: "renderAdminPanel"
    },
    palette: {
      load: () => import("./ui/palette-modal.js?v=20260716-secondary1"),
      exportName: "renderPaletteModal"
    },
    profile: {
      load: () => import("./ui/profile-modal.js?v=20260716-quality1"),
      exportName: "renderProfileModal"
    },
    publicProfile: {
      load: () => import("./ui/public-profile-modal.js?v=20260716-quality1"),
      exportName: "renderPublicProfileModal"
    },
    report: {
      load: () => import("./ui/report-modal.js?v=20260716-quality1"),
      exportName: "renderReportModal"
    },
    settings: {
      load: () => import("./ui/settings-modal.js?v=20260716-quality1"),
      exportName: "renderSettingsModal"
    },
    store: { load: () => import("./ui/store-modal.js"), exportName: "renderStoreModal" }
  };

  function renderSecondary(entry, active) {
    if (entry.render) {
      entry.render(state, dom);
      return;
    }
    if (!active || entry.promise) {
      return;
    }

    entry.promise = entry
      .load()
      .then((module) => {
        entry.render = module[entry.exportName];
        entry.promise = null;
        render();
      })
      .catch((error) => {
        entry.promise = null;
        console.error(`No se pudo cargar ${entry.exportName}.`, error);
      });
  }

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
    renderSecondary(secondaryRenderers.palette, Boolean(state.isPaletteModalOpen));
    renderSecondary(secondaryRenderers.profile, Boolean(state.isProfileModalOpen));
    renderSecondary(secondaryRenderers.settings, Boolean(state.isSettingsModalOpen));
    renderSecondary(secondaryRenderers.store, Boolean(state.isStoreModalOpen));
    renderSecondary(secondaryRenderers.publicProfile, Boolean(state.publicProfileUserId));
    renderSecondary(secondaryRenderers.admin, Boolean(state.isAdminPanelOpen));
    renderSecondary(secondaryRenderers.report, Boolean(state.reportModal?.isOpen));
    renderFeedback(state, dom);
    renderFriendRequests(state, dom);
    renderNotifications(state, dom);
    actions.syncAuthUi?.();
    responsive.updateLayoutMetrics();
    syncLocationWithState(state);
  }

  return { render };
}
