import { selectTitlesViewModel } from "./selectors.js";

export function renderTitleBar(state, dom) {
  const viewModel = selectTitlesViewModel(state);
  const chatTitleWrapper = dom.chatTitle?.parentElement ?? null;

  if (dom.chatTitle) {
    dom.chatTitle.textContent = viewModel.chatTitle;
  }
  if (chatTitleWrapper) {
    chatTitleWrapper.hidden = !viewModel.chatTitleVisible;
  }

  if (dom.chatTopicName) {
    dom.chatTopicName.textContent = viewModel.chatTopicName;
  }
  if (dom.chatTopicDescription) {
    dom.chatTopicDescription.textContent = viewModel.chatTopicDescription;
  }

  if (dom.rankingsTitle) {
    dom.rankingsTitle.textContent = viewModel.rankingsTitle;
  }
  if (dom.drawerRankingsTitle) {
    dom.drawerRankingsTitle.textContent = viewModel.rankingsTitle;
  }

  [dom.rankingCurrent, dom.drawerRankingCurrent].forEach((button) => {
    if (!button) {
      return;
    }
    const label = button.querySelector(".button-label");
    if (label) {
      label.innerHTML = viewModel.currentLabelMarkup;
    }
    button.setAttribute("aria-label", viewModel.currentAriaLabel);
  });

  if (dom.rankingsGlyph) {
    dom.rankingsGlyph.innerHTML = viewModel.rankingsGlyph;
  }
  if (dom.drawerRankingsGlyph) {
    dom.drawerRankingsGlyph.innerHTML = viewModel.rankingsGlyph;
  }

  if (dom.rankingScopeButton) {
    dom.rankingScopeButton.setAttribute("aria-label", viewModel.scopeButtonLabel);
  }
  if (dom.rankingScopeIcon) {
    dom.rankingScopeIcon.innerHTML = viewModel.scopeIcon;
  }

  [dom.rankingScopeTabs, dom.drawerRankingScopeTabs].forEach((container) => {
    syncScopeTabs(container, viewModel.rankingScope);
  });

  renderRankingModeOptions(
    dom.rankingModeList,
    viewModel.rankingOptions,
    viewModel.currentAriaLabel
  );
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

function renderRankingModeOptions(container, options, currentAriaLabel) {
  if (!container) {
    return;
  }

  container.innerHTML = options
    .map(
      ({ index, order, label, active }) => `
        <button
          class="ranking-mode-list__option${active ? " is-active" : ""}"
          type="button"
          data-ranking-index="${index}"
          aria-pressed="${active}"
          aria-label="${active ? currentAriaLabel : `Ver ${label}`}"
        >
          <span class="ranking-mode-list__index" aria-hidden="true">${order}</span>
          <span class="ranking-mode-list__label">${label}</span>
        </button>
      `
    )
    .join("");
}
