import { getSelectedTopic } from "../model.js";
import { getCurrentRankingLabel, getRankingOptions, renderRankingLabel } from "./ranking-labels.js";
import { getRankingGlyph, getScopeIcon } from "./ranking-icons.js";

const SITE_NAME = "TOPYKLY";

export function renderTitles(state, dom) {
  const topic = getSelectedTopic(state.topics, state.selectedTopicId);
  const chatTitleWrapper = dom.chatTitle?.parentElement ?? null;

  if (typeof document !== "undefined") {
    document.title = topic ? `${SITE_NAME} - ${topic.title}` : SITE_NAME;
  }

  if (dom.chatTitle) {
    dom.chatTitle.textContent = topic ? topic.title : "";
  }
  if (chatTitleWrapper) {
    chatTitleWrapper.hidden = !topic;
  }

  if (dom.chatTopicName) {
    dom.chatTopicName.textContent = topic ? topic.title : "Crear un tema";
  }
  if (dom.chatTopicDescription) {
    dom.chatTopicDescription.textContent = topic
      ? topic.subtitle
      : "Escribe un titulo y el primer mensaje para abrir un tema nuevo.";
  }

  if (dom.rankingsTitle) {
    dom.rankingsTitle.textContent = "Ranking";
  }
  if (dom.drawerRankingsTitle) {
    dom.drawerRankingsTitle.textContent = "Ranking";
  }

  const currentLabel = getCurrentRankingLabel(state);
  const currentAriaLabel = `Modo actual: ${currentLabel}`;
  [
    dom.rankingCurrent,
    dom.drawerRankingCurrent
  ].forEach((button) => {
    if (!button) {
      return;
    }
    const label = button.querySelector(".button-label");
    if (label) {
      label.innerHTML = renderRankingLabel(currentLabel);
    }
    button.setAttribute("aria-label", currentAriaLabel);
  });

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
