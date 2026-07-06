const REQUIRED_DOM_KEYS = [
  "shell",
  "workspace",
  "topbar",
  "themeToggle",
  "refreshButton",
  "chatTitle",
  "messageForm",
  "rankingPrev",
  "rankingCurrent",
  "rankingNext",
  "drawerRankingPrev",
  "drawerRankingCurrent",
  "drawerRankingNext",
  "openRightDrawer",
  "drawerBackdrop",
  "profileButton",
  "backToTopics",
  "authTools",
  "friendRequestsButton",
  "notificationsButton",
  "messagesButton",
  "authButton",
  "storeButton",
  "paletteButton",
  "themeToggleDesktopSlot",
  "themeToggleMobileSlot",
  "themeToggleDrawerSlot",
  "mobileTopbarMenu",
  "mobileDrawerPanels",
  "paletteModalBackdrop",
  "authModalBackdrop",
  "authModal",
  "closeAuthModalButton",
  "authGoogleButton",
  "authTurnstile",
  "authTurnstileToken",
  "authStatus",
  "authPasswordForm",
  "authLoginModeButton",
  "authRegisterModeButton",
  "authNicknameInput",
  "authEmailInput",
  "authPasswordInput",
  "authPasswordButton",
  "profileModalBackdrop",
  "publicProfileModalBackdrop",
  "adminPanelButton",
  "adminModalBackdrop",
  "adminModal",
  "adminPanelBody",
  "closeAdminModalButton",
  "paletteModal",
  "profileModal",
  "publicProfileModal",
  "publicProfileName",
  "publicProfileAvatar",
  "publicProfileMeta",
  "publicProfileDescription",
  "publicProfileJoinedAt",
  "publicProfileRecentCafes",
  "publicProfileActions",
  "publicProfileReportButton",
  "closePublicProfileModalButton",
  "profileDisplayName",
  "profileAvatarPreview",
  "profileNameSection",
  "profileNameEditButton",
  "profileNameInput",
  "profileNameFeedback",
  "profileAvatarSection",
  "profileJoinedAtSection",
  "profileJoinedAtText",
  "profileJoinedAtVisibilityButton",
  "profileDescriptionSection",
  "profileDescriptionEditButton",
  "profileDescriptionVisibilityButton",
  "profileDescriptionInput",
  "profileAvatarInput",
  "profileAvatarPickButton",
  "profileAvatarCropBackdrop",
  "profileAvatarCropModal",
  "profileAvatarCropFrame",
  "profileAvatarCropImage",
  "profileAvatarCropZoom",
  "profileAvatarCropCancelButton",
  "profileAvatarCropApplyButton",
  "skipProfileButton",
  "saveProfileButton",
  "closeProfileModalButton",
  "actionFeedback",
  "paletteOptionGrid",
  "closePaletteModalButton",
  "chatTopicName",
  "chatTopicDescription",
  "rankingsTitle",
  "rankingScopeTabs",
  "rankingModeList",
  "rankingsGlyph",
  "rankingScopeButton",
  "rankingScopeIcon",
  "rankingsEmpty",
  "rankingsBody",
  "rankingsPanel",
  "rankingCarousel",
  "drawerRankingsTitle",
  "drawerRankingScopeTabs",
  "drawerRankingsGlyph",
  "drawerRankingsEmpty",
  "drawerRankingsBody",
  "drawerRankingsSection",
  "drawerUsersSection",
  "drawerRankingSwitch",
  "topicTitleInput",
  "messageInput",
  "messageStream",
  "topicList",
  "createTopicButton",
  "leftDrawerTopics",
  "userList",
  "drawerUserList",
  "rankingList",
  "drawerRankingList",
  "drawerGlobalRankingList",
  "drawerTopicRankingList",
  "leftDrawer",
  "rightDrawer"
];

const DOM_IDS = [
  "themeToggle", "refreshButton", "reportTopicButton", "chatTitle", "messageForm",
  "rankingPrev", "rankingCurrent", "rankingNext",
  "drawerRankingPrev", "drawerRankingCurrent", "drawerRankingNext",
  "drawerGlobalRankingPrev", "drawerGlobalRankingCurrent", "drawerGlobalRankingNext",
  "drawerTopicRankingHeader", "drawerGlobalRankingHeader",
  "drawerGlobalRankingPanel", "drawerTopicRankingPanel",
  "openRightDrawer", "drawerBackdrop", "profileButton", "backToTopics",
  "authTools", "friendRequestsButton", "notificationsButton", "messagesButton",
  "authButton", "storeButton", "paletteButton", "adminPanelButton", "adminModalBackdrop", "adminModal", "adminPanelBody", "closeAdminModalButton", "themeToggleDesktopSlot", "themeToggleMobileSlot", "themeToggleDrawerSlot", "mobileTopbarMenu", "mobileDrawerPanels", "paletteModalBackdrop",
  "authModalBackdrop",
  "authModal",
  "closeAuthModalButton",
  "authGoogleButton",
  "authTurnstile",
  "authTurnstileToken",
  "authStatus",
  "authPasswordForm",
  "authLoginModeButton",
  "authRegisterModeButton",
  "authNicknameInput",
  "authEmailInput",
  "authPasswordInput",
  "authPasswordButton",
  "profileModalBackdrop",
  "publicProfileModalBackdrop",
  "adminPanelButton",
  "adminModalBackdrop",
  "adminModal",
  "adminPanelBody",
  "closeAdminModalButton",
  "paletteModal",
  "profileModal",
  "publicProfileModal",
  "publicProfileName",
  "publicProfileAvatar",
  "publicProfileMeta",
  "publicProfileDescription",
  "publicProfileJoinedAt",
  "publicProfileRecentCafes",
  "publicProfileActions",
  "publicProfileReportButton",
  "closePublicProfileModalButton",
  "profileDisplayName",
  "profileAvatarPreview",
  "profileNameSection",
  "profileNameEditButton",
  "profileNameInput",
  "profileNameFeedback",
  "profileAvatarSection",
  "profileJoinedAtSection",
  "profileJoinedAtText",
  "profileJoinedAtVisibilityButton",
  "profileDescriptionSection",
  "profileDescriptionEditButton",
  "profileDescriptionVisibilityButton",
  "profileDescriptionInput",
  "profileAvatarInput",
  "profileAvatarPickButton",
  "profileAvatarCropBackdrop",
  "profileAvatarCropModal",
  "profileAvatarCropFrame",
  "profileAvatarCropImage",
  "profileAvatarCropZoom",
  "profileAvatarCropCancelButton",
  "profileAvatarCropApplyButton",
  "skipProfileButton",
  "saveProfileButton",
  "closeProfileModalButton",
  "actionFeedback", "paletteOptionGrid", "closePaletteModalButton",
  "chatTopicName", "chatTopicDescription", "rankingsTitle",
  "rankingScopeTabs", "rankingModeList", "rankingsGlyph",
  "rankingScopeButton", "rankingScopeIcon", "rankingsEmpty",
  "drawerRankingsTitle", "drawerRankingScopeTabs",
  "drawerRankingsGlyph",
  "drawerRankingsEmpty", "topicTitleInput", "messageInput", "messageStream",
  "topicList", "createTopicButton", "leftDrawerTopics", "userList",
  "drawerUserList", "rankingList", "drawerRankingList", "drawerGlobalRankingList", "drawerTopicRankingList", "leftDrawer", "rightDrawer"
];

export function cacheDom() {
  const baseCache = {
    shell: document.querySelector(".shell"),
    workspace: document.querySelector(".workspace"),
    topbar: document.querySelector(".topbar"),
    rankingsBody: document.querySelector(".panel__body--users-rankings .rankings-section"),
    drawerRankingsBody: document.querySelector(".panel__body--drawer-rankings"),
    drawerCloseButtons: Array.from(document.querySelectorAll("[data-close-drawer]"))
  };

  // Pre-populate with known IDs for performance
  DOM_IDS.forEach((id) => {
    baseCache[id] = document.getElementById(id);
  });

  const domProxy = new Proxy(baseCache, {
    get(target, prop) {
      if (target[prop] !== undefined) {
        return target[prop];
      }

      // If not in cache, try to find it by ID
      if (typeof prop === "string") {
        const element = document.getElementById(prop);
        if (element) {
          target[prop] = element;
          return element;
        }
      }

      return undefined;
    }
  });

  domProxy.rankingsPanel = domProxy.rankingsTitle?.closest(".panel--users-rankings") ?? null;
  domProxy.rankingCarousel = domProxy.rankingPrev?.closest(".ranking-carousel") ?? null;
  domProxy.drawerRankingsSection = domProxy.drawerRankingList?.closest(".drawer__section") ?? null;
  domProxy.drawerUsersSection = domProxy.drawerUserList?.closest(".drawer__section") ?? null;
  domProxy.drawerRankingSwitch = domProxy.drawerRankingPrev?.closest(".drawer-ranking__switch") ?? null;
  domProxy.drawerGlobalRankingSwitch = domProxy.drawerGlobalRankingPrev?.closest(".drawer-ranking__switch") ?? null;
  domProxy.drawerTopicRankingSwitch = domProxy.drawerRankingPrev?.closest(".drawer-ranking__switch") ?? null;
  domProxy.composerSubmitButton = domProxy.messageForm?.querySelector('button[type="submit"]') ?? null;

  assertRequiredDom(domProxy);
  return domProxy;
}

function assertRequiredDom(cached) {
  const missing = REQUIRED_DOM_KEYS.filter((key) => !cached[key]);
  if (!cached.drawerCloseButtons.length) {
    missing.push("drawerCloseButtons");
  }

  if (missing.length) {
    throw new Error(`Missing required DOM nodes: ${missing.join(", ")}`);
  }
}
