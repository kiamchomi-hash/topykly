import { createRankingItem, createRankingSkeleton } from "../components.js";
import { getActiveRankingStep, getScopeActiveRankingStep } from "../ranking-state.js";
import { buildPostRankingEntries, buildUserRankingEntries } from "./ranking-data.js";
import { renderIntoTargets } from "./render-utils.js";
import {
  showRankingEmpty,
  showRankingList,
  showRankingLoading,
  syncRankingListHeights,
  syncRankingSkeletonHeights
} from "./ranking-panel-state.js";

const GLOBAL_RANKING_FADE_MS = 150;

export function renderRankings(state, dom) {
  const activeRankingStep = getActiveRankingStep(state);
  const showTopicEmpty = state.rankingScope === "topic" && !state.selectedTopicId;
  const showTopicSelected = state.rankingScope === "topic" && !!state.selectedTopicId;
  const showGlobalSelected = state.rankingScope === "global";
  const showExtendedRanking = showGlobalSelected || showTopicSelected;
  const isLoading = state.topics.length === 0 || state.users.length === 0;

  if (dom.rankingsBody) {
    dom.rankingsBody.classList.toggle("is-topic-selected", showTopicSelected);
    dom.rankingsBody.classList.toggle("is-ranking-scrollable", showExtendedRanking);
  }
  if (dom.drawerRankingsBody) {
    dom.drawerRankingsBody.classList.toggle("is-topic-selected", showTopicSelected);
    dom.drawerRankingsBody.classList.toggle("is-ranking-scrollable", showExtendedRanking);
  }

  if (isLoading) {
    showRankingList(dom);
    renderIntoTargets([dom.rankingList], "scroll-list ranking-list", () =>
      Array.from({ length: 3 }, (_, i) => createRankingSkeleton(i))
    );
    if (dom.drawerGlobalRankingList) {
      dom.drawerGlobalRankingList.hidden = false;
      renderIntoTargets([dom.drawerGlobalRankingList], "scroll-list ranking-list", () =>
        Array.from({ length: 3 }, (_, i) => createRankingSkeleton(i))
      );
    }
    if (dom.drawerTopicRankingList) {
      dom.drawerTopicRankingList.hidden = false;
      renderIntoTargets([dom.drawerTopicRankingList], "scroll-list ranking-list", () =>
        Array.from({ length: 3 }, (_, i) => createRankingSkeleton(i))
      );
    }
    syncRankingSkeletonHeights(dom);
    return;
  }

  // 1. Render Desktop View
  if (showTopicEmpty) {
    showRankingEmpty(
      dom,
      `
    <div class="ranking-empty">
      <div class="ranking-empty__text">Selecciona un tema para ver su actividad real</div>
    </div>
  `
    );
    renderIntoTargets([dom.rankingList], "scroll-list ranking-list", () => []);
  } else {
    const backendRankings = state.rankings?.[state.rankingScope]?.[activeRankingStep.type]?.[activeRankingStep.metric] ?? null;
    const rankings = backendRankings ?? (
      state.rankingScope === "topic" || activeRankingStep.type === "users"
        ? buildUserRankingEntries(
            state.topics,
            state.users,
            state.currentUserId,
            activeRankingStep.metric,
            state.selectedTopicId,
            state.rankingScope
          )
        : buildPostRankingEntries(
            state.topics,
            state.users,
            state.currentUserId,
            activeRankingStep.metric,
            state.selectedTopicId,
            state.rankingScope
          )
    );

    showRankingList(dom);
    renderRankingTarget(
      dom.rankingList,
      "scroll-list ranking-list",
      getRankingFadeKey(state.rankingScope, activeRankingStep),
      () => rankings.map((entry, index) => createRankingItem(entry, index, state.rankingScope)),
      state.rankingScope === "global",
      ({ keyChanged }) => {
        syncRankingListHeights(dom);
        if (keyChanged) {
          dom.rankingList.scrollTop = 0;
        }
      }
    );
  }

  // 2. Render Mobile Drawer (only the active scope is shown; both are kept rendered
  // so switching scope via the tabs is instant, with no reload/flash)
  if (dom.drawerGlobalRankingList && dom.drawerTopicRankingList) {
    const showGlobalScope = state.rankingScope !== "topic";
    if (dom.drawerGlobalRankingPanel) {
      dom.drawerGlobalRankingPanel.hidden = !showGlobalScope;
    }
    if (dom.drawerTopicRankingPanel) {
      dom.drawerTopicRankingPanel.hidden = showGlobalScope;
    }

    // A. Render Global List
    const globalStep = getScopeActiveRankingStep(state, "global");
    const globalBackend = state.rankings?.["global"]?.[globalStep.type]?.[globalStep.metric] ?? null;
    const globalRankings = globalBackend ?? (
      globalStep.type === "users"
        ? buildUserRankingEntries(state.topics, state.users, state.currentUserId, globalStep.metric, state.selectedTopicId, "global")
        : buildPostRankingEntries(state.topics, state.users, state.currentUserId, globalStep.metric, state.selectedTopicId, "global")
    );
    dom.drawerGlobalRankingList.hidden = false;
    renderRankingTarget(
      dom.drawerGlobalRankingList,
      "scroll-list ranking-list",
      getRankingFadeKey("global", globalStep),
      () => globalRankings.map((entry, index) => createRankingItem(entry, index, "global")),
      true,
      ({ keyChanged }) => {
        syncRankingListHeights(dom);
        if (keyChanged) {
          dom.drawerGlobalRankingList.scrollTop = 0;
        }
      }
    );

    // B. Render Topic List
    const hasTopic = !!state.selectedTopicId;
    dom.drawerTopicRankingList.hidden = false;

    const topicStep = getScopeActiveRankingStep(state, "topic");
    const topicBackend = hasTopic
      ? state.rankings?.["topic"]?.[topicStep.type]?.[topicStep.metric] ?? null
      : null;
    if (hasTopic) {
      const topicRankings = topicBackend ?? (
        topicStep.type === "users"
          ? buildUserRankingEntries(state.topics, state.users, state.currentUserId, topicStep.metric, state.selectedTopicId, "topic")
          : buildPostRankingEntries(state.topics, state.users, state.currentUserId, topicStep.metric, state.selectedTopicId, "topic")
      );
      renderRankingTarget(
        dom.drawerTopicRankingList,
        "scroll-list ranking-list",
        getRankingFadeKey("topic", topicStep),
        () => topicRankings.map((entry, index) => createRankingItem(entry, index, "topic")),
        false,
        ({ keyChanged }) => {
          if (keyChanged) {
            dom.drawerTopicRankingList.scrollTop = 0;
          }
        }
      );
    } else {
      const wasTopicEmpty = dom.drawerTopicRankingList.dataset.rankingFadeKey === "topic:empty";
      dom.drawerTopicRankingList.dataset.rankingFadeKey = "topic:empty";
      dom.drawerTopicRankingList.className = "scroll-list ranking-list ranking-list--empty";
      dom.drawerTopicRankingList.innerHTML = `
        <div class="ranking-empty">
          <div class="ranking-empty__text">Selecciona un tema para ver su actividad real</div>
        </div>
      `;
      if (!wasTopicEmpty) {
        dom.drawerTopicRankingList.scrollTop = 0;
      }
    }

    const activeTopic = hasTopic ? state.topics.byId?.[state.selectedTopicId] ?? state.topics.find?.((topic) => topic.id === state.selectedTopicId) : null;
    const titleEl = document.getElementById("drawerTopicRankingTitle");
    if (titleEl) {
      titleEl.textContent = activeTopic ? `Tema: ${activeTopic.title}` : "Tema";
    }
  }

  syncRankingSkeletonHeights(dom);
  syncRankingListHeights(dom);
}

function renderRankingTarget(target, className, key, buildNodes, shouldFade, onRendered) {
  if (!target) {
    return;
  }

  const nextKey = String(key);
  const hasPreviousKey = typeof target.dataset.rankingFadeKey === "string";
  const keyChanged = hasPreviousKey && target.dataset.rankingFadeKey !== nextKey;
  const canFade = shouldFade && keyChanged && target.children.length > 0 && !prefersReducedMotion();

  target.dataset.rankingFadeKey = nextKey;

  if (!canFade) {
    clearRankingFadeTimer(target);
    target.classList.remove("is-ranking-fading");
    renderIntoTargets([target], className, buildNodes);
    onRendered?.({ keyChanged, target });
    return;
  }

  clearRankingFadeTimer(target);
  target.classList.add("is-ranking-fading");
  target.__rankingFadeTimer = setTimeout(() => {
    renderIntoTargets([target], className, buildNodes);
    onRendered?.({ keyChanged, target });
    scheduleAnimationFrame(() => {
      target.classList.remove("is-ranking-fading");
    });
  }, GLOBAL_RANKING_FADE_MS);
}

function clearRankingFadeTimer(target) {
  if (!target?.__rankingFadeTimer) {
    return;
  }

  clearTimeout(target.__rankingFadeTimer);
  target.__rankingFadeTimer = 0;
}

function getRankingFadeKey(scope, step) {
  return `${scope}:${step.type}:${step.metric}:${step.index}`;
}

function prefersReducedMotion() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scheduleAnimationFrame(callback) {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(callback);
    return;
  }

  setTimeout(callback, 0);
}
