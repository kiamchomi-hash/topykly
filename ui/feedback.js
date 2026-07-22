export function renderFeedback(state, dom) {
  const node = dom.actionFeedback;
  if (!node) {
    return;
  }

  const feedback = state.feedback;
  if (!feedback?.message) {
    node.hidden = true;
    node.textContent = "";
    delete node.dataset.feedbackKind;
    return;
  }

  node.hidden = false;
  node.textContent = feedback.message;
  node.dataset.feedbackKind = feedback.kind || "info";
}
