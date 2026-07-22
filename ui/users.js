import { createUserItem, createUserSkeleton } from "../components.js";
import { renderIntoTargets } from "./render-utils.js";

const RANK_CHANGE_ANIMATION_MS = 320;
// Keep these in sync with the .user-item--leaving transition timings in styles.css:
// fade out, then a pause with the empty space still reserved, then the gap collapses.
const LEAVE_FADE_MS = 350;
const LEAVE_PAUSE_MS = 700;
const LEAVE_COLLAPSE_MS = 380;
const LEAVE_COLLAPSE_DELAY_MS = LEAVE_FADE_MS + LEAVE_PAUSE_MS;
const LEAVE_ANIMATION_MS = LEAVE_COLLAPSE_DELAY_MS + LEAVE_COLLAPSE_MS + 80;

export function selectOnlineUsers(state) {
  const hidePendingCurrentUser = Boolean(state.viewer?.profilePending);
  return state.users.filter(
    (user) => user.online && !(hidePendingCurrentUser && user.id === state.currentUserId)
  );
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
  );
}

function captureUserItemTops(targets) {
  const topsByTarget = new Map();
  targets.forEach((target) => {
    if (!target) {
      return;
    }

    const topsById = new Map();
    Array.from(target.children).forEach((child) => {
      if (child.dataset?.id) {
        topsById.set(child.dataset.id, child.getBoundingClientRect().top);
      }
    });
    topsByTarget.set(target, topsById);
  });
  return topsByTarget;
}

function playRankChangeAnimations(targets, previousTopsByTarget) {
  targets.forEach((target) => {
    if (!target) {
      return;
    }

    const previousTops = previousTopsByTarget.get(target);
    if (!previousTops?.size) {
      return;
    }

    Array.from(target.children).forEach((child) => {
      const id = child.dataset?.id;
      if (!id || !previousTops.has(id) || child.classList.contains("user-item--leaving")) {
        return;
      }

      const deltaY = previousTops.get(id) - child.getBoundingClientRect().top;
      if (!deltaY) {
        return;
      }

      child.style.transition = "none";
      child.style.transform = `translateY(${deltaY}px)`;
      child.getBoundingClientRect();
      child.style.transition = `transform ${RANK_CHANGE_ANIMATION_MS}ms ease`;
      child.style.transform = "";
      child.classList.add(deltaY > 0 ? "user-item--rising" : "user-item--falling");

      const clearAnimation = () => {
        child.style.transition = "";
        child.classList.remove("user-item--rising", "user-item--falling");
        child.removeEventListener("transitionend", clearAnimation);
      };
      child.addEventListener("transitionend", clearAnimation);
      setTimeout(clearAnimation, RANK_CHANGE_ANIMATION_MS + 80);
    });
  });
}

function getPreviousOrder(targets) {
  const source = targets.find((target) => target && target.children.length > 0);
  if (!source) {
    return [];
  }

  return Array.from(source.children)
    .map((child) => child.dataset?.id)
    .filter(Boolean);
}

function getUserMenuIdScope(target) {
  return target.id || "user-list";
}

// A leaving item stays in the DOM (mid fade/collapse) across several render() calls,
// since polling re-renders every 1s while the leave animation runs longer than that.
// Reusing the same still-animating node (instead of building a fresh one each time)
// keeps reconcile()'s patch a no-op for it, so it never clobbers the in-progress
// inline height/padding styles driving the collapse.
function buildMergedUserItemsForTarget(target, ordered, leavingIds, previousOrder, state) {
  const menuIdScope = getUserMenuIdScope(target);
  const items = ordered.map((user) => ({
    id: user.id,
    node: createUserItem(user, state.currentUserId, state.activeConnectedUserId, menuIdScope)
  }));

  const existingByIdInTarget = new Map();
  Array.from(target.children).forEach((child) => {
    if (child.dataset?.id) {
      existingByIdInTarget.set(child.dataset.id, child);
    }
  });

  leavingIds.forEach((id) => {
    const existingNode = existingByIdInTarget.get(id);
    let node;

    if (existingNode?.classList.contains("user-item--leaving")) {
      node = existingNode;
    } else {
      const user = state.users.find((candidate) => candidate.id === id);
      if (!user) {
        return;
      }
      node = createUserItem(user, state.currentUserId, state.activeConnectedUserId, menuIdScope);
      node.classList.add("user-item--leaving");
    }

    const originalIndex = previousOrder.indexOf(id);
    const insertAt = originalIndex >= 0 ? Math.min(originalIndex, items.length) : items.length;
    items.splice(insertAt, 0, { id, node });
  });

  return items.map((item) => item.node);
}

function captureUserItemHeights(targets, ids) {
  const heightsByTarget = new Map();
  targets.forEach((target) => {
    if (!target) {
      return;
    }

    const heightsById = new Map();
    Array.from(target.children).forEach((child) => {
      if (child.dataset?.id && ids.has(child.dataset.id)) {
        heightsById.set(child.dataset.id, child.getBoundingClientRect().height);
      }
    });
    heightsByTarget.set(target, heightsById);
  });
  return heightsByTarget;
}

function playLeaveCollapseAnimations(targets, previousHeightsByTarget) {
  targets.forEach((target) => {
    if (!target) {
      return;
    }

    const previousHeights = previousHeightsByTarget.get(target);
    if (!previousHeights?.size) {
      return;
    }

    Array.from(target.children).forEach((child) => {
      const id = child.dataset?.id;
      if (!id || !previousHeights.has(id)) {
        return;
      }

      child.style.height = `${previousHeights.get(id)}px`;
      child.getBoundingClientRect();
      requestAnimationFrame(() => {
        child.style.height = "0px";
        child.style.paddingTop = "0px";
        child.style.paddingBottom = "0px";
      });
    });
  });
}

function scheduleLeaveCleanup(targets, leavingIds) {
  setTimeout(() => {
    targets.forEach((target) => {
      if (!target) {
        return;
      }

      Array.from(target.children).forEach((child) => {
        if (leavingIds.has(child.dataset?.id) && child.classList.contains("user-item--leaving")) {
          child.remove();
        }
      });
    });
  }, LEAVE_ANIMATION_MS);
}

export function renderUsers(state, dom) {
  const isLoading = !state.viewer;
  const ordered = selectOnlineUsers(state);
  const targets = [dom.userList, dom.drawerUserList];
  const skipAnimation = isLoading || prefersReducedMotion();
  const previousTops = skipAnimation ? null : captureUserItemTops(targets);
  const previousOrder = skipAnimation ? [] : getPreviousOrder(targets);
  const currentIds = new Set(ordered.map((user) => user.id));
  const leavingIds = skipAnimation
    ? new Set()
    : new Set(previousOrder.filter((id) => !currentIds.has(id)));

  const alreadyLeavingIds = new Set();
  if (leavingIds.size) {
    const source = targets.find((target) => target && target.children.length > 0);
    Array.from(source?.children || []).forEach((child) => {
      if (
        child.dataset?.id &&
        leavingIds.has(child.dataset.id) &&
        child.classList.contains("user-item--leaving")
      ) {
        alreadyLeavingIds.add(child.dataset.id);
      }
    });
  }
  const newlyLeavingIds = new Set([...leavingIds].filter((id) => !alreadyLeavingIds.has(id)));
  const previousHeights = newlyLeavingIds.size
    ? captureUserItemHeights(targets, newlyLeavingIds)
    : null;

  if (!leavingIds.size) {
    targets.forEach((target) => {
      if (!target) {
        return;
      }

      renderIntoTargets([target], "scroll-list user-list", () => {
        if (isLoading) {
          return Array.from({ length: 10 }, (_, i) => createUserSkeleton(i));
        }

        if (!ordered.length) {
          return [];
        }

        const menuIdScope = getUserMenuIdScope(target);
        return ordered.map((user) =>
          createUserItem(user, state.currentUserId, state.activeConnectedUserId, menuIdScope)
        );
      });
    });
  } else {
    targets.forEach((target) => {
      if (!target) {
        return;
      }
      renderIntoTargets([target], "scroll-list user-list", () =>
        buildMergedUserItemsForTarget(target, ordered, leavingIds, previousOrder, state)
      );
    });
  }

  if (previousTops) {
    playRankChangeAnimations(targets, previousTops);
  }

  if (newlyLeavingIds.size) {
    if (previousHeights) {
      playLeaveCollapseAnimations(targets, previousHeights);
    }
    scheduleLeaveCleanup(targets, newlyLeavingIds);
  }
}
