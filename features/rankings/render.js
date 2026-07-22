import { createRankingItem, createRankingSkeleton } from "./components/ranking-item.js";
import { renderIntoTargets } from "../../ui/render-utils.js";
import {
  resetRankingScroll,
  showRankingEmpty,
  showRankingList,
  syncRankingListHeights,
  syncRankingSkeletonHeights
} from "../../ui/ranking-panel-state.js";
import { selectRankingsViewModel } from "./selectors.js";

export function renderRankingsPanel(state, dom) {
  const viewModel = selectRankingsViewModel(state);

  if (dom.rankingsBody) {
    dom.rankingsBody.classList.toggle("is-topic-selected", viewModel.showTopicSelected);
    dom.rankingsBody.classList.toggle("is-ranking-scrollable", viewModel.showExtendedRanking);
  }
  if (dom.drawerRankingsBody) {
    dom.drawerRankingsBody.classList.toggle("is-topic-selected", viewModel.showTopicSelected);
    dom.drawerRankingsBody.classList.toggle("is-ranking-scrollable", viewModel.showExtendedRanking);
  }

  if (viewModel.isLoading) {
    showRankingList(dom);
    renderIntoTargets([dom.rankingList, dom.drawerRankingList], "scroll-list ranking-list", () =>
      Array.from({ length: 3 }, (_, index) => createRankingSkeleton(index))
    );
    syncRankingSkeletonHeights(dom);
    return;
  }

  if (viewModel.showTopicEmpty) {
    showRankingEmpty(dom, viewModel.emptyMarkup);
    renderIntoTargets(
      [dom.rankingList, dom.drawerRankingList],
      "scroll-list ranking-list",
      () => []
    );
    return;
  }

  showRankingList(dom);
  renderIntoTargets([dom.rankingList, dom.drawerRankingList], "scroll-list ranking-list", () =>
    viewModel.entries.map((entry, index) => createRankingItem(entry, index, viewModel.scope))
  );
  syncRankingListHeights(dom);
  resetRankingScroll(dom);
}
