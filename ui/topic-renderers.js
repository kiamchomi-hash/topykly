import { closeDrawers } from "./drawers.js";
import { renderTopics } from "./topics.js";

export function renderTopicsWithFocus({
  state,
  dom,
  actions,
  responsive,
  closeTimerRef,
  getTransitionDurationMs
}) {
  renderTopics(state, dom, (topicId) => {
    actions.focusTopic(topicId);
    closeDrawers(dom, responsive.isMobileViewport, getTransitionDurationMs, closeTimerRef);
  });
}
