export const GLOBAL_RANKING_STEPS = [
  { type: "posts", metric: "comments" },
  { type: "posts", metric: "likes" },
  { type: "users", metric: "comments" },
  { type: "users", metric: "likes" }
];

export const TOPIC_RANKING_STEPS = [
  { type: "users", metric: "comments" },
  { type: "users", metric: "likes" }
];

export function getRankingSteps(scope = "global") {
  return scope === "topic" ? TOPIC_RANKING_STEPS : GLOBAL_RANKING_STEPS;
}

export function getStoredRankingIndex(state, scope = state.rankingScope) {
  return scope === "topic" ? state.topicRankingIndex : state.globalRankingIndex;
}

export function setStoredRankingIndex(state, index, scope = state.rankingScope) {
  const normalizedIndex = normalizeRankingIndex(index, getRankingSteps(scope).length);
  if (scope === "topic") {
    state.topicRankingIndex = normalizedIndex;
  } else {
    state.globalRankingIndex = normalizedIndex;
  }
  return normalizedIndex;
}

export function getActiveRankingIndex(state) {
  return normalizeRankingIndex(
    getStoredRankingIndex(state),
    getRankingSteps(state.rankingScope).length
  );
}

export function getActiveRankingStep(state) {
  const steps = getRankingSteps(state.rankingScope);
  const index = getActiveRankingIndex(state);
  return {
    ...steps[index],
    index
  };
}

export function getScopeActiveRankingStep(state, scope) {
  const steps = getRankingSteps(scope);
  const index = normalizeRankingIndex(getStoredRankingIndex(state, scope), steps.length);
  return {
    ...steps[index],
    index
  };
}

function normalizeRankingIndex(index, length) {
  if (!length) {
    return 0;
  }

  return ((index % length) + length) % length;
}
