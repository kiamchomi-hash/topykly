export function bindTopbarRankingEvents(dom, handlers) {
  addListener(dom.rankingScopeButton, "click", handlers.toggleRankingScope);
  addListener(dom.rankingPrev, "click", () => handlers.setRankingStep(-1));
  addListener(dom.rankingNext, "click", () => handlers.setRankingStep(1));
  addListener(dom.drawerGlobalRankingPrev, "click", () => handlers.setScopeRankingStep("global", -1));
  addListener(dom.drawerGlobalRankingNext, "click", () => handlers.setScopeRankingStep("global", 1));
  addListener(dom.drawerRankingPrev, "click", () => handlers.setScopeRankingStep("topic", -1));
  addListener(dom.drawerRankingNext, "click", () => handlers.setScopeRankingStep("topic", 1));

  bindScopeTabs(dom.rankingScopeTabs, handlers.setRankingScope);
  bindScopeTabs(dom.drawerRankingScopeTabs, handlers.setRankingScope);
  bindModeList(dom.rankingModeList, handlers.selectRankingStep);
}

function addListener(node, type, listener) {
  node?.addEventListener?.(type, listener);
}

function bindScopeTabs(container, onSelect) {
  if (!container) {
    return;
  }

  container.addEventListener("click", (event) => {
    const button = event.target.closest("[data-ranking-scope]");
    if (!button || !container.contains(button)) {
      return;
    }

    onSelect(button.dataset.rankingScope);
  });
}

function bindModeList(container, onSelect) {
  if (!container) {
    return;
  }

  container.addEventListener("click", (event) => {
    const button = event.target.closest("[data-ranking-index]");
    if (!button || !container.contains(button)) {
      return;
    }

    onSelect(Number(button.dataset.rankingIndex));
  });
}
