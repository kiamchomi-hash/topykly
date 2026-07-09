import { buildUsers } from "../model.js";

export class ApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ApiError";
    this.code = details.code || "API_ERROR";
    this.status = details.status || 500;
    this.retryAfterSeconds = details.retryAfterSeconds ?? null;
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
    users: buildUsers(payload.users || []),
    topics: Array.isArray(payload.topics) ? payload.topics.map(normalizeTopic) : []
  };
}

export const api = {
  async fetchInitialData(selectedTopicId = null) {
    return request("/api/bootstrap", {
      searchParams: {
        selectedTopicId
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

  async openTopic(topicId) {
    return request(`/api/topics/${encodeURIComponent(topicId)}`);
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
    return normalizeBackendPayload(await readApiPayload("/api/auth/password/login", {
      method: "POST",
      body: { email, password, selectedTopicId, turnstileToken }
    }));
  },

  async registerWithPassword({ email, password, nickname, selectedTopicId = null, turnstileToken = "" } = {}) {
    return normalizeBackendPayload(await readApiPayload("/api/auth/password/register", {
      method: "POST",
      body: { email, password, nickname, selectedTopicId, turnstileToken }
    }));
  },
  async logout(selectedTopicId = null) {
    return request("/api/auth/logout", {
      method: "POST",
      body: { selectedTopicId }
    });
  },

  async updateProfile({ displayName = null, description = "", profileShowDescription = true, profileShowJoinedAt = true, avatarDataUrl = null, removeAvatar = false, selectedTopicId = null } = {}) {
    return request("/api/profile", {
      method: "PATCH",
      body: {
        displayName,
        description,
        profileShowDescription,
        profileShowJoinedAt,
        avatarDataUrl,
        removeAvatar,
        selectedTopicId
      }
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

  async applyModerationAction(actionType, targetType, targetId, reason = "", selectedTopicId = null) {
    return request("/api/moderation/actions", {
      method: "POST",
      body: {
        actionType,
        targetType,
        targetId,
        reason,
        selectedTopicId
      }
    });
  }
};
