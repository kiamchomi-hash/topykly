import { createProfileAvatar, el } from "../../shared/components/base.js";

export function createTopicItem(topic) {
  const button = el("button", `topic-item${topic.selected ? " is-active" : ""}`);
  button.type = "button";
  button.dataset.id = topic.id;

  const avatar = createProfileAvatar();
  const content = el("span", "topic-item__content");
  content.append(
    el("span", "topic-item__title", topic.title),
    el("span", "topic-item__meta", topic.meta)
  );

  button.append(avatar, content);
  return button;
}

export function createTopicSkeleton() {
  const button = el("button", "topic-item topic-item--skeleton");
  button.type = "button";
  button.disabled = true;

  const avatar = createProfileAvatar();
  const content = el("span", "topic-item__content");
  content.append(el("span", "topic-item__title"), el("span", "topic-item__meta"));

  button.append(avatar, content);
  return button;
}
