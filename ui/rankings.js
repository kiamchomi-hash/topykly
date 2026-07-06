import { createRankingItem, createRankingSkeleton } from "../components.js";
import { getActiveRankingStep, getScopeActiveRankingStep } from "../ranking-state.js";
import { buildPostRankingEntries, buildUserRankingEntries } from "./ranking-data.js";
import { renderIntoTargets } from "./render-utils.js";
import {
  resetRankingScroll,
  showRankingEmpty,
  showRankingList,
  showRankingLoading,
  syncRankingListHeights,
  syncRankingSkeletonHeights
} from "./ranking-panel-state.js";

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
    renderIntoTargets([dom.rankingList], "scroll-list ranking-list", () =>
      rankings.map((entry, index) => createRankingItem(entry, index, state.rankingScope))
    );
  }

  // 2. Render Mobile Drawer (both lists)
  if (dom.drawerGlobalRankingList && dom.drawerTopicRankingList) {
    // A. Render Global List
    const globalStep = getScopeActiveRankingStep(state, "global");
    const globalBackend = state.rankings?.["global"]?.[globalStep.type]?.[globalStep.metric] ?? null;
    const globalRankings = globalBackend ?? (
      globalStep.type === "users"
        ? buildUserRankingEntries(state.topics, state.users, state.currentUserId, globalStep.metric, state.selectedTopicId, "global")
        : buildPostRankingEntries(state.topics, state.users, state.currentUserId, globalStep.metric, state.selectedTopicId, "global")
    );
    dom.drawerGlobalRankingList.hidden = false;
    renderIntoTargets([dom.drawerGlobalRankingList], "scroll-list ranking-list", () =>
      globalRankings.map((entry, index) => createRankingItem(entry, index, "global"))
    );

    // B. Render Topic List
    const hasTopic = !!state.selectedTopicId;
    if (dom.drawerTopicRankingPanel) {
      dom.drawerTopicRankingPanel.hidden = false;
    }
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
      renderIntoTargets([dom.drawerTopicRankingList], "scroll-list ranking-list", () =>
        topicRankings.map((entry, index) => createRankingItem(entry, index, "topic"))
      );
    } else {
      dom.drawerTopicRankingList.className = "scroll-list ranking-list ranking-list--empty";
      dom.drawerTopicRankingList.innerHTML = `
        <div class="ranking-empty">
          <div class="ranking-empty__text">Selecciona un tema para ver su actividad real</div>
        </div>
      `;
    }

    const activeTopic = hasTopic ? state.topics.byId?.[state.selectedTopicId] ?? state.topics.find?.((topic) => topic.id === state.selectedTopicId) : null;
    const titleEl = document.getElementById("drawerTopicRankingTitle");
    if (titleEl) {
      titleEl.textContent = activeTopic ? `Tema: ${activeTopic.title}` : "Tema";
    }
  }

  syncRankingListHeights(dom);
  resetRankingScroll(dom);
}
