import { createEmptyState, createUserItem, createUserSkeleton } from "../components.js";
import { renderIntoTargets } from "./render-utils.js";

export function renderUsers(state, dom) {
  const isLoading = !state.viewer;
  const ordered = [...state.users]
    .filter((user) => user.online)
    .sort((a, b) => {
      if (a.id === state.currentUserId) return -1;
      if (b.id === state.currentUserId) return 1;
      return (b.connectedOrder ?? 0) - (a.connectedOrder ?? 0);
    })
    .slice(0, 10);

  renderIntoTargets([dom.userList, dom.drawerUserList], "scroll-list user-list", () => {
    if (isLoading) {
      return Array.from({ length: 10 }, (_, i) => createUserSkeleton(i));
    }

    if (!ordered.length) {
      return [createEmptyState("Sin usuarios todavia", "Los perfiles reales apareceran cuando la gente se registre.")];
    }

    return ordered.map((user) => createUserItem(user, state.currentUserId, state.activeConnectedUserId));
  });
}