export { formatMessageTime } from "../../ui/date-utils.js";

export function getUserNameById(users, userId, fallback = "Anonimo") {
  if (users.byId && users.byId[userId]) {
    return users.byId[userId].name;
  }
  
  // Fallback for cases where users might be passed as array (legacy or specific components)
  if (Array.isArray(users)) {
    return users.find((user) => user.id === userId)?.name ?? fallback;
  }
  
  return fallback;
}
