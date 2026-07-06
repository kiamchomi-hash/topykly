import { getActiveRankingIndex, getActiveRankingStep, getRankingSteps, getScopeActiveRankingStep } from "../ranking-state.js";
import { getMetricIcon } from "./ranking-icons.js";

const GLOBAL_MODE_LABELS = {
  posts: {
    comments: "Posts / Comentarios",
    likes: "Posts / Likes"
  },
  users: {
    comments: "Usuarios / Comentarios",
    likes: "Usuarios / Likes"
  }
};

const TOPIC_MODE_LABELS = {
  comments: "Usuarios / Comentarios",
  likes: "Usuarios / Likes"
};

export function getRankingModeLabel(step, scope = "global") {
  if (scope === "topic") {
    return TOPIC_MODE_LABELS[step.metric];
  }

  return GLOBAL_MODE_LABELS[step.type][step.metric];
}

export function getCurrentRankingLabel(state) {
  const { type, metric } = getActiveRankingStep(state);

  if (state.rankingScope === "topic") {
    return metric === "likes" ? "LIKES" : "COMENTARIOS";
  }

  if (type === "posts") {
    return metric === "likes" ? "TEMAS LIKES" : "TEMAS COMENTARIOS";
  }

  return metric === "likes" ? "USUARIOS LIKES" : "USUARIOS COMENTARIOS";
}

export function getScopeRankingLabel(state, scope) {
  const { type, metric } = getScopeActiveRankingStep(state, scope);

  if (scope === "topic") {
    return metric === "likes" ? "LIKES" : "COMENTARIOS";
  }

  if (type === "posts") {
    return metric === "likes" ? "TEMAS LIKES" : "TEMAS COMENTARIOS";
  }

  return metric === "likes" ? "USUARIOS LIKES" : "USUARIOS COMENTARIOS";
}

export function getRankingOptions(state) {
  const activeIndex = getActiveRankingIndex(state);

  return getRankingSteps(state.rankingScope).map((step, index) => ({
    index,
    order: String(index + 1).padStart(2, "0"),
    label: getRankingModeLabel(step, state.rankingScope),
    active: index === activeIndex
  }));
}

export function renderRankingLabel(label) {
  const upperLabel = label.toUpperCase();
  if (upperLabel.includes("LIKES")) {
    return `
      <span class="ranking-label__main">${label}</span>
      <span class="ranking-label__icon" aria-hidden="true">${getMetricIcon("likes")}</span>
    `;
  }

  return `
    <span class="ranking-label__main">${label}</span>
    <span class="ranking-label__icon" aria-hidden="true">${getMetricIcon("comments")}</span>
  `;
}
