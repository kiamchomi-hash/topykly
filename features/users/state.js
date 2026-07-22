const USER_ACTION_TYPES = {
  activateConnectedUser: "users/activateConnectedUser"
};

export function activateConnectedUserAction(userId) {
  return {
    type: USER_ACTION_TYPES.activateConnectedUser,
    payload: { userId }
  };
}

export function isUserStateAction(action) {
  return Object.values(USER_ACTION_TYPES).includes(action?.type);
}

export function reduceUserState(state, action) {
  switch (action.type) {
    case USER_ACTION_TYPES.activateConnectedUser: {
      const userId = action.payload?.userId;
      const targetUser = state.users.byId[userId];
      if (!targetUser) {
        return { changed: false, reason: "missing-user" };
      }

      return {
        changed: true,
        user: targetUser,
        nextState: { ...state, activeConnectedUserId: userId }
      };
    }

    default:
      return { changed: false, reason: "unknown-action" };
  }
}
