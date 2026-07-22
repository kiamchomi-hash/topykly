export function selectUsersViewModel(state) {
  const hidePendingCurrentUser = Boolean(state.viewer?.profilePending);
  const items = state.users.allIds
    .map((id) => state.users.byId[id])
    .filter((user) => user.online && !(hidePendingCurrentUser && user.id === state.currentUserId))
    .sort((left, right) => {
      if (left.id === state.currentUserId) return -1;
      if (right.id === state.currentUserId) return 1;
      return (right.connectedOrder ?? 0) - (left.connectedOrder ?? 0);
    })
    .slice(0, 10)
    .map((user) => ({
      id: user.id,
      name: user.name,
      isCurrent: user.id === state.currentUserId,
      isActive: user.id === state.activeConnectedUserId
    }));

  return {
    isLoading: state.users.allIds.length === 0,
    items
  };
}
