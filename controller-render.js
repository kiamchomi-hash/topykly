import { renderAdminPanel } from "./ui/admin-panel.js";
import { renderChat } from "./ui/chat.js";
import { renderFeedback } from "./ui/feedback.js";
import { renderFriendRequests } from "./ui/friend-requests.js";
import { renderNotifications } from "./ui/notifications.js";
import { renderPaletteModal } from "./ui/palette-modal.js";
import { renderProfileModal } from "./ui/profile-modal.js";
import { renderPublicProfileModal } from "./ui/public-profile-modal.js";
import { renderRankings } from "./ui/rankings.js";
import { renderTitles } from "./ui/titles.js";
import { renderUsers } from "./ui/users.js";
import { renderTopicsWithFocus } from "./ui/topic-renderers.js";

export function createRenderers({ state, dom, actions, responsive, closeTimerRef, getTransitionDurationMs }) {
  function render() {
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
    renderPublicProfileModal(state, dom);
    renderAdminPanel(state, dom);
    renderFeedback(state, dom);
    renderFriendRequests(state, dom);
    renderNotifications(state, dom);
    actions.syncAuthUi?.();
    responsive.updateLayoutMetrics();
  }

  return { render };
}
