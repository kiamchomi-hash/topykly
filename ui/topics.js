import { createTopicItem, createTopicSkeleton } from "../components.js";
import { getVisibleTopics, TOPIC_VISIBLE_LIMIT } from "../model.js";
import { renderIntoTargets } from "./render-utils.js";

export function renderTopics(state, dom, onFocusTopic) {
  const topics = getVisibleTopics(state.topics);
  const isLoading = !state.viewer;

  renderIntoTargets([dom.topicList, dom.leftDrawerTopics], "scroll-list topic-list", () => {
    if (isLoading) {
      return Array.from({ length: TOPIC_VISIBLE_LIMIT }, (_, i) => createTopicSkeleton(i));
    }

    if (!topics.length) {
      return [];
    }

    return topics.map((topic) => {
      const isUnread = state.unreadTopicIds?.includes?.(topic.id) ?? false;
      const button = createTopicItem(topic, state.users, topic.id === state.selectedTopicId, state.viewer?.id || null, isUnread);
      button.addEventListener("click", () => onFocusTopic(topic.id));
      return button;
    });
  });
}