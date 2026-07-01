import { renderChat } from "./ui/chat.js";
import { renderPaletteModal } from "./ui/palette-modal.js";
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
    actions.syncAuthUi?.();
    responsive.updateLayoutMetrics();
  }

  return { render };
}
