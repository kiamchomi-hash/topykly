export function showRankingEmpty(dom, emptyHtml) {
  clearRankingListHeights(dom);
  if (dom.rankingsEmpty) {
    dom.rankingsEmpty.innerHTML = emptyHtml;
    dom.rankingsEmpty.hidden = false;
  }
  if (dom.drawerRankingsEmpty) {
    dom.drawerRankingsEmpty.innerHTML = emptyHtml;
    dom.drawerRankingsEmpty.hidden = false;
  }
  if (dom.rankingsBody) {
    dom.rankingsBody.classList.add("is-empty");
  }
  if (dom.drawerRankingsBody) {
    dom.drawerRankingsBody.classList.add("is-empty");
  }
  if (dom.rankingsPanel) {
    dom.rankingsPanel.classList.add("is-empty");
  }
  if (dom.drawerRankingsSection) {
    dom.drawerRankingsSection.classList.add("is-empty");
  }
  [dom.rankingList, dom.drawerRankingList].forEach(list => {
    if (list) {
      list.hidden = true;
    }
  });
  if (dom.rankingCarousel) {
    dom.rankingCarousel.hidden = true;
  }
  if (dom.drawerRankingSwitch) {
    dom.drawerRankingSwitch.hidden = true;
  }
  resetRankingScroll(dom);
}

export function resetRankingScroll(dom) {
  [dom.rankingList, dom.drawerRankingList, dom.drawerGlobalRankingList, dom.drawerTopicRankingList].forEach(list => {
    if (list) {
      list.scrollTop = 0;
    }
  });
}

function captureRankingSkeletonHeight(list) {
  if (!list || list.hidden) {
    return;
  }

  const skeletonItem = list.querySelector(".ranking-item--skeleton");
  if (!skeletonItem) {
    return;
  }

  const height = skeletonItem.getBoundingClientRect().height;
  if (height > 0) {
    list.style.setProperty("--ranking-skeleton-item-height", `${height}px`);
  }
}

export function syncRankingSkeletonHeights(dom) {
  captureRankingSkeletonHeight(dom.rankingList);
  captureRankingSkeletonHeight(dom.drawerRankingList);
  captureRankingSkeletonHeight(dom.drawerGlobalRankingList);
  captureRankingSkeletonHeight(dom.drawerTopicRankingList);
}

function fitRankingListHeight(list) {
  if (!list || list.hidden) {
    return;
  }

  const frame = list.parentElement;
  if (!frame) {
    return;
  }

  list.style.removeProperty("height");
  list.style.removeProperty("min-height");
  list.style.removeProperty("max-height");
  frame.style.setProperty("--ranking-bottom-mask", "0px");

  const items = Array.from(list.querySelectorAll(":scope > .ranking-item"));
  if (!items.length) {
    return;
  }

  const frameRect = frame.getBoundingClientRect();
  if (!frameRect.height) {
    return;
  }

  const partialItem = items.find((item) => {
    const rect = item.getBoundingClientRect();
    return rect.top < frameRect.bottom && rect.bottom > frameRect.bottom;
  });

  if (!partialItem) {
    return;
  }

  const partialRect = partialItem.getBoundingClientRect();
  const maskHeight = Math.max(0, Math.ceil(frameRect.bottom - partialRect.top));
  if (maskHeight > 0) {
    frame.style.setProperty("--ranking-bottom-mask", `${maskHeight}px`);
  }
}

export function syncRankingListHeights(dom) {
  fitRankingListHeight(dom.rankingList);
  fitRankingListHeight(dom.drawerRankingList);
  fitRankingListHeight(dom.drawerGlobalRankingList);
  fitRankingListHeight(dom.drawerTopicRankingList);
}

export function clearRankingListHeights(dom) {
  [dom.rankingList, dom.drawerRankingList, dom.drawerGlobalRankingList, dom.drawerTopicRankingList].forEach((list) => {
    if (!list) {
      return;
    }

    list.style.removeProperty("height");
    list.style.removeProperty("min-height");
    list.style.removeProperty("max-height");
    list.parentElement?.style.setProperty("--ranking-bottom-mask", "0px");
  });
}

export function showRankingList(dom) {
  if (dom.rankingsEmpty) {
    dom.rankingsEmpty.hidden = true;
  }
  if (dom.drawerRankingsEmpty) {
    dom.drawerRankingsEmpty.hidden = true;
  }
  if (dom.rankingsBody) {
    dom.rankingsBody.classList.remove("is-empty");
    dom.rankingsBody.classList.remove("is-loading");
  }
  if (dom.drawerRankingsBody) {
    dom.drawerRankingsBody.classList.remove("is-empty");
    dom.drawerRankingsBody.classList.remove("is-loading");
  }
  if (dom.rankingsPanel) {
    dom.rankingsPanel.classList.remove("is-empty");
    dom.rankingsPanel.classList.remove("is-loading");
  }
  if (dom.drawerRankingsSection) {
    dom.drawerRankingsSection.classList.remove("is-empty");
    dom.drawerRankingsSection.classList.remove("is-loading");
  }
  [dom.rankingList, dom.drawerRankingList].forEach(list => {
    if (list) {
      list.hidden = false;
    }
  });
  if (dom.rankingCarousel) {
    dom.rankingCarousel.hidden = false;
  }
  if (dom.drawerRankingSwitch) {
    dom.drawerRankingSwitch.hidden = false;
  }
}

export function showRankingLoading(dom) {
  if (dom.rankingsBody) {
    dom.rankingsBody.classList.add("is-loading");
  }
  if (dom.drawerRankingsBody) {
    dom.drawerRankingsBody.classList.add("is-loading");
  }
  if (dom.rankingsPanel) {
    dom.rankingsPanel.classList.add("is-loading");
  }
  if (dom.drawerRankingsSection) {
    dom.drawerRankingsSection.classList.add("is-loading");
  }
  clearRankingListHeights(dom);
  [dom.rankingList, dom.drawerRankingList].forEach(list => {
    if (list) {
      list.hidden = true;
    }
  });
}
