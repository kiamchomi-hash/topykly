import { getSelectedTopic } from "../model.js";
import { filterDisplayText } from "../profanity-filter.js";
import { getCurrentRankingLabel, getRankingOptions, renderRankingLabel, getScopeRankingLabel } from "./ranking-labels.js";
import { getRankingGlyph, getScopeIcon } from "./ranking-icons.js";

const SITE_NAME = "TOPYKLY";
const BASE_TITLE = "TOPYKLY — Conversaciones por temas en español";

const observedChatTitles = new WeakSet();
let chatTitleResizeObserver = null;

function resetChatTitleMarquee(title, track) {
  title.classList.remove("is-overflowing");
  track.style.removeProperty("--chat-title-marquee-duration");
  track.style.removeProperty("--chat-title-marquee-distance");
}

function syncChatTitleMarquee(title) {
  const track = title.querySelector?.(".chat-title__track");
  const text = title.querySelector?.(".chat-title__text");
  if (!track || !text) {
    return;
  }

  const titleWidth = title.getBoundingClientRect?.().width || title.clientWidth || 0;
  const textWidth = text.getBoundingClientRect?.().width || text.scrollWidth || 0;
  if (titleWidth <= 0 || textWidth <= titleWidth + 1) {
    resetChatTitleMarquee(title, track);
    return;
  }

  const overflowDistance = Math.ceil(textWidth - titleWidth);
  const durationSeconds = Math.max(6, overflowDistance / 30 + 3);
  const nextDuration = `${durationSeconds.toFixed(2)}s`;
  const nextDistance = `${-overflowDistance}px`;
  if (
    title.classList.contains("is-overflowing")
    && track.style.getPropertyValue("--chat-title-marquee-duration") === nextDuration
    && track.style.getPropertyValue("--chat-title-marquee-distance") === nextDistance
  ) {
    return;
  }

  track.style.setProperty("--chat-title-marquee-duration", nextDuration);
  track.style.setProperty("--chat-title-marquee-distance", nextDistance);
  title.classList.add("is-overflowing");
}

function scheduleChatTitleMarquee(title) {
  const sync = () => syncChatTitleMarquee(title);
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(sync);
  } else {
    sync();
  }

  if (!observedChatTitles.has(title) && typeof ResizeObserver === "function") {
    chatTitleResizeObserver ??= new ResizeObserver((entries) => {
      entries.forEach((entry) => syncChatTitleMarquee(entry.target));
    });
    chatTitleResizeObserver.observe(title);
    observedChatTitles.add(title);
  }
}

function setChatTitle(title, value) {
  const track = title?.querySelector?.(".chat-title__track");
  const text = title?.querySelector?.(".chat-title__text");
  if (!track || !text) {
    if (title) {
      title.textContent = value;
    }
    return;
  }

  if (text.textContent !== value) {
    resetChatTitleMarquee(title, track);
    text.textContent = value;
  }
  title.title = value;
  scheduleChatTitleMarquee(title);
}

export function renderTitles(state, dom) {
  const topic = getSelectedTopic(state.topics, state.selectedTopicId);
  const topicTitle = topic ? filterDisplayText(topic.title) : null;
  const chatTitleWrapper = dom.chatTitle?.parentElement ?? null;

  if (typeof document !== "undefined") {
    document.title = topic ? `${SITE_NAME} - ${topicTitle}` : BASE_TITLE;
  }

  if (dom.chatTitle) {
    setChatTitle(dom.chatTitle, topic ? topicTitle : "Nuevo tema");
  }
  if (chatTitleWrapper) {
    chatTitleWrapper.hidden = !topic && state.mobileView !== "chat";
  }

  if (dom.chatTopicName) {
    dom.chatTopicName.textContent = topic ? topicTitle : "Crear un tema";
  }
  if (dom.chatTopicDescription) {
    dom.chatTopicDescription.textContent = topic
      ? filterDisplayText(topic.subtitle)
      : "Escribe un titulo y el primer mensaje para abrir un tema nuevo.";
  }

  if (dom.rankingsTitle) {
    dom.rankingsTitle.textContent = "Ranking";
  }
  if (dom.drawerRankingsTitle) {
    dom.drawerRankingsTitle.textContent = "Ranking";
  }

  const currentLabel = getCurrentRankingLabel(state);

  // Desktop
  if (dom.rankingCurrent) {
    const labelEl = dom.rankingCurrent.querySelector(".button-label");
    if (labelEl) {
      labelEl.innerHTML = renderRankingLabel(currentLabel);
    }
    dom.rankingCurrent.setAttribute("aria-label", `Modo actual: ${currentLabel}`);
  }

  // Mobile drawer Global
  if (dom.drawerGlobalRankingCurrent) {
    const globalLabel = getScopeRankingLabel(state, "global");
    const labelEl = dom.drawerGlobalRankingCurrent.querySelector(".button-label");
    if (labelEl) {
      labelEl.innerHTML = renderRankingLabel(globalLabel);
    }
    dom.drawerGlobalRankingCurrent.setAttribute("aria-label", `Modo actual: ${globalLabel}`);
  }

  // Mobile drawer Topic
  if (dom.drawerRankingCurrent) {
    const topicLabel = getScopeRankingLabel(state, "topic");
    const labelEl = dom.drawerRankingCurrent.querySelector(".button-label");
    if (labelEl) {
      labelEl.innerHTML = renderRankingLabel(topicLabel);
    }
    dom.drawerRankingCurrent.setAttribute("aria-label", `Modo actual: ${topicLabel}`);
  }

  const glyph = getRankingGlyph(state);
  if (dom.rankingsGlyph) {
    dom.rankingsGlyph.innerHTML = glyph;
  }
  if (dom.drawerRankingsGlyph) {
    dom.drawerRankingsGlyph.innerHTML = glyph;
  }

  const scopeIcon = getScopeIcon(state.rankingScope);
  if (dom.rankingScopeButton) {
    dom.rankingScopeButton.setAttribute(
      "aria-label",
      state.rankingScope === "global" ? "Cambiar a ranking por tema" : "Cambiar a ranking global"
    );
  }
  if (dom.rankingScopeIcon) {
    dom.rankingScopeIcon.innerHTML = scopeIcon;
  }

  [dom.rankingScopeTabs, dom.drawerRankingScopeTabs].forEach((container) => {
    syncScopeTabs(container, state.rankingScope);
  });

  renderRankingModeOptions(dom.rankingModeList, state, currentLabel);

  syncThemeToggle(dom.themeToggle, state.theme);
}

function syncThemeToggle(button, theme) {
  if (!button) {
    return;
  }

  const isDark = theme === "dark";
  button.setAttribute("role", "switch");
  button.setAttribute("aria-checked", String(isDark));
  button.setAttribute("aria-label", "Tema oscuro");
  button.setAttribute("title", isDark ? "Cambiar a tema claro" : "Cambiar a tema oscuro");
}

function syncScopeTabs(container, scope) {
  if (!container) {
    return;
  }

  container.querySelectorAll("[data-ranking-scope]").forEach((button) => {
    const isActive = button.dataset.rankingScope === scope;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function renderRankingModeOptions(container, state, currentLabel) {
  if (!container) {
    return;
  }

  container.innerHTML = getRankingOptions(state)
    .map(
      ({ index, order, label, active }) => `
        <button
          class="ranking-mode-list__option${active ? " is-active" : ""}"
          type="button"
          data-ranking-index="${index}"
          aria-pressed="${active}"
          aria-label="${active ? `Modo activo: ${currentLabel}` : `Ver ${label}`}"
        >
          <span class="ranking-mode-list__index" aria-hidden="true">${order}</span>
          <span class="ranking-mode-list__label">${label}</span>
        </button>
      `
    )
    .join("");
}
