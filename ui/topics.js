import { createEmptyState, createTopicItem, createTopicSkeleton } from "../components.js";
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
      return [createEmptyState("Todavia no hay temas", "Crea el primer tema para abrir la comunidad.")];
    }

    return topics.map((topic) => {
      const button = createTopicItem(topic, state.users, topic.id === state.selectedTopicId, state.viewer?.id || null);
      button.addEventListener("click", () => onFocusTopic(topic.id));
      return button;
    });
  });
}