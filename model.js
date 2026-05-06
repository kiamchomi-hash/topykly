export const TOPIC_VISIBLE_LIMIT = 20;
export const TOPIC_ACTIVE_LIMIT = 60;

export function formatCommentCount(count) {
  return count === 1 ? "1 comentario" : `${count} comentarios`;
}

export function createMessage(authorId, text, minutesAgo, kind = "user", now = Date.now()) {
  return {
    id: crypto.randomUUID(),
    authorId,
    text,
    kind,
    likes: 0,
    timestamp: new Date(now - minutesAgo * 60 * 1000)
  };
}

export function summarizeTopicMessage(text, limit = 96) {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit - 3).trimEnd()}...`;
}

export function createTopic(authorId, title, messageText, now = Date.now()) {
  const normalizedTitle = title.trim().replace(/\s+/g, " ");
  const normalizedMessage = messageText.trim();

  return {
    id: `topic-${crypto.randomUUID()}`,
    title: normalizedTitle,
    subtitle: summarizeTopicMessage(normalizedMessage),
    authorId,
    visible: true,
    messages: [createMessage(authorId, normalizedMessage, 0, "user", now)]
  };
}

export function buildUsers(seedUsers) {
  return seedUsers.map((user, index) => ({
    ...user,
    online: true,
    connectedOrder: index,
    initials: user.name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase()
  }));
}

function createMultilinePreviewMessage(title, index, label) {
  return [
    `${title}: comentario ${label}.`,
    `Linea 2 para revisar el salto real del tema ${index + 1}.`,
    "Linea 3 con texto corto para no deformar toda la tarjeta.",
    "Linea 4 para comprobar la altura visible del bloque.",
    "Linea 5 cerrando esta prueba de varias lineas."
  ].join("\n");
}

export function buildTopics(topicSeedData, users, now = Date.now()) {
  const authorIds = users.map((user) => user.id);
  const authorIndexById = new Map(users.map((user, index) => [user.id, index]));
  const topicAuthorPattern = [0, 1, 2, 0, 3, 0, 1, 4, 0, 5, 0, 2, 6, 0, 1, 7, 0, 8, 9, 0];
  const multilinePreviewMap = new Map([
    [0, "inicial"],
    [5, "del medio"],
    [9, "final"]
  ]);
  const messageTemplates = [
    (title) => `${title} quedo abierto para coordinar sin ruido.`,
    (subtitle) => subtitle,
    (index) => `Dejo un aporte para el hilo ${index + 1}.`,
    () => "Si hace falta, lo seguimos aca mismo.",
    (index) => `Suma otro comentario para mover el ranking ${index + 1}.`,
    () => "Cierro con una nota mas para variar la lista."
  ];

  const topics = topicSeedData.map(([title, subtitle], index) => {
    const topicAuthorId = authorIds[topicAuthorPattern[index % topicAuthorPattern.length] % authorIds.length];
    const messageCount = 10;
    const minutesAgo = [48, 44, 39, 34, 29, 24, 19, 14, 9, 4];

    const messages = Array.from({ length: messageCount }, (_, messageIndex) => {
      const authorId = authorIds[(index + messageIndex) % authorIds.length];
      const textFactory = messageTemplates[messageIndex] ?? messageTemplates[messageTemplates.length - 1];
      const text = multilinePreviewMap.has(messageIndex)
        ? createMultilinePreviewMessage(title, index, multilinePreviewMap.get(messageIndex))
        : textFactory(title, subtitle, index);
      const message = createMessage(authorId, text, minutesAgo[messageIndex] ?? 1, "user", now);
      const authorIndex = authorIndexById.get(message.authorId) ?? 0;
      message.likes = 1 + ((index * 3 + messageIndex + authorIndex) % 5);
      return message;
    });

    return {
      id: `topic-${index + 1}`,
      title,
      subtitle,
      authorId: topicAuthorId,
      visible: true,
      messages
    };
  });

  return prepareTopicFeed(topics);
}

export function getSelectedTopic(topics, selectedTopicId) {
  if (!selectedTopicId) {
    return null;
  }

  return topics.find((topic) => topic.id === selectedTopicId) ?? null;
}

export function trimMessages(messages, limit = 30) {
  return messages.length > limit ? messages.slice(-limit) : messages;
}

export function appendMessageToTopic(topic, message, limit = 30) {
  const messages = trimMessages([...topic.messages, message], limit);
  const subtitle = message.kind === "user"
    ? summarizeTopicMessage(message.text)
    : topic.subtitle;

  return {
    ...topic,
    subtitle,
    messages
  };
}

export function prepareTopicFeed(
  topics,
  activeLimit = TOPIC_ACTIVE_LIMIT,
  visibleLimit = TOPIC_VISIBLE_LIMIT
) {
  return topics.slice(0, activeLimit).map((topic, index) => {
    const visible = index < visibleLimit;
    return topic.visible === visible ? topic : { ...topic, visible };
  });
}

export function getVisibleTopics(topics, visibleLimit = TOPIC_VISIBLE_LIMIT) {
  return topics.filter((topic) => topic.visible !== false).slice(0, visibleLimit);
}

export function insertTopicAtTop(
  topics,
  topic,
  activeLimit = TOPIC_ACTIVE_LIMIT,
  visibleLimit = TOPIC_VISIBLE_LIMIT
) {
  return prepareTopicFeed(
    [topic, ...topics.filter((entry) => entry.id !== topic.id)],
    activeLimit,
    visibleLimit
  );
}

export function reviveTopicWithMessage(
  topics,
  topicId,
  message,
  activeLimit = TOPIC_ACTIVE_LIMIT,
  visibleLimit = TOPIC_VISIBLE_LIMIT
) {
  const targetTopic = topics.find((topic) => topic.id === topicId);
  if (!targetTopic) {
    return prepareTopicFeed(topics, activeLimit, visibleLimit);
  }

  const updatedTopic = appendMessageToTopic(targetTopic, message);
  return prepareTopicFeed(
    [updatedTopic, ...topics.filter((topic) => topic.id !== topicId)],
    activeLimit,
    visibleLimit
  );
}
