import { getActiveRankingIndex, getStoredRankingIndex, setStoredRankingIndex } from "./ranking-state.js";
import { dispatch, reducers } from "./store-logic.js";

export function createRankingActions({ state, isMobileViewport, syncResponsiveView, render }) {
  function setRankingScope(scope) {
    if (scope !== "global" && scope !== "topic") {
      return;
    }
    if (state.rankingScope === scope) {
      return;
    }

    dispatch(state, reducers.setRankingScope, scope);
    // setStoredRankingIndex handles normalization and cross-scope index preservation
    setStoredRankingIndex(state, getStoredRankingIndex(state));
    render();
  }

  function toggleRankingScope() {
    setRankingScope(state.rankingScope === "global" ? "topic" : "global");
  }

  function focusTopic(topicId) {
    dispatch(state, reducers.setSelectedTopic, topicId);
    if (isMobileViewport()) {
      dispatch(state, reducers.setMobileView, "chat");
      syncResponsiveView();
    }
    render();
  }

  function applyRankingStep(index) {
    // We still use setStoredRankingIndex helper as it has the normalization logic,
    // but we could also move it to a reducer later.
    setStoredRankingIndex(state, index);
    render();
  }

  function setRankingStep(delta) {
    applyRankingStep(getActiveRankingIndex(state) + delta);
  }

  function setScopeRankingStep(scope, delta) {
    const currentIndex = getStoredRankingIndex(state, scope);
    setStoredRankingIndex(state, currentIndex + delta, scope);
    render();
  }

  return {
    setRankingScope,
    toggleRankingScope,
    focusTopic,
    setRankingStep,
    selectRankingStep: applyRankingStep,
    setScopeRankingStep
  };
}
