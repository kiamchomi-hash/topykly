import { formatCommentCount, getActiveTopics, getSelectedTopic } from "../model.js";

function buildRankingEntries(counts, users, currentUserId, emptyTitle, emptyMeta, limit, formatMeta) {
  const entries = [...counts.entries()]
    .map(([authorId, count]) => ({
      id: authorId,
      title: users.find((user) => user.id === authorId)?.name ?? "Anónimo",
      count,
      meta: formatMeta(count),
      active: authorId === currentUserId
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  if (!entries.length) {
    return [
      {
        id: "empty",
        title: emptyTitle,
        meta: emptyMeta,
        active: false
      }
    ];
  }

  return entries;
}

function countTopicComments(topics) {
  const counts = new Map();
  topics.forEach((topic) => {
    const count = topic.messages.filter((message) => message.kind === "user").length;
    counts.set(topic.id, count);
  });
  return counts;
}

function countTopicLikes(topics) {
  const counts = new Map();
  topics.forEach((topic) => {
    const count = topic.messages.reduce(
      (sum, message) => sum + (message.kind === "user" ? (message.likes ?? 0) : 0),
      0
    );
    counts.set(topic.id, count);
  });
  return counts;
}

function countUserComments(topics) {
  const counts = new Map();
  topics.forEach((topic) => {
    topic.messages.forEach((message) => {
      if (message.kind !== "user") {
        return;
      }
      counts.set(message.authorId, (counts.get(message.authorId) ?? 0) + 1);
    });
  });
  return counts;
}

function countUserLikes(topics) {
  const counts = new Map();
  topics.forEach((topic) => {
    topic.messages.forEach((message) => {
      if (message.kind !== "user") {
        return;
      }
      counts.set(message.authorId, (counts.get(message.authorId) ?? 0) + (message.likes ?? 0));
    });
  });
  return counts;
}

function buildTopicRankingEntries(topics, counts, emptyTitle, emptyMeta, limit, formatMeta) {
  const entries = topics
    .map((topic) => ({
      id: topic.id,
      title: topic.title,
      count: counts.get(topic.id) ?? 0,
      meta: formatMeta(counts.get(topic.id) ?? 0),
      active: false
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  if (!entries.length) {
    return [
      {
        id: "empty",
        title: emptyTitle,
        meta: emptyMeta,
        active: false
      }
    ];
  }

  return entries;
}

function getScopedTopics(topics, selectedTopicId, scope) {
  if (scope !== "topic") {
    return getActiveTopics(topics);
  }

  const selectedTopic = getSelectedTopic(topics, selectedTopicId);
  return selectedTopic ? [selectedTopic] : [];
}

export function buildPostRankingEntries(topics, users, currentUserId, metric = "comments", selectedTopicId = null, scope = "global") {
  const scopedTopics = getScopedTopics(topics, selectedTopicId, scope);
  const counts = metric === "likes" ? countTopicLikes(scopedTopics) : countTopicComments(scopedTopics);
  const limit = scope === "topic" ? 10 : 10;
  return buildTopicRankingEntries(
    scopedTopics,
    counts,
    metric === "likes" ? "Sin likes" : "Sin comentarios",
    metric === "likes"
      ? "Todavía no hay likes para clasificar."
      : "Todavía no hay comentarios para clasificar.",
    limit,
    (count) => (metric === "likes" ? `${count} likes` : formatCommentCount(count))
  );
}

export function buildUserRankingEntries(topics, users, currentUserId, metric = "comments", selectedTopicId = null, scope = "global") {
  const scopedTopics = getScopedTopics(topics, selectedTopicId, scope);
  const counts = metric === "likes" ? countUserLikes(scopedTopics) : countUserComments(scopedTopics);
  const limit = scope === "topic" ? 10 : 10;
  return buildRankingEntries(
    counts,
    users,
    currentUserId,
    metric === "likes" ? "Sin likes" : "Sin comentarios",
    metric === "likes"
      ? "Todavía no hay likes para clasificar."
      : "Todavía no hay comentarios para clasificar.",
    limit,
    (count) => (metric === "likes" ? `${count} likes` : formatCommentCount(count))
  );
}
