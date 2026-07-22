import {
  getCurrentRankingLabel,
  getRankingOptions,
  renderRankingLabel
} from "../../ui/ranking-labels.js";
import { getRankingGlyph, getScopeIcon } from "../../ui/ranking-icons.js";
import { selectChatViewModel } from "../chat/selectors.js";

const RANKINGS_TITLE = "Ranking";

export function selectTitlesViewModel(state) {
  const chatViewModel = selectChatViewModel(state);
  const currentLabel = getCurrentRankingLabel(state);
  const scopeButtonLabel =
    state.rankingScope === "global" ? "Cambiar a ranking por tema" : "Cambiar a ranking global";

  return {
    chatTitle: chatViewModel.chatTitle,
    chatTitleVisible: chatViewModel.chatTitleVisible,
    chatTopicName: chatViewModel.heroTopicName,
    chatTopicDescription: chatViewModel.heroTopicDescription,
    rankingsTitle: RANKINGS_TITLE,
    currentLabelMarkup: renderRankingLabel(currentLabel),
    currentAriaLabel: `Modo actual: ${currentLabel}`,
    rankingsGlyph: getRankingGlyph(state),
    scopeIcon: getScopeIcon(state.rankingScope),
    scopeButtonLabel,
    rankingScope: state.rankingScope,
    rankingOptions: getRankingOptions(state)
  };
}
