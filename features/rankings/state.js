import {
  getActiveRankingIndex,
  getStoredRankingIndex,
  setStoredRankingIndex
} from "../../ranking-state.js";

const RANKING_ACTION_TYPES = {
  setScope: "rankings/setScope",
  focusTopic: "rankings/focusTopic",
  selectStep: "rankings/selectStep",
  stepBy: "rankings/stepBy"
};

export function setRankingScopeAction(scope) {
  return {
    type: RANKING_ACTION_TYPES.setScope,
    payload: { scope }
  };
}

export function focusTopicAction(topicId, options = {}) {
  return {
    type: RANKING_ACTION_TYPES.focusTopic,
    payload: {
      topicId,
      mobileView: options.mobileView ?? null
    }
  };
}

export function selectRankingStepAction(index) {
  return {
    type: RANKING_ACTION_TYPES.selectStep,
    payload: { index }
  };
}

export function stepRankingAction(delta) {
  return {
    type: RANKING_ACTION_TYPES.stepBy,
    payload: { delta }
  };
}

export function isRankingStateAction(action) {
  return Object.values(RANKING_ACTION_TYPES).includes(action?.type);
}

export function reduceRankingState(state, action) {
  switch (action.type) {
    case RANKING_ACTION_TYPES.setScope: {
      const scope = action.payload?.scope;
      if (scope !== "global" && scope !== "topic") {
        return { changed: false, reason: "invalid-scope" };
      }
      if (state.rankingScope === scope) {
        return { changed: false, reason: "same-scope" };
      }

      const nextIndex = getStoredRankingIndex(state, scope);
      const nextState = { ...state, rankingScope: scope };
      setStoredRankingIndex(nextState, nextIndex, scope);

      return { changed: true, scope, nextState };
    }

    case RANKING_ACTION_TYPES.focusTopic: {
      const nextTopicId = action.payload?.topicId ?? null;
      const nextMobileView = action.payload?.mobileView ?? null;
      const topicChanged = state.selectedTopicId !== nextTopicId;
      const mobileViewChanged = Boolean(nextMobileView && state.mobileView !== nextMobileView);

      if (!topicChanged && !mobileViewChanged) {
        return { changed: false, reason: "same-topic" };
      }

      return {
        changed: true,
        topicId: nextTopicId,
        nextState: {
          ...state,
          selectedTopicId: nextTopicId,
          mobileView: nextMobileView || state.mobileView
        }
      };
    }

    case RANKING_ACTION_TYPES.selectStep: {
      const previousIndex = getStoredRankingIndex(state);
      const nextState = { ...state };
      setStoredRankingIndex(nextState, action.payload?.index ?? 0);
      const nextIndex = getStoredRankingIndex(nextState);

      if (nextIndex === previousIndex) {
        return { changed: false, reason: "same-index" };
      }
      return { changed: true, index: nextIndex, nextState };
    }

    case RANKING_ACTION_TYPES.stepBy: {
      const previousIndex = getStoredRankingIndex(state);
      const nextState = { ...state };
      setStoredRankingIndex(nextState, getActiveRankingIndex(state) + (action.payload?.delta ?? 0));
      const nextIndex = getStoredRankingIndex(nextState);

      if (nextIndex === previousIndex) {
        return { changed: false, reason: "same-index" };
      }
      return { changed: true, index: nextIndex, nextState };
    }

    default:
      return { changed: false, reason: "unknown-action" };
  }
}
