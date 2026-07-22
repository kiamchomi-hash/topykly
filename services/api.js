import { buildUsers } from "../model.js";

export class ApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ApiError";
    this.code = details.code || "API_ERROR";
    this.status = details.status || 500;
    this.retryAfterSeconds = details.retryAfterSeconds ?? null;
    this.rateLimitKind = details.rateLimitKind ?? null;
    this.topicStatus = details.topicStatus ?? null;
  }
}

function clearLegacyClientSessionId() {
  if (typeof localStorage === "undefined") {
    return;
  }

  try {
    localStorage.removeItem("topykly-session-id");
    localStorage.removeItem("chetrend-session-id");
  } catch {
    // Ignore storage failures; auth relies on HttpOnly cookies.
  }
}

function getProductSourceGroup() {
  if (typeof window === "undefined") {
    return "direct";
  }

  const storageKey = "topykly-product-source";
  try {
    const stored = window.sessionStorage?.getItem(storageKey);
    if (stored) {
      return stored;
    }
  } catch {
    // Storage is optional; source detection still works for this page.
  }

  const url = new URL(window.location.href);
  const medium = String(url.searchParams.get("utm_medium") || "").toLowerCase();
  const hasCampaign = url.searchParams.has("utm_source") || url.searchParams.has("utm_campaign");
  let source = hasCampaign ? "campaign" : "direct";
  if (medium === "email" || medium === "newsletter") {
    source = "email";
  } else if (typeof document !== "undefined" && document.referrer) {
    const referrer = new URL(document.referrer);
    const host = referrer.hostname.toLowerCase();
    if (host === window.location.hostname.toLowerCase()) {
      source = "internal";
    } else if (/(google|bing|duckduckgo|yahoo|ecosia)\./.test(host)) {
      source = "search";
    } else if (/(facebook|instagram|tiktok|twitter|x|reddit|whatsapp|linkedin)\./.test(host)) {
      source = "social";
    } else {
      source = "referral";
    }
  }

  try {
    window.sessionStorage?.setItem(storageKey, source);
  } catch {
    // Ignore storage failures.
  }
  return source;
}

function createHeaders(extraHeaders = {}) {
  clearLegacyClientSessionId();
  return {
    "Content-Type": "application/json",
    ...extraHeaders
  };
}

function createUrl(pathname, searchParams = {}) {
  const origin = typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1";
  const url = new URL(pathname, origin);
  Object.entries(searchParams).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url;
}

async function request(pathname, { method = "GET", body, searchParams } = {}) {
  const response = await fetch(createUrl(pathname, searchParams), {
    method,
    credentials: "same-origin",
    headers: createHeaders(),
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorPayload = payload?.error || {};
    throw new ApiError(errorPayload.message || "Error de API.", {
      code: errorPayload.code,
      status: response.status,
      retryAfterSeconds: errorPayload.retryAfterSeconds,
      rateLimitKind: errorPayload.rateLimitKind,
      topicStatus: errorPayload.topicStatus
    });
  }

  return normalizeBackendPayload(payload);
}

async function readApiPayload(pathname, { method = "GET", body, searchParams } = {}) {
  const response = await fetch(createUrl(pathname, searchParams), {
    method,
    credentials: "same-origin",
    headers: createHeaders(),
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorPayload = payload?.error || {};
    throw new ApiError(errorPayload.message || "Error de API.", {
      code: errorPayload.code,
      status: response.status,
      retryAfterSeconds: errorPayload.retryAfterSeconds,
      rateLimitKind: errorPayload.rateLimitKind,
      topicStatus: errorPayload.topicStatus
    });
  }

  return payload;
}

function normalizeMessage(message) {
  const createdAt = message.createdAt || message.timestamp || new Date().toISOString();
  return {
    ...message,
    createdAt,
    timestamp: new Date(createdAt)
  };
}

function normalizeTopic(topic) {
  return {
    ...topic,
    visible: Boolean(topic.isVisible ?? topic.visible),
    messages: Array.isArray(topic.messages) ? topic.messages.map(normalizeMessage) : []
  };
}

function normalizeBackendPayload(payload) {
  clearLegacyClientSessionId();
  return {
    viewer: payload.viewer || null,
    selectedTopicId: payload.selectedTopicId ?? null,
    reportedTopicIds: Array.isArray(payload.reportedTopicIds) ? payload.reportedTopicIds : [],
    reportedMessageIds: Array.isArray(payload.reportedMessageIds) ? payload.reportedMessageIds : [],
    friendships: payload.friendships || {
      incoming: [],
      outgoing: [],
      friends: []
    },
    blockedUsers: Array.isArray(payload.blockedUsers) ? payload.blockedUsers : [],
    followedTopicIds: Array.isArray(payload.followedTopicIds) ? payload.followedTopicIds : [],
    pendingModerationCount: Number.isFinite(payload.pendingModerationCount)
      ? payload.pendingModerationCount
      : 0,
    users: buildUsers(payload.users || []),
    topics: Array.isArray(payload.topics) ? payload.topics.map(normalizeTopic) : []
  };
}

export const api = {
  async fetchInitialData(selectedTopicId = null, profileNickname = null) {
    return request("/api/bootstrap", {
      searchParams: {
        selectedTopicId,
        perfil: profileNickname
      }
    });
  },

  async refreshTopics(selectedTopicId = null) {
    return request("/api/topics", {
      searchParams: {
        selectedTopicId
      }
    });
  },

  openLiveEvents() {
    if (typeof EventSource === "undefined") {
      return null;
    }
    return new EventSource("/api/live");
  },

  async openTopic(topicId) {
    return request(`/api/topics/${encodeURIComponent(topicId)}`);
  },

  async followTopic(topicId, selectedTopicId = null) {
    return request(`/api/topics/${encodeURIComponent(topicId)}/follow`, {
      method: "POST",
      body: { selectedTopicId }
    });
  },

  async getAuthStatus() {
    return readApiPayload("/api/auth/status");
  },

  async login(selectedTopicId = null, { turnstileToken = "" } = {}) {
    const payload = await readApiPayload("/api/auth/login", {
      method: "POST",
      body: { selectedTopicId, turnstileToken }
    });

    if (payload.mode === "redirect" && payload.redirectUrl) {
      if (typeof window !== "undefined" && typeof window.location?.assign === "function") {
        window.location.assign(payload.redirectUrl);
      }

      return {
        redirected: true
      };
    }

    return normalizeBackendPayload(payload);
  },

  async loginWithPassword({ email, password, selectedTopicId = null, turnstileToken = "" } = {}) {
    return normalizeBackendPayload(
      await readApiPayload("/api/auth/password/login", {
        method: "POST",
        body: { email, password, selectedTopicId, turnstileToken }
      })
    );
  },

  async requestEmailAuthCode({
    email,
    nickname = "",
    age = null,
    password = "",
    acceptedTerms = false,
    termsVersion = null,
    turnstileToken = ""
  } = {}) {
    return readApiPayload("/api/auth/email/request-code", {
      method: "POST",
      body: {
        email,
        nickname,
        age,
        password,
        acceptedTerms,
        termsVersion,
        turnstileToken
      }
    });
  },
  async verifyEmailAuthCode({ challengeId, code, selectedTopicId = null } = {}) {
    return normalizeBackendPayload(
      await readApiPayload("/api/auth/email/verify-code", {
        method: "POST",
        body: { challengeId, code, selectedTopicId }
      })
    );
  },

  async requestPasswordResetCode({ email, turnstileToken = "" } = {}) {
    return readApiPayload("/api/auth/password/reset/request", {
      method: "POST",
      body: { email, turnstileToken }
    });
  },

  async confirmPasswordReset({ challengeId, code, newPassword, selectedTopicId = null } = {}) {
    return normalizeBackendPayload(
      await readApiPayload("/api/auth/password/reset/confirm", {
        method: "POST",
        body: { challengeId, code, newPassword, selectedTopicId }
      })
    );
  },

  async startAccountLink({ password, selectedTopicId = null, turnstileToken = "" } = {}) {
    const payload = await readApiPayload("/api/auth/account-link/start", {
      method: "POST",
      body: { password, selectedTopicId, turnstileToken }
    });

    if (payload.mode === "redirect" && payload.redirectUrl) {
      if (typeof window !== "undefined" && typeof window.location?.assign === "function") {
        window.location.assign(payload.redirectUrl);
      }
      return { redirected: true };
    }

    return payload;
  },

  async logout(selectedTopicId = null) {
    return request("/api/auth/logout", {
      method: "POST",
      body: { selectedTopicId }
    });
  },

  async updateProfile({
    displayName = null,
    username = null,
    age = null,
    acceptedTerms = false,
    termsVersion = null,
    description = "",
    profileShowDescription = true,
    profileShowJoinedAt = true,
    socialWhatsapp = "",
    socialInstagram = "",
    socialTiktok = "",
    socialFacebook = "",
    socialTwitter = "",
    socialDiscord = "",
    profileShowSocial = true,
    profileIndexable = null,
    avatarDataUrl = null,
    removeAvatar = false,
    selectedTopicId = null
  } = {}) {
    return request("/api/profile", {
      method: "PATCH",
      body: {
        displayName,
        username,
        age,
        acceptedTerms,
        termsVersion,
        description,
        profileShowDescription,
        profileShowJoinedAt,
        socialWhatsapp,
        socialInstagram,
        socialTiktok,
        socialFacebook,
        socialTwitter,
        socialDiscord,
        profileShowSocial,
        profileIndexable,
        avatarDataUrl,
        removeAvatar,
        selectedTopicId
      }
    });
  },

  async updateSettings({
    likesAnonymous = null,
    filterProfanity = null,
    notificationsFriendsOnly = null,
    emailActivityEnabled = null,
    slowMode = null,
    profileIndexable = null,
    selectedTopicId = null
  } = {}) {
    return request("/api/settings", {
      method: "PATCH",
      body: {
        likesAnonymous,
        filterProfanity,
        notificationsFriendsOnly,
        emailActivityEnabled,
        slowMode,
        profileIndexable,
        selectedTopicId
      }
    });
  },

  async deleteAccount(selectedTopicId = null, currentPassword = "") {
    return request("/api/account/delete", {
      method: "POST",
      body: { selectedTopicId, currentPassword }
    });
  },

  async submitMessage(topicId, text) {
    return request(`/api/topics/${encodeURIComponent(topicId)}/messages`, {
      method: "POST",
      body: { text }
    });
  },

  async createTopic(title, text) {
    return request("/api/topics", {
      method: "POST",
      body: { title, text }
    });
  },

  async trackProductEvent(eventName, routeGroup = null) {
    const resolvedRouteGroup =
      routeGroup ?? (typeof window !== "undefined" ? window.location.pathname : "/");
    return readApiPayload("/api/events", {
      method: "POST",
      body: { eventName, routeGroup: resolvedRouteGroup, sourceGroup: getProductSourceGroup() }
    });
  },

  async getProductAnalytics(days = 30) {
    return readApiPayload("/api/admin/analytics", {
      searchParams: { days }
    });
  },

  async toggleMessageLike(messageId, selectedTopicId = null) {
    return request(`/api/messages/${encodeURIComponent(messageId)}/like`, {
      method: "POST",
      body: { selectedTopicId }
    });
  },
  async toggleMessageDislike(messageId, selectedTopicId = null) {
    return request(`/api/messages/${encodeURIComponent(messageId)}/dislike`, {
      method: "POST",
      body: { selectedTopicId }
    });
  },
  async reportEntity(entityType, entityId, reason = "", selectedTopicId = null) {
    return request("/api/reports", {
      method: "POST",
      body: {
        entityType,
        entityId,
        reason,
        selectedTopicId
      }
    });
  },

  async sendFriendRequest(userId, selectedTopicId = null) {
    return request(`/api/friends/${encodeURIComponent(userId)}/request`, {
      method: "POST",
      body: { selectedTopicId }
    });
  },

  async acceptFriendRequest(userId, selectedTopicId = null) {
    return request(`/api/friends/${encodeURIComponent(userId)}/accept`, {
      method: "POST",
      body: { selectedTopicId }
    });
  },

  async rejectFriendRequest(userId, selectedTopicId = null) {
    return request(`/api/friends/${encodeURIComponent(userId)}/reject`, {
      method: "POST",
      body: { selectedTopicId }
    });
  },
  async blockUser(userId, hideContent = true, selectedTopicId = null) {
    return request(`/api/blocks/${encodeURIComponent(userId)}`, {
      method: "POST",
      body: { hideContent, selectedTopicId }
    });
  },

  async updateBlockedUser(userId, hideContent, selectedTopicId = null) {
    return request(`/api/blocks/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: { hideContent, selectedTopicId }
    });
  },

  async unblockUser(userId, selectedTopicId = null) {
    return request(`/api/blocks/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      body: { selectedTopicId }
    });
  },
  async getAdminDashboard(searchParams = {}) {
    return readApiPayload("/api/admin/dashboard", { searchParams });
  },

  async listReports(searchParams = {}) {
    const response = await fetch(createUrl("/api/moderation/reports", searchParams), {
      method: "GET",
      credentials: "same-origin",
      headers: createHeaders()
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorPayload = payload?.error || {};
      throw new ApiError(errorPayload.message || "Error de API.", {
        code: errorPayload.code,
        status: response.status
      });
    }

    return {
      reports: Array.isArray(payload.reports) ? payload.reports : [],
      reportPagination: payload.reportPagination || null
    };
  },

  async applyModerationAction(
    actionType,
    targetType,
    targetId,
    reason = "",
    selectedTopicId = null,
    banHours = null
  ) {
    return request("/api/moderation/actions", {
      method: "POST",
      body: {
        actionType,
        targetType,
        targetId,
        reason,
        selectedTopicId,
        banHours
      }
    });
  }
};
