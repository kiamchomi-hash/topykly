import { createEmptyState, createTopicItem, createTopicSkeleton } from "../components.js";
import { getVisibleTopics, TOPIC_VISIBLE_LIMIT } from "../model.js";
import { renderIntoTargets } from "./render-utils.js";

// Sin temas la lista quedaba literalmente vacia y la app se leia como rota. El
// texto cambia segun el viewer porque un invitado no puede abrir un tema: decirle
// que use el boton seria mandarlo contra el muro de registro sin avisarle.
export function createTopicsEmptyState(state) {
  return state.viewer?.type === "registered"
    ? createEmptyState(
        "Todavía no hay conversaciones abiertas",
        "Abrí la primera con «Crear nuevo tema»."
      )
    : createEmptyState(
        "Todavía no hay conversaciones abiertas",
        "Creá una cuenta para abrir la primera."
      );
}

export function renderTopics(state, dom, onFocusTopic) {
  const topics = getVisibleTopics(state.topics);
  const isLoading = !state.viewer;

  renderIntoTargets([dom.topicList, dom.leftDrawerTopics], "scroll-list topic-list", () => {
    if (isLoading) {
      return Array.from({ length: TOPIC_VISIBLE_LIMIT }, (_, i) => createTopicSkeleton(i));
    }

    if (!topics.length) {
      return [createTopicsEmptyState(state)];
    }

    return topics.map((topic) => {
      const isUnread = state.unreadTopicIds?.includes?.(topic.id) ?? false;
      const button = createTopicItem(
        topic,
        state.users,
        topic.id === state.selectedTopicId,
        state.viewer?.id || null,
        isUnread
      );
      button.addEventListener("click", (event) => {
        event.preventDefault();
        onFocusTopic(topic.id);
      });
      return button;
    });
  });
}
