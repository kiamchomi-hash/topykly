import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { createAuthService } from "../services/auth-service.js";
import {
  getRequestIp,
  isLocalDevLoginAllowed,
  isRequestOriginAllowed,
  startPreviewServer,
  shouldTrustProxy
} from "../services/preview-server.js";
import {
  createBackendStore,
  MINIMUM_REGISTRATION_AGE,
  resolveDbConfig,
  shouldSeedDemoData,
  TERMS_VERSION
} from "../services/backend-store.js";
import {
  escapeHtml,
  renderTopicPage,
  resolvePublicOrigin,
  slugify
} from "../services/seo-pages.js";
import { backupSqliteDatabase, resolveBackupConfig } from "../scripts/backup-sqlite.mjs";
import { createChatActions } from "../controller-chat-actions.js";
import { composeReportReason, REPORT_REASONS } from "../report-reasons.js";
import { initialUsers, topicSeedData } from "../data.js";
import {
  appendMessageToTopic,
  buildTopics,
  buildUsers,
  createTopic,
  createMessage,
  formatCommentCount,
  getVisibleTopics,
  getSelectedTopic,
  insertTopicAtTop,
  prepareTopicFeed,
  reviveTopicWithMessage,
  summarizeTopicMessage,
  TOPIC_ACTIVE_LIMIT,
  TOPIC_VISIBLE_LIMIT,
  trimMessages
} from "../model.js";
import {
  GLOBAL_RANKING_STEPS,
  TOPIC_RANKING_STEPS,
  getActiveRankingIndex,
  getActiveRankingStep,
  setStoredRankingIndex
} from "../ranking-state.js";
import { createLiveTopicSync, getAuthErrorFeedbackMessage } from "../controller-app.js";
import { createResponsiveHelpers } from "../controller-responsive.js";
import { createResizeHandler } from "../controller-runtime.js";
import { applyStoredTheme } from "../controller-theme.js";
import { createActionHandlers } from "../controller-actions.js";
import { reducers } from "../store-logic.js";
import { api } from "../services/api.js";
import { api as versionedApiForControllerActions } from "../services/api.js?v=20260709-topicrace1";
import {
  buildCustomPaletteOption,
  CUSTOM_PALETTE_ID,
  DEFAULT_CUSTOM_PALETTE_HEX,
  DEFAULT_PALETTE_ID,
  getFaviconDataUrl,
  getCustomPaletteVars,
  buildCustomPaletteStylesheetCss,
  normalizeHexColor,
  parseHexColor,
  PALETTE_OPTIONS,
  isPaletteId,
  getActiveAccentColor
} from "../palettes.js";
import { buildPostRankingEntries, buildUserRankingEntries } from "../ui/ranking-data.js";
import { selectOnlineUsers } from "../ui/users.js";
import { createMessageItem, createTopicItem } from "../components.js";
import { bindTopbarActionEvents } from "../ui/topbar-action-events.js";
import { bindPageEvents } from "../ui/events.js";
import { shouldScrollChatToBottom, shouldSyncChatLayout } from "../ui/chat.js";
import { collectTopicNotifications, createNotificationStateUpdate, filterNotificationsForFriends, groupNotificationsForDisplay, createNotificationEmptyState } from "../ui/notifications.js";
import { censorProfanity, hasProfanity, setProfanityFilterEnabled, filterDisplayText } from "../profanity-filter.js";
import { isFriendOnline, splitFriendsByPresence } from "../ui/friend-requests.js";
import {
  formatJoinedDateParts,
  formatMessageTime,
  formatProfileJoinedDate
} from "../ui/date-utils.js";
import { renderTitles } from "../ui/titles.js";
import { selectUsersViewModel } from "../features/users/selectors.js";

const rootDir = path.dirname(fileURLToPath(new URL("../app.js", import.meta.url)));
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".html", ".css", ".md"]);
const IGNORED_DIRECTORIES = new Set([".git", ".playwright-mcp"]);
const MOJIBAKE_PATTERNS = [
  String.fromCharCode(0xc3),
  String.fromCharCode(0xc2),
  String.fromCodePoint(0xfffd),
  "Todav\u00c3\u00ada",
  "aqu\u00c3\u00ad",
  "An\u00c3\u00b3nimo",
  "preparaci\u00c3\u00b3n"
];

async function read(name) {
  return readFile(path.join(rootDir, name), "utf8");
}

function createMockDocumentWithFavicon(appliedStyle = new Map()) {
  const links = [];
  const faviconLink = { rel: "icon", href: "./favicon.svg" };
  const documentRef = {
    head: {
      appendChild(node) {
        links.push(node);
        return node;
      }
    },
    createElement(tagName) {
      const element = {
        tagName,
        id: "",
        rel: "",
        href: "",
        remove() {
          const index = links.indexOf(this);
          if (index >= 0) {
            links.splice(index, 1);
          }
        }
      };
      Object.defineProperty(element, "dataset", {
        value: {},
        enumerable: true
      });
      return element;
    },
    querySelector(selector) {
      if (selector === "link[rel*='icon']") {
        return faviconLink;
      }
      if (selector === "#customPaletteStylesheet") {
        return links.find((link) => link.id === "customPaletteStylesheet") || null;
      }
      return null;
    },
    documentElement: {
      dataset: {},
      style: {
        setProperty(name, value) {
          appliedStyle.set(name, value);
        },
        removeProperty(name) {
          appliedStyle.delete(name);
        }
      }
    }
  };
  documentRef.documentElement.ownerDocument = documentRef;
  return documentRef;
}

async function collectSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(fullPath)));
      continue;
    }

    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`fail - ${name}`);
    throw error;
  }
}

function createClassList() {
  const values = new Set();

  return {
    add(token) {
      values.add(token);
    },
    remove(token) {
      values.delete(token);
    },
    toggle(token, force) {
      if (force === undefined) {
        if (values.has(token)) {
          values.delete(token);
          return false;
        }

        values.add(token);
        return true;
      }

      if (force) {
        values.add(token);
        return true;
      }

      values.delete(token);
      return false;
    },
    contains(token) {
      return values.has(token);
    }
  };
}

async function withTempStore(fn, options = {}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "topykly-store-"));
  const dbPath = path.join(tempDir, "topykly.sqlite");
  const store = createBackendStore({ dbPath, ...options });

  try {
    return await fn(store);
  } finally {
    store.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function flushAsyncEvents() {
  await Promise.resolve();
  await Promise.resolve();
}

await (async () => {
  await test("buildUsers decorates seed users", () => {
    const users = buildUsers(initialUsers);

    assert.equal(users.length, initialUsers.length);
    assert.equal(users[0].online, true);
    assert.equal(users[6].online, true);
    assert.equal(users[0].initials, "CM");
  });

  await test("users view hides the current user while profile name is pending", () => {
    const state = {
      currentUserId: "u-current",
      activeConnectedUserId: null,
      viewer: { id: "u-current", type: "registered", profilePending: true },
      users: {
        allIds: ["u-current", "u-other"],
        byId: {
          "u-current": { id: "u-current", name: "Usuario", online: true, connectedOrder: 10 },
          "u-other": { id: "u-other", name: "Otro", online: true, connectedOrder: 1 }
        }
      }
    };

    assert.deepEqual(
      selectUsersViewModel(state).items.map((user) => user.id),
      ["u-other"]
    );

    state.viewer.profilePending = false;

    assert.deepEqual(
      selectUsersViewModel(state).items.map((user) => user.id),
      ["u-current", "u-other"]
    );
  });

  await test("selectOnlineUsers keeps backend rank order, filters offline users, with no cap", () => {
    const state = {
      currentUserId: "u-current",
      users: [
        { id: "u-b", name: "Bruno", online: true },
        { id: "u-current", name: "Zeta", online: true },
        { id: "u-a", name: "Alba", online: true },
        { id: "u-offline", name: "Carla", online: false },
        ...Array.from({ length: 12 }, (_, i) => ({
          id: `u-extra-${i}`,
          name: `Usuario ${String(i).padStart(2, "0")}`,
          online: true
        }))
      ]
    };

    const ordered = selectOnlineUsers(state);

    assert.equal(ordered.length, 15);
    assert.deepEqual(
      ordered.map((user) => user.id),
      state.users.filter((user) => user.online).map((user) => user.id)
    );
    assert.equal(ordered.some((user) => user.id === "u-offline"), false);
  });

  await test("buildTopics creates a topic per seed with rotating authors", () => {
    const users = buildUsers(initialUsers);
    const topics = buildTopics(topicSeedData, users, 1_700_000_000_000);

    assert.equal(topics.length, topicSeedData.length);
    assert.equal(topics[0].messages.length, 10);
    assert.equal(topics[0].messages[0].authorId, "u1");
    assert.equal(topics[0].messages[1].authorId, "u2");
    assert.equal(topics[0].messages[0].timestamp instanceof Date, true);
    assert.equal(typeof topics[0].authorId, "string");
    assert.equal(topics[0].messages[0].text.split("\n").length, 5);
    assert.equal(topics[0].messages[5].text.split("\n").length, 5);
    assert.equal(topics[0].messages[9].text.split("\n").length, 5);
  });

  await test("getSelectedTopic returns null when no topic is selected", () => {
    const users = buildUsers(initialUsers);
    const topics = buildTopics(topicSeedData, users, 1_700_000_000_000);

    assert.equal(getSelectedTopic(topics, "missing"), null);
    assert.equal(getSelectedTopic(topics, null), null);
  });

  await test("trimMessages preserves the root message and keeps the latest 29 replies", () => {
    const messages = Array.from({ length: 35 }, (_, index) =>
      createMessage("u1", `m${index}`, index, "user", Date.now(), index === 0)
    );
    const trimmed = trimMessages(messages, 30);

    assert.equal(trimmed.length, 30);
    assert.equal(trimmed[0].text, "m0");
    assert.equal(trimmed[1].text, "m6");
    assert.equal(trimmed[29].text, "m34");
  });

  await test("appendMessageToTopic trims overflow replies, preserves the root and refreshes the subtitle preview", () => {
    const baseTopic = {
      id: "topic-1",
      title: "Tema",
      subtitle: "Anterior",
      authorId: "u1",
      status: "active",
      visible: true,
      messages: Array.from({ length: 30 }, (_, index) =>
        createMessage("u1", `m${index}`, index, "user", Date.now(), index === 0)
      )
    };
    const nextMessage = createMessage(
      "u2",
      "Este es el nuevo mensaje que debe quedar visible en el preview.",
      0
    );

    const updatedTopic = appendMessageToTopic(baseTopic, nextMessage);

    assert.equal(updatedTopic.messages.length, 30);
    assert.equal(updatedTopic.messages[0].text, "m0");
    assert.equal(updatedTopic.messages[1].text, "m2");
    assert.equal(updatedTopic.messages[29].id, nextMessage.id);
    assert.equal(
      updatedTopic.subtitle,
      "Este es el nuevo mensaje que debe quedar visible en el preview."
    );
  });

  await test("prepareTopicFeed keeps 20 visible topics and caps the active feed at 40", () => {
    const topics = Array.from({ length: 45 }, (_, index) => ({
      id: `topic-${index + 1}`,
      title: `Tema ${index + 1}`,
      subtitle: `Resumen ${index + 1}`,
      authorId: "u1",
      status: "active",
      visible: true,
      messages: [createMessage("u1", `m${index + 1}`, index, "user", Date.now(), true)]
    }));

    const preparedTopics = prepareTopicFeed(topics);

    assert.equal(preparedTopics.length, TOPIC_ACTIVE_LIMIT);
    assert.equal(getVisibleTopics(preparedTopics).length, TOPIC_VISIBLE_LIMIT);
    assert.equal(preparedTopics[TOPIC_VISIBLE_LIMIT - 1].visible, true);
    assert.equal(preparedTopics[TOPIC_VISIBLE_LIMIT].visible, false);
    assert.equal(preparedTopics[TOPIC_ACTIVE_LIMIT - 1].id, "topic-40");
  });

  await test("insertTopicAtTop keeps new topics first and preserves the 40 active topic ceiling", () => {
    const topics = prepareTopicFeed(
      Array.from({ length: TOPIC_ACTIVE_LIMIT }, (_, index) => ({
        id: `topic-${index + 1}`,
        title: `Tema ${index + 1}`,
        subtitle: `Resumen ${index + 1}`,
        authorId: "u1",
        status: "active",
        visible: true,
        messages: [createMessage("u1", `m${index + 1}`, index, "user", Date.now(), true)]
      }))
    );
    const newTopic = createTopic("u1", "Tema nuevo", "Primer mensaje", 1_700_000_000_000);

    const nextTopics = insertTopicAtTop(topics, newTopic);

    assert.equal(nextTopics.length, TOPIC_ACTIVE_LIMIT);
    assert.equal(nextTopics[0].id, newTopic.id);
    assert.equal(nextTopics[TOPIC_VISIBLE_LIMIT - 1].visible, true);
    assert.equal(nextTopics[TOPIC_VISIBLE_LIMIT].visible, false);
    assert.equal(
      nextTopics.some((topic) => topic.id === "topic-40"),
      false
    );
  });

  await test("reviveTopicWithMessage brings hidden topics back to the top of the visible list", () => {
    const topics = prepareTopicFeed(
      Array.from({ length: 25 }, (_, index) => ({
        id: `topic-${index + 1}`,
        title: `Tema ${index + 1}`,
        subtitle: `Resumen ${index + 1}`,
        authorId: "u1",
        status: "active",
        visible: true,
        messages: [createMessage("u1", `m${index + 1}`, index, "user", Date.now(), true)]
      }))
    );
    const revivedTopicId = "topic-25";
    const nextMessage = createMessage("u2", "Comentario que revive el tema oculto.", 0);

    const nextTopics = reviveTopicWithMessage(topics, revivedTopicId, nextMessage);

    assert.equal(topics.find((topic) => topic.id === revivedTopicId)?.visible, false);
    assert.equal(nextTopics[0].id, revivedTopicId);
    assert.equal(nextTopics[0].visible, true);
    assert.equal(nextTopics[0].subtitle, "Comentario que revive el tema oculto.");
    assert.equal(nextTopics[TOPIC_VISIBLE_LIMIT].visible, false);
  });

  await test("addMessageToTopic reducer keeps topic updates centralized", () => {
    const state = {
      topics: prepareTopicFeed(
        Array.from({ length: 25 }, (_, index) => ({
          id: `topic-${index + 1}`,
          title: `Tema ${index + 1}`,
          subtitle: `Resumen ${index + 1}`,
          authorId: "u1",
          status: "active",
          visible: true,
          messages: Array.from({ length: index === 24 ? 30 : 1 }, (_, messageIndex) =>
            createMessage(
              "u1",
              `m${index + 1}-${messageIndex}`,
              messageIndex,
              "user",
              Date.now(),
              messageIndex === 0
            )
          )
        }))
      )
    };
    const nextMessage = createMessage(
      "u2",
      "Mensaje nuevo para sincronizar reducer y revivir el tema.",
      0
    );

    const nextState = reducers.addMessageToTopic(state, {
      topicId: "topic-25",
      message: nextMessage
    });

    assert.equal(nextState.topics[0].id, "topic-25");
    assert.equal(nextState.topics[0].visible, true);
    assert.equal(nextState.topics[0].messages.length, 30);
    assert.equal(nextState.topics[0].messages[0].text, "m25-0");
    assert.equal(nextState.topics[0].messages[1].text, "m25-2");
    assert.equal(nextState.topics[0].messages[29].id, nextMessage.id);
    assert.equal(
      nextState.topics[0].subtitle,
      "Mensaje nuevo para sincronizar reducer y revivir el tema."
    );
    assert.equal(getVisibleTopics(nextState.topics).length, TOPIC_VISIBLE_LIMIT);
  });

  await test("live topic sync hydrates remote activity in other topics without reordering the list", async () => {
    const users = buildUsers(initialUsers);
    const topics = buildTopics(topicSeedData, users, 1_700_000_000_000);
    const originalTopicOrder = topics.map((topic) => topic.id);
    const remoteMessage = createMessage(
      "u2",
      "Comentario remoto que debe aparecer sin refrescar la pagina.",
      0
    );
    const remoteTopics = reviveTopicWithMessage(topics, topics[1].id, remoteMessage);
    const state = {
      viewer: { id: "u1", type: "registered" },
      reportedTopicIds: [],
      reportedMessageIds: [],
      topics,
      users,
      currentUserId: "u1",
      selectedTopicId: topics[0].id
    };
    let renderCalls = 0;
    const sync = createLiveTopicSync({
      state,
      render: () => {
        renderCalls += 1;
      },
      intervalMs: 0,
      apiClient: {
        async refreshTopics(selectedTopicId) {
          return {
            viewer: state.viewer,
            users,
            topics: remoteTopics,
            selectedTopicId
          };
        }
      }
    });

    const refreshed = await sync.refreshNow();

    assert.equal(refreshed, true);
    assert.equal(renderCalls, 1);
    // The topics list keeps its on-screen order; only the topic's content
    // (message count, unread flag) updates from the background poll.
    assert.deepEqual(state.topics.map((topic) => topic.id), originalTopicOrder);
    const updatedTopic = state.topics.find((topic) => topic.id === topics[1].id);
    assert.equal(updatedTopic.messages.at(-1).id, remoteMessage.id);
    assert.equal(state.selectedTopicId, topics[0].id);
    assert.deepEqual(state.unreadTopicIds, [topics[1].id]);
  });

  await test("mergeLiveTopics reducer preserves topic order while hydrateFromBackend adopts backend order", () => {
    const users = buildUsers(initialUsers);
    const topics = buildTopics(topicSeedData, users, 1_700_000_000_000);
    const originalOrder = topics.map((topic) => topic.id);
    const remoteMessage = createMessage("u2", "Nuevo comentario remoto.", 0);
    const reorderedTopics = reviveTopicWithMessage(topics, topics[1].id, remoteMessage);
    assert.equal(reorderedTopics[0].id, topics[1].id, "sanity check: backend order bumps the active topic to the top");

    const baseState = {
      viewer: { id: "u1", type: "registered" },
      reportedTopicIds: [],
      reportedMessageIds: [],
      topics,
      users,
      currentUserId: "u1",
      selectedTopicId: topics[0].id
    };
    const payload = { viewer: baseState.viewer, users, topics: reorderedTopics, selectedTopicId: topics[0].id };

    const mergedState = reducers.mergeLiveTopics(baseState, payload);
    assert.deepEqual(mergedState.topics.map((topic) => topic.id), originalOrder);

    const hydratedState = reducers.hydrateFromBackend(baseState, payload);
    assert.deepEqual(hydratedState.topics.map((topic) => topic.id), reorderedTopics.map((topic) => topic.id));
  });

  await test("topic item marks only the unread count with palette accent", () => {
    const previousDocument = globalThis.document;
    const users = buildUsers(initialUsers);
    const ownMessage = createMessage("u1", "Propio", 0);
    const externalMessage = createMessage("u2", "Externo", 0);

    class MockNode {
      constructor(tagName) {
        this.tagName = tagName;
        this.children = [];
        this.dataset = {};
        this.attributes = new Map();
        this.className = "";
        this.textContent = "";
        this.classList = {
          add: (...tokens) => {
            this.className = [this.className, ...tokens].filter(Boolean).join(" ");
          }
        };
      }

      append(...nodes) {
        this.children.push(...nodes);
      }

      appendChild(node) {
        this.children.push(node);
        return node;
      }

      setAttribute(name, value) {
        this.attributes.set(name, value);
      }
    }

    try {
      globalThis.document = {
        createElement: (tagName) => new MockNode(tagName),
        createElementNS: (namespace, tagName) => new MockNode(tagName)
      };

      const readTopicItem = createTopicItem(
        {
          id: "topic-read",
          title: "Leido",
          authorId: "u1",
          messages: [ownMessage]
        },
        users,
        false,
        "u1",
        false
      );
      const unreadTopicItem = createTopicItem(
        {
          id: "topic-unread",
          title: "Nuevo",
          authorId: "u1",
          messages: [ownMessage, externalMessage]
        },
        users,
        false,
        "u1",
        true
      );
      const readMeta = readTopicItem.children[1].children[1];
      const unreadMeta = unreadTopicItem.children[1].children[1];
      const readCount = readMeta.children[0];
      const unreadCount = unreadMeta.children[0];
      const unreadUser = unreadMeta.children[2];

      assert.equal(readCount.textContent, "1");
      assert.equal(readCount.className.includes("topic-item__meta-count--unread"), false);
      assert.equal(unreadCount.textContent, "2");
      assert.equal(unreadCount.className.includes("topic-item__meta-count--unread"), true);
      assert.equal(unreadUser.textContent, "Nadia");
      assert.equal(unreadUser.className.includes("topic-item__meta-count--unread"), false);
      assert.equal(unreadMeta.dataset.lastAuthorId, "u2");
      assert.equal(unreadTopicItem.attributes.get("aria-pressed"), "false");
      assert.equal(unreadTopicItem.attributes.get("aria-current"), "false");

      const selectedTopicItem = createTopicItem(
        {
          id: "topic-selected",
          title: "Seleccionado",
          authorId: "u1",
          messages: [ownMessage]
        },
        users,
        true,
        "u1",
        false
      );

      assert.equal(selectedTopicItem.attributes.get("aria-pressed"), "true");
      assert.equal(selectedTopicItem.attributes.get("aria-current"), "true");
    } finally {
      globalThis.document = previousDocument;
    }
  });

  await test("date utils centralize UI date and time formatting", () => {
    const now = new Date(2026, 0, 2, 20, 0, 0);
    const timestamp = new Date(2026, 0, 2, 3, 4, 5);
    const yesterday = new Date(2026, 0, 1, 23, 50, 0);
    const olderDay = new Date(2025, 3, 13, 9, 15, 0);
    const joinedAt = new Date(2026, 0, 2, 12, 0, 0);

    assert.equal(
      formatMessageTime(timestamp, "es-AR", now),
      timestamp.toLocaleTimeString("es-AR", {
        hour: "2-digit",
        minute: "2-digit"
      })
    );
    assert.equal(formatMessageTime(yesterday, "es-AR", now), "Ene 1");
    assert.equal(formatMessageTime(olderDay, "es-AR", now), "Abr 13");
    assert.equal(formatProfileJoinedDate(joinedAt), "Registro: 02/01/26");
    assert.deepEqual(formatJoinedDateParts(joinedAt), ["02", "01", "2026"]);
    assert.equal(formatMessageTime(""), "");
    assert.equal(formatProfileJoinedDate(""), "Fecha de registro no disponible");
    assert.deepEqual(formatJoinedDateParts(""), []);
  });

  await test("collects mention and followed topic notifications from backend activity", () => {
    const users = buildUsers(initialUsers);
    const topics = buildTopics(topicSeedData, users, 1_700_000_000_000);
    const followedMessage = createMessage("u2", "Actualizacion para el tema seguido", 0);
    const mentionMessage = createMessage("u3", "Ping @cami para revisar esto", 0);
    const followedUpdate = reviveTopicWithMessage(topics, topics[1].id, followedMessage);
    const mentionUpdate = reviveTopicWithMessage(followedUpdate, topics[2].id, mentionMessage);
    const notifications = collectTopicNotifications(
      {
        viewer: { id: "u1", name: "Cami" },
        currentUserId: "u1",
        followedTopicIds: [topics[1].id],
        notifiedMessageIds: [],
        users,
        topics
      },
      {
        viewer: { id: "u1", name: "Cami" },
        users,
        topics: mentionUpdate,
        selectedTopicId: topics[0].id
      },
      1_700_000_001_000
    );

    assert.equal(notifications.length, 2);
    assert.deepEqual([...notifications.map((notification) => notification.kind)].sort(), [
      "followed-topic",
      "mention"
    ]);
    assert.equal(
      notifications.some(
        (notification) =>
          notification.kind === "followed-topic" && notification.topicId === topics[1].id
      ),
      true
    );
    assert.equal(
      notifications.some(
        (notification) => notification.kind === "mention" && notification.topicId === topics[2].id
      ),
      true
    );
  });

  await test("first post comment uses root post-like notification without duplicate", () => {
    const rootMessage = {
      ...createMessage("u1", "Post original", 0, "user", 1_700_000_000_000, true),
      id: "root-1",
      likes: 4
    };
    const nextRootMessage = { ...rootMessage, likes: 5 };
    const reply = {
      ...createMessage("u2", "Primer comentario", 0, "user", 1_700_000_001_000),
      id: "reply-1"
    };
    const previousTopic = {
      id: "topic-1",
      title: "Tema",
      authorId: "u1",
      messages: [rootMessage]
    };
    const nextTopic = {
      ...previousTopic,
      messages: [nextRootMessage, reply]
    };

    const notifications = collectTopicNotifications(
      {
        viewer: { id: "u1", name: "Cami" },
        currentUserId: "u1",
        followedTopicIds: [],
        notifiedMessageIds: [],
        users: [{ id: "u1", name: "Cami" }, { id: "u2", name: "Mora" }],
        topics: [previousTopic]
      },
      {
        viewer: { id: "u1", name: "Cami" },
        users: [{ id: "u1", name: "Cami" }, { id: "u2", name: "Mora" }],
        topics: [nextTopic],
        selectedTopicId: "topic-1"
      },
      1_700_000_002_000
    );

    assert.deepEqual(notifications.map((notification) => notification.kind), ["post-like"]);
  });

  await test("later post comment suppresses duplicate root post-like notification", () => {
    const rootMessage = {
      ...createMessage("u1", "Post original", 0, "user", 1_700_000_000_000, true),
      id: "root-1",
      likes: 5
    };
    const existingReply = {
      ...createMessage("u2", "Comentario previo", 0, "user", 1_700_000_001_000),
      id: "reply-1"
    };
    const nextRootMessage = { ...rootMessage, likes: 6 };
    const nextReply = {
      ...createMessage("u3", "Otro comentario", 0, "user", 1_700_000_002_000),
      id: "reply-2"
    };
    const previousTopic = {
      id: "topic-1",
      title: "Tema",
      authorId: "u1",
      messages: [rootMessage, existingReply]
    };
    const nextTopic = {
      ...previousTopic,
      messages: [nextRootMessage, existingReply, nextReply]
    };

    const notifications = collectTopicNotifications(
      {
        viewer: { id: "u1", name: "Cami" },
        currentUserId: "u1",
        followedTopicIds: [],
        notifiedMessageIds: [],
        users: [{ id: "u1", name: "Cami" }, { id: "u2", name: "Mora" }, { id: "u3", name: "Leo" }],
        topics: [previousTopic]
      },
      {
        viewer: { id: "u1", name: "Cami" },
        users: [{ id: "u1", name: "Cami" }, { id: "u2", name: "Mora" }, { id: "u3", name: "Leo" }],
        topics: [nextTopic],
        selectedTopicId: "topic-1"
      },
      1_700_000_003_000
    );

    assert.deepEqual(notifications.map((notification) => notification.kind), ["post-comment"]);
  });

  await test("groups repeated like notifications for the same target", () => {
    const grouped = groupNotificationsForDisplay([
      {
        id: "like-1",
        kind: "post-like",
        topicId: "topic-1",
        messageId: "like-message-1",
        targetMessageId: "message-1",
        actors: [{ id: "u2", name: "Mora" }],
        totalCount: 40,
        topicTitle: "Tema",
        createdAt: 10
      },
      {
        id: "like-2",
        kind: "post-like",
        topicId: "topic-1",
        messageId: "like-message-2",
        targetMessageId: "message-1",
        actors: [{ id: "u3", name: "Leo" }],
        totalCount: 40,
        topicTitle: "Tema",
        createdAt: 11
      },
      {
        id: "comment-1",
        kind: "post-comment",
        topicId: "topic-1",
        messageId: "comment-1",
        body: "Iara: respondi tu posteo",
        topicTitle: "Tema",
        createdAt: 9
      }
    ]);

    assert.equal(grouped.length, 2);
    assert.equal(grouped[0].kind, "post-like");
    assert.equal(grouped[0].notificationIds.length, 2);
    assert.equal(grouped[0].body, "Mora, Leo y 38 personas mas likearon tu posteo.");
  });
  await test("groups repeated post comments for the same post", () => {
    const grouped = groupNotificationsForDisplay([
      {
        id: "comment-1",
        kind: "post-comment",
        topicId: "topic-1",
        messageId: "comment-1",
        targetMessageId: "topic-1-root",
        actors: [{ id: "u2", name: "Iara" }],
        totalCount: 3,
        body: "Iara: primero",
        topicTitle: "Tema",
        createdAt: 12
      },
      {
        id: "comment-2",
        kind: "post-comment",
        topicId: "topic-1",
        messageId: "comment-2",
        targetMessageId: "topic-1-root",
        actors: [{ id: "u3", name: "Nico" }],
        totalCount: 3,
        body: "Nico: segundo",
        topicTitle: "Tema",
        createdAt: 13
      }
    ]);

    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].kind, "post-comment");
    assert.equal(grouped[0].notificationIds.length, 2);
    assert.equal(grouped[0].body, "Iara, Nico y 1 persona mas comentaron tu posteo.");
  });

  await test("notification empty state uses illustrated outlined block", async () => {
    const notificationSource = await read("ui/notifications.js");
    const styles = await read("styles.css");

    assert.ok(notificationSource.includes('document.createElement("section")'));
    assert.ok(notificationSource.includes("notification-panel__empty-mascot"));
    assert.ok(notificationSource.includes("Aun no hay comentarios"));
    assert.ok(styles.includes(".notification-panel__empty"));
    assert.ok(styles.includes("border: 1px dashed"));
    assert.ok(styles.includes("background: var(--bg)"));
    assert.ok(styles.includes(".notification-panel__empty-mascot"));
    assert.ok(styles.includes("place-items: center"));
    assert.ok(styles.includes("width: 76px"));
  });

  await test("notification empty state custom and brand/satirical mascots", () => {
    const previousDocument = globalThis.document;

    class MockNode {
      constructor(tagName) {
        this.tagName = tagName;
        this.children = [];
        this.dataset = {};
        this.attributes = new Map();
        this.className = "";
        this.textContent = "";
        this.innerHTML = "";
        this.style = {
          properties: new Map(),
          setProperty(name, value) {
            this.properties.set(name, value);
          },
          getPropertyValue(name) {
            return this.properties.get(name);
          }
        };
      }

      append(...nodes) {
        this.children.push(...nodes);
      }

      appendChild(node) {
        this.children.push(node);
        return node;
      }

      setAttribute(name, value) {
        this.attributes.set(name, value);
      }
    }

    globalThis.document = {
      createElement(tagName) {
        return new MockNode(tagName);
      }
    };

    try {
      // 1. Check brand/satirical mascot (Coca-Cola #F40009)
      const stateCoke = {
        theme: "light",
        paletteId: "custom",
        customPaletteHex: "#F40009"
      };
      const elementCoke = createNotificationEmptyState(stateCoke);
      const mascotCoke = elementCoke.children[0];
      const titleCoke = elementCoke.children[1];
      assert.equal(titleCoke.textContent, "Aun no hay comentarios");
      assert.ok(mascotCoke.innerHTML.includes("fill=\"#F40009\""));

      // 2. Check brand/satirical mascot (Pepsi #003087)
      const statePepsi = {
        theme: "dark",
        paletteId: "custom",
        customPaletteHex: "#003087"
      };
      const elementPepsi = createNotificationEmptyState(statePepsi);
      const titlePepsi = elementPepsi.children[1];
      assert.equal(titlePepsi.textContent, "Aun no hay comentarios");

      // 3. Check brand/satirical mascot with slightly off brand color (proximity matching, e.g. #F30008, close to Coke)
      const stateCloseCoke = {
        theme: "light",
        paletteId: "custom",
        customPaletteHex: "#F30008"
      };
      const elementCloseCoke = createNotificationEmptyState(stateCloseCoke);
      const titleCloseCoke = elementCloseCoke.children[1];
      assert.equal(titleCloseCoke.textContent, "Aun no hay comentarios");

      // 4. Check procedural/custom mascot for normal color (e.g. #B25B33)
      const stateNormal = {
        theme: "light",
        paletteId: "custom",
        customPaletteHex: "#B25B33"
      };
      const elementNormal = createNotificationEmptyState(stateNormal);
      const mascotNormal = elementNormal.children[0];
      const titleNormal = elementNormal.children[1];
      assert.equal(titleNormal.textContent, "Aun no hay comentarios");
      assert.equal(mascotNormal.style.getPropertyValue("--accent"), getActiveAccentColor(stateNormal.theme, stateNormal.paletteId, stateNormal.customPaletteHex));
    } finally {
      globalThis.document = previousDocument;
    }
  });

  await test("notification state update deduplicates toasts and remembers message ids", () => {
    const notification = {
      id: "toast-mention-message-1",
      kind: "mention",
      topicId: "topic-1",
      messageId: "message-1",
      title: "Te mencionaron",
      body: "Nadia: hola",
      topicTitle: "Tema"
    };
    const update = createNotificationStateUpdate(
      {
        notifications: [notification],
        notifiedMessageIds: []
      },
      [notification]
    );

    assert.equal(update.notifications.length, 1);
    assert.deepEqual(update.notifiedMessageIds, ["message-1"]);
  });
  await test("hydrate marks unread updates even for the open topic", () => {
    const users = buildUsers(initialUsers);
    const topics = buildTopics(topicSeedData, users, 1_700_000_000_000);
    const openTopicMessage = createMessage("u2", "Nuevo en el tema abierto", 0);
    const otherTopicMessage = createMessage("u2", "Nuevo en otro tema", 0);
    const withOpenTopicUpdate = reviveTopicWithMessage(topics, topics[0].id, openTopicMessage);
    const withOtherTopicUpdate = reviveTopicWithMessage(topics, topics[1].id, otherTopicMessage);
    const baseState = {
      viewer: { id: "u1", type: "registered" },
      currentUserId: "u1",
      selectedTopicId: topics[0].id,
      activeConnectedUserId: null,
      publicProfileUserId: null,
      reportedTopicIds: [],
      reportedMessageIds: [],
      unreadTopicIds: [],
      rankings: null,
      topics,
      users
    };

    const openTopicState = reducers.hydrateFromBackend(baseState, {
      viewer: baseState.viewer,
      selectedTopicId: topics[0].id,
      users,
      topics: withOpenTopicUpdate,
      reportedTopicIds: [],
      reportedMessageIds: []
    });
    const otherTopicState = reducers.hydrateFromBackend(baseState, {
      viewer: baseState.viewer,
      selectedTopicId: topics[0].id,
      users,
      topics: withOtherTopicUpdate,
      reportedTopicIds: [],
      reportedMessageIds: []
    });

    assert.deepEqual(openTopicState.unreadTopicIds, [topics[0].id]);
    assert.deepEqual(otherTopicState.unreadTopicIds, [topics[1].id]);
  });
  await test("hydrate does not mark current-user updates as unread", () => {
    const users = buildUsers(initialUsers);
    const topics = buildTopics(topicSeedData, users, 1_700_000_000_000);
    const sameAuthorMessage = createMessage("u1", "Nuevo desde otra ventana del mismo usuario", 0);
    const withOtherTopicUpdate = reviveTopicWithMessage(topics, topics[1].id, sameAuthorMessage);
    const nextState = reducers.hydrateFromBackend(
      {
        viewer: { id: "u1", type: "registered" },
        currentUserId: "u1",
        selectedTopicId: topics[0].id,
        activeConnectedUserId: null,
        publicProfileUserId: null,
        reportedTopicIds: [],
        reportedMessageIds: [],
        unreadTopicIds: [],
        rankings: null,
        topics,
        users
      },
      {
        viewer: { id: "u1", type: "registered" },
        selectedTopicId: topics[0].id,
        users,
        topics: withOtherTopicUpdate,
        reportedTopicIds: [],
        reportedMessageIds: []
      }
    );

    assert.deepEqual(nextState.unreadTopicIds, []);
  });
  await test("hydrate preserves a newer local topic selection over stale payloads", () => {
    const users = buildUsers(initialUsers);
    const topics = buildTopics(topicSeedData, users, 1_700_000_000_000);
    const nextState = reducers.hydrateFromBackend(
      {
        viewer: { id: "u1", type: "registered" },
        currentUserId: "u1",
        selectedTopicId: topics[1].id,
        activeConnectedUserId: null,
        publicProfileUserId: null,
        reportedTopicIds: [],
        reportedMessageIds: [],
        unreadTopicIds: [],
        rankings: null,
        topics,
        users
      },
      {
        viewer: { id: "u1", type: "registered" },
        selectedTopicId: topics[0].id,
        users,
        topics,
        reportedTopicIds: [],
        reportedMessageIds: []
      }
    );

    assert.equal(nextState.selectedTopicId, topics[1].id);
  });
  await test("markTopicRead clears the selected topic after manual refresh", () => {
    const nextState = reducers.markTopicRead(
      {
        unreadTopicIds: ["topic-1", "topic-2"]
      },
      "topic-1"
    );

    assert.deepEqual(nextState.unreadTopicIds, ["topic-2"]);
  });
  await test("selecting a topic clears its unread marker", () => {
    const nextState = reducers.setSelectedTopic(
      {
        selectedTopicId: "topic-1",
        unreadTopicIds: ["topic-1", "topic-2"],
        activeConnectedUserId: "u2"
      },
      "topic-2"
    );

    assert.deepEqual(nextState.unreadTopicIds, ["topic-1"]);
    assert.equal(nextState.selectedTopicId, "topic-2");
    assert.equal(nextState.activeConnectedUserId, null);
  });
  await test("applyMessageReaction increments the visible message like optimistically", () => {
    const message = createMessage("u1", "Mensaje votable", 0);
    const state = {
      topics: [
        {
          id: "topic-like",
          title: "Tema con like",
          subtitle: "Mensaje votable",
          authorId: "u1",
          status: "active",
          visible: true,
          messages: [message]
        }
      ]
    };

    const nextState = reducers.applyMessageReaction(state, {
      messageId: message.id,
      reactionType: "like"
    });
    const nextMessage = nextState.topics[0].messages[0];

    assert.equal(nextMessage.likes, 1);
    assert.equal(nextMessage.likedByViewer, true);
    assert.equal(message.likes, 0);
    assert.equal(message.likedByViewer, undefined);
  });

  await test("setFriendRequestsTab reducer changes friendRequestsTab key in state", () => {
    const baseState = { friendRequestsTab: "incoming" };
    const nextState = reducers.setFriendRequestsTab(baseState, "outgoing");
    assert.equal(nextState.friendRequestsTab, "outgoing");
    assert.equal(baseState.friendRequestsTab, "incoming");
  });

  await test("increaseFriendRequestsLimit and resetFriendRequestsLimits reducers manage active limits", () => {
    const baseState = {
      friendRequestsLimits: {
        incoming: 10,
        outgoing: 10
      }
    };
    const nextState = reducers.increaseFriendRequestsLimit(baseState, "incoming");
    assert.equal(nextState.friendRequestsLimits.incoming, 20);
    assert.equal(nextState.friendRequestsLimits.outgoing, 10);

    const resetState = reducers.resetFriendRequestsLimits(nextState);
    assert.equal(resetState.friendRequestsLimits.incoming, 10);
    assert.equal(resetState.friendRequestsLimits.outgoing, 10);
  });

  await test("splitFriendsByPresence separates online and offline friends with users fallback", () => {
    const state = {
      users: [
        { id: "u1", online: true },
        { id: "u2", online: false }
      ]
    };
    const friends = [
      { id: "u1", name: "Ana" },
      { id: "u2", name: "Beto" },
      { id: "u3", name: "Caro", online: true },
      { id: "u4", name: "Dani", online: false },
      { id: "u5", name: "Emi" }
    ];

    assert.equal(isFriendOnline(friends[0], state), true);
    assert.equal(isFriendOnline(friends[2], state), true);
    assert.equal(isFriendOnline(friends[4], state), false);

    const { online, offline } = splitFriendsByPresence(friends, state);
    assert.deepEqual(online.map((user) => user.id), ["u1", "u3"]);
    assert.deepEqual(offline.map((user) => user.id), ["u2", "u4", "u5"]);
  });

  await test("createTopic builds a new topic from title and first message", () => {
    const topic = createTopic(
      "u1",
      "  Nuevo tema  ",
      "  Primer mensaje para abrir el hilo.  ",
      1_700_000_000_000
    );

    assert.match(topic.id, /^topic-/);
    assert.equal(topic.title, "Nuevo tema");
    assert.equal(topic.subtitle, "Primer mensaje para abrir el hilo.");
    assert.equal(topic.authorId, "u1");
    assert.equal(topic.visible, true);
    assert.equal(topic.status, "active");
    assert.equal(topic.messages.length, 1);
    assert.equal(topic.messages[0].authorId, "u1");
    assert.equal(topic.messages[0].text, "Primer mensaje para abrir el hilo.");
    assert.equal(topic.messages[0].isRoot, true);
    assert.equal(summarizeTopicMessage("a".repeat(110)).endsWith("..."), true);
  });

  await test("backend can start without demo topics for real users", async () => {
    await withTempStore(
      (store) => {
        const payload = store.bootstrap({ sessionId: "session-empty-demo" });
        assert.equal(payload.topics.length, 0);
        assert.equal(payload.users.length, 0);
        assert.equal(payload.viewer.type, "guest");
      },
      { seedDemoData: false }
    );
    assert.equal(shouldSeedDemoData({ TOPYKLY_SEED_DEMO_DATA: "false" }), false);
    assert.equal(shouldSeedDemoData({ TOPYKLY_SEED_DEMO_DATA: "true" }, false), true);
  });
  await test("backend purges existing demo seed data when demo seeding is disabled", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "topykly-demo-purge-"));
    const dbPath = path.join(tempDir, "topykly.sqlite");
    let store = createBackendStore({ dbPath, seedDemoData: true });

    try {
      store.registerWithPassword({
        sessionId: "session-real-user",
        email: "real-user@example.com",
        password: "password-segura",
        nickname: "Real_user"
      });
      const created = store.createTopic({
        sessionId: "session-real-user",
        title: "Tema real persistente",
        text: "Contenido creado por una cuenta real"
      });
      const realTopicId = created.selectedTopicId;
      store.close();

      store = createBackendStore({ dbPath, seedDemoData: false });
      const payload = store.bootstrap({
        sessionId: "session-real-user",
        authMode: "registered"
      });

      assert.equal(
        payload.topics.some((topic) => topic.id === "topic-1"),
        false
      );
      assert.equal(
        payload.users.some((user) => user.id === "u1"),
        false
      );
      assert.equal(
        payload.topics.some((topic) => topic.id === realTopicId),
        true
      );
      assert.equal(payload.viewer.nickname, "Real_user");
    } finally {
      store.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
  await test("backend bootstrap returns a guest viewer plus 40 active topics with 20 visible", async () => {
    await withTempStore((store) => {
      const payload = store.bootstrap({
        sessionId: "session-bootstrap",
        authMode: "guest"
      });

      assert.equal(payload.viewer.type, "guest");
      assert.match(payload.viewer.displayName, /^\*topy\d{2}$/);
      assert.equal(payload.topics.length, TOPIC_ACTIVE_LIMIT);
      assert.equal(payload.topics.filter((topic) => topic.visible).length, TOPIC_VISIBLE_LIMIT);
      assert.equal(
        payload.users.some((user) => user.id === payload.viewer.id),
        false
      );
    });
  });

  await test("backend anonymous reads do not persist guest users or sessions", async () => {
    await withTempStore((store) => {
      for (let index = 0; index < 25; index += 1) {
        store.bootstrap({
          sessionId: `session-bot-read-${index}`,
          authMode: "guest",
          ipAddress: "203.0.113.44"
        });
      }

      const diagnostics = store.getDiagnostics();

      assert.equal(diagnostics.users, initialUsers.length);
      assert.equal(diagnostics.sessions, 0);
    });
  });

  await test("backend requires registered users to create topics and comments", async () => {
    await withTempStore((store) => {
      const initial = store.bootstrap({
        sessionId: "session-guest-participates",
        authMode: "guest"
      });
      const topicId = initial.topics[0].id;

      assert.throws(
        () =>
          store.createTopic({
            sessionId: "session-guest-participates",
            authMode: "guest",
            title: "Tema invitado",
            text: "No deberia publicarse."
          }),
        (error) => error?.code === "LOGIN_REQUIRED"
      );
      assert.throws(
        () =>
          store.addMessage(topicId, {
            sessionId: "session-guest-participates",
            authMode: "guest",
            text: "Comentario invitado bloqueado"
          }),
        (error) => error?.code === "LOGIN_REQUIRED"
      );

      const diagnostics = store.getDiagnostics();
      assert.equal(diagnostics.users, initialUsers.length);
      assert.equal(diagnostics.sessions, 0);
    });
  });

  await test("backend lets the first real user create the first topic without seeds", async () => {
    await withTempStore(
      (store) => {
        const registered = store.registerWithPassword({
          sessionId: "session-first-real-user",
          email: "first-real@example.com",
          password: "password-segura",
          nickname: "First_real"
        });
        assert.equal(registered.topics.length, 0);
        assert.equal(
          registered.users.some((user) => user.nickname === "First_real"),
          true
        );

        const created = store.createTopic({
          sessionId: "session-first-real-user",
          title: "Primer tema real",
          text: "Primer posteo creado por una cuenta real."
        });
        const topic = created.topics.find((entry) => entry.id === created.selectedTopicId);

        assert.ok(topic);
        assert.equal(topic.title, "Primer tema real");
        assert.equal(topic.messages.length, 1);
        assert.equal(topic.messages[0].authorId, created.viewer.id);
        assert.equal(created.rankings.global.posts.comments[0].id, topic.id);
        assert.equal(created.rankings.global.users.comments[0].title, "First_real");
      },
      { seedDemoData: false }
    );
  });

  await test("backend caps materialized guest storage for rotating report sessions", async () => {
    await withTempStore((store) => {
      const topicId = store.createTopic({
        sessionId: "session-guest-cap-topic",
        authMode: "registered",
        title: "Tema para reportes invitados",
        text: "Raiz para probar sesiones invitadas."
      }).selectedTopicId;

      for (let index = 0; index < 40; index += 1) {
        store.reportEntity("topic", topicId, {
          sessionId: `session-rotating-guest-${index}`,
          authMode: "guest",
          ipAddress: "203.0.113.77",
          reason: `Reporte invitado ${index}`
        });
      }

      const diagnostics = store.getDiagnostics();

      assert.equal(diagnostics.users, initialUsers.length + 1);
      assert.equal(diagnostics.sessions <= 1 + 25, true);
    });
  });
  await test("backend scheduled cleanup removes inactive guest state", async () => {
    await withTempStore((store) => {
      const topicId = store.login({
        sessionId: "session-cleanup-registered"
      }).topics[0].id;
      store.reportEntity("topic", topicId, {
        sessionId: "session-cleanup-guest",
        authMode: "guest",
        reason: "Reporte temporal invitado",
        ipAddress: "203.0.113.88"
      });

      assert.equal(store.getDiagnostics().sessions, 2);

      const result = store.cleanupInactiveGuests({
        nowMs: Date.now() + 8 * 24 * 60 * 60_000
      });

      assert.equal(result.deletedSessions, 1);
      assert.equal(result.deletedGuestIpRateLimits, 0);
      assert.equal(store.getDiagnostics().sessions, 1);
    });
  });
  await test("backend initializes SQLite indexes for operational queries", async () => {
    await withTempStore((store) => {
      const db = new DatabaseSync(store.dbPath);
      const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all();
      db.close();
      const indexNames = new Set(rows.map((row) => row.name));

      [
        "users_auth_identity_idx",
        "users_email_idx",
        "users_verified_email_idx",
        "users_nickname_norm_idx",
        "users_password_email_idx",
        "users_frontend_active_idx",
        "users_pending_avatar_idx",
        "users_avatar_url_idx",
        "users_avatar_pending_url_idx",
        "sessions_guest_cleanup_idx",
        "sessions_guest_ip_idx",
        "topics_status_rank_idx",
        "topics_status_activity_idx",
        "messages_topic_id_idx",
        "messages_topic_reply_trim_idx",
        "message_likes_user_idx",
        "message_dislikes_user_idx",
        "reports_session_open_idx",
        "reports_user_open_idx",
        "reports_entity_open_idx",
        "reports_status_created_idx",
        "guest_ip_rate_limits_updated_idx",
        "moderation_actions_target_idx",
        "auth_email_challenges_email_idx",
        "auth_email_challenges_expiry_idx"
      ].forEach((indexName) => {
        assert.equal(indexNames.has(indexName), true, indexName);
      });
    });
  });
  await test("backend diagnostics report whether SQLite storage was explicitly configured", async () => {
    assert.deepEqual(resolveDbConfig(null, {}), {
      dbPath: path.join(rootDir, ".data", "topykly.sqlite"),
      dbPathSource: "default",
      storageConfigured: false,
      storageWarning:
        "TOPYKLY_DB_PATH no esta configurado; en Render usa un Persistent Disk para no perder datos."
    });

    assert.deepEqual(resolveDbConfig(null, { TOPYKLY_DB_PATH: "/var/data/topykly.sqlite" }), {
      dbPath: "/var/data/topykly.sqlite",
      dbPathSource: "TOPYKLY_DB_PATH",
      storageConfigured: true,
      storageWarning: null
    });

    await withTempStore((store) => {
      const diagnostics = store.getDiagnostics();

      assert.equal(diagnostics.dbPathSource, "explicit");
      assert.equal(diagnostics.storageConfigured, true);
      assert.equal(diagnostics.storageWarning, null);
    });
  });
  await test("sqlite backup script creates a usable database snapshot", async () => {
    await withTempStore(async (store) => {
      const backupDir = path.join(path.dirname(store.dbPath), "manual-backups");
      const config = resolveBackupConfig({ dbPath: store.dbPath, backupDir, env: {} });
      const result = backupSqliteDatabase({
        dbPath: store.dbPath,
        backupDir,
        now: new Date("2026-01-02T03:04:05.006Z"),
        env: {}
      });
      const backupBytes = await readFile(result.backupPath);
      const backupStore = createBackendStore({ dbPath: result.backupPath });

      try {
        assert.deepEqual(config, {
          dbPath: store.dbPath,
          backupDir
        });
        assert.equal(
          result.backupPath,
          path.join(backupDir, "topykly-2026-01-02T03-04-05-006Z.sqlite")
        );
        assert.equal(backupBytes.subarray(0, 15).toString("utf8"), "SQLite format 3");
        assert.equal(backupStore.getDiagnostics().users, initialUsers.length);
      } finally {
        backupStore.close();
      }
    });
  });
  await test("backend registers and logs in password users with nickname", async () => {
    await withTempStore(
      (store) => {
        const registered = store.registerWithPassword({
          sessionId: "session-password-register",
          email: "Clave@Example.com",
          password: "password-segura",
          nickname: "Clave_user",
          rotateSession: true
        });

        assert.notEqual(registered.sessionId, "session-password-register");
        assert.equal(registered.viewer.type, "registered");
        assert.equal(registered.viewer.email, "clave@example.com");
        assert.equal(registered.viewer.nickname, "Clave_user");
        assert.equal(registered.viewer.displayName, "Clave_user");
        assert.equal(registered.viewer.profilePending, false);
        assert.equal(
          store.refresh({ sessionId: "session-password-register" }).viewer.type,
          "guest"
        );
        assert.throws(
          () =>
            store.registerWithPassword({
              sessionId: "session-password-register-duplicate-email",
              email: "clave@example.com",
              password: "password-segura",
              nickname: "otro_user"
            }),
          (error) => error.code === "EMAIL_TAKEN"
        );
        assert.throws(
          () =>
            store.registerWithPassword({
              sessionId: "session-password-register-duplicate-nickname",
              email: "otro@example.com",
              password: "password-segura",
              nickname: "CLAVE_USER"
            }),
          (error) => error.code === "NICKNAME_TAKEN"
        );
        const compactName = store.registerWithPassword({
          sessionId: "session-password-register-compact-name",
          email: "compact-name@example.com",
          password: "password-segura",
          nickname: "COCOMORA"
        });
        const underscoredName = store.registerWithPassword({
          sessionId: "session-password-register-underscored-name",
          email: "underscored-name@example.com",
          password: "password-segura",
          nickname: "coco_MORA"
        });
        assert.equal(compactName.viewer.nickname, "Cocomora");
        assert.equal(underscoredName.viewer.nickname, "Coco_mora");
        assert.throws(
          () =>
            store.registerWithPassword({
              sessionId: "session-password-register-spaced-name",
              email: "spaced-name@example.com",
              password: "password-segura",
              nickname: "Coco Mora"
            }),
          (error) => error.code === "VALIDATION_ERROR"
        );
        assert.throws(
          () =>
            store.loginWithPassword({
              sessionId: "session-password-wrong",
              email: "clave@example.com",
              password: "incorrecta"
            }),
          (error) => error.code === "INVALID_CREDENTIALS"
        );

        const loggedIn = store.loginWithPassword({
          sessionId: "session-password-login",
          email: "clave@example.com",
          password: "password-segura",
          rotateSession: true
        });
        assert.notEqual(loggedIn.sessionId, "session-password-login");
        assert.equal(loggedIn.viewer.id, registered.viewer.id);
        assert.equal(loggedIn.viewer.nickname, "Clave_user");
        assert.equal(store.refresh({ sessionId: "session-password-login" }).viewer.type, "guest");
      },
      { seedDemoData: false }
    );
  });
  await test("backend confirms password registration with a one-time email code", async () => {
    await withTempStore(
      (store) => {
        assert.throws(
          () => store.createEmailAuthChallenge({
            email: "code@example.com",
            nickname: "Code_user",
            age: MINIMUM_REGISTRATION_AGE - 1,
            acceptedTerms: true,
            termsVersion: TERMS_VERSION,
            password: "password-segura"
          }),
          (error) => error.code === "INVALID_AGE"
        );
        assert.throws(
          () => store.createEmailAuthChallenge({
            email: "code@example.com",
            nickname: "Code_user",
            age: MINIMUM_REGISTRATION_AGE,
            acceptedTerms: false,
            termsVersion: TERMS_VERSION,
            password: "password-segura"
          }),
          (error) => error.code === "TERMS_REQUIRED"
        );
        assert.throws(
          () => store.createEmailAuthChallenge({
            email: "code@example.com",
            nickname: "Code_user",
            age: MINIMUM_REGISTRATION_AGE,
            acceptedTerms: true,
            termsVersion: TERMS_VERSION,
            password: "short"
          }),
          (error) => error.code === "VALIDATION_ERROR"
        );

        const registration = store.createEmailAuthChallenge({
          email: "Code@Example.com",
          nickname: "Code_user",
          age: MINIMUM_REGISTRATION_AGE,
          acceptedTerms: true,
          termsVersion: TERMS_VERSION,
          password: "password-segura",
          nowMs: Date.UTC(2026, 6, 10, 12)
        });
        assert.match(registration.code, /^\d{6}$/);
        assert.throws(
          () => store.verifyEmailAuthChallenge({
            challengeId: registration.challengeId,
            code: registration.code === "000000" ? "111111" : "000000",
            sessionId: "session-email-code-wrong",
            nowMs: Date.UTC(2026, 6, 10, 12, 1)
          }),
          (error) => error.code === "INVALID_EMAIL_CODE"
        );

        const registered = store.verifyEmailAuthChallenge({
          challengeId: registration.challengeId,
          code: registration.code,
          sessionId: "session-email-code-register",
          rotateSession: true,
          nowMs: Date.UTC(2026, 6, 10, 12, 2)
        });
        assert.equal(registered.viewer.type, "registered");
        assert.equal(registered.viewer.email, "code@example.com");
        assert.equal(registered.viewer.nickname, "Code_user");
        assert.throws(
          () => store.verifyEmailAuthChallenge({
            challengeId: registration.challengeId,
            code: registration.code,
            sessionId: "session-email-code-reuse",
            nowMs: Date.UTC(2026, 6, 10, 12, 3)
          }),
          (error) => error.code === "INVALID_EMAIL_CODE"
        );

        const loggedIn = store.loginWithPassword({
          sessionId: "session-email-code-login",
          email: "code@example.com",
          password: "password-segura",
          rotateSession: true
        });
        assert.equal(loggedIn.viewer.id, registered.viewer.id);
      },
      { seedDemoData: false }
    );
  });
  await test("backend login rotates the session and logout clears the rotated session", async () => {
    await withTempStore((store) => {
      const initialPayload = store.bootstrap({
        sessionId: "session-auth-flow"
      });
      const selectedTopicId = initialPayload.topics[0].id;

      assert.equal(initialPayload.viewer.type, "guest");

      const loggedIn = store.login({
        sessionId: "session-auth-flow",
        selectedTopicId,
        rotateSession: true
      });

      assert.notEqual(loggedIn.sessionId, "session-auth-flow");
      assert.equal(loggedIn.viewer.type, "registered");
      assert.equal(loggedIn.viewer.id, "u1");
      assert.equal(loggedIn.selectedTopicId, selectedTopicId);

      const oldSessionRefresh = store.refresh({
        sessionId: "session-auth-flow"
      });
      assert.equal(oldSessionRefresh.viewer.type, "guest");

      const refreshedRegistered = store.refresh({
        sessionId: loggedIn.sessionId
      });

      assert.equal(refreshedRegistered.viewer.type, "registered");
      assert.equal(refreshedRegistered.viewer.id, "u1");

      const loggedOut = store.logout({
        sessionId: loggedIn.sessionId,
        selectedTopicId
      });
      assert.equal(loggedOut.viewer.type, "guest");
      assert.notEqual(loggedOut.viewer.id, "u1");
      assert.equal(loggedOut.selectedTopicId, selectedTopicId);

      const refreshedGuest = store.refresh({
        sessionId: loggedIn.sessionId
      });

      assert.equal(refreshedGuest.viewer.type, "guest");
      assert.equal(refreshedGuest.viewer.id, loggedOut.viewer.id);
    });
  });


  await test("backend persists friend requests and accepted friendships", async () => {
    await withTempStore((store) => {
      const firstUser = store.login({ sessionId: "session-friend-u1", userId: "u1" });
      const secondUser = store.login({ sessionId: "session-friend-u2", userId: "u2" });

      const requested = store.sendFriendRequest("u2", {
        sessionId: firstUser.sessionId,
        selectedTopicId: firstUser.topics[0].id
      });

      assert.equal(requested.friendships.outgoing.length, 1);
      assert.equal(requested.friendships.outgoing[0].id, "u2");
      assert.equal(
        requested.users.find((user) => user.id === "u2")?.friendshipStatus,
        "outgoing-request"
      );

      const pendingForSecondUser = store.refresh({ sessionId: secondUser.sessionId });
      assert.equal(pendingForSecondUser.friendships.incoming.length, 1);
      assert.equal(pendingForSecondUser.friendships.incoming[0].id, "u1");
      assert.equal(
        pendingForSecondUser.users.find((user) => user.id === "u1")?.friendshipStatus,
        "incoming-request"
      );

      const accepted = store.acceptFriendRequest("u1", {
        sessionId: secondUser.sessionId
      });

      assert.equal(accepted.friendships.incoming.length, 0);
      assert.equal(accepted.friendships.friends[0].id, "u1");
      assert.equal(accepted.friendships.friends[0].online, true);
      assert.equal(
        accepted.users.find((user) => user.id === "u1")?.friendshipStatus,
        "friend"
      );

      const refreshedFirstUser = store.refresh({ sessionId: firstUser.sessionId });
      assert.equal(refreshedFirstUser.friendships.friends[0].id, "u2");
      assert.equal(
        refreshedFirstUser.users.find((user) => user.id === "u2")?.friendshipStatus,
        "friend"
      );
    });
  });
  await test("backend loginWithIdentity creates and reuses a registered user from the provider identity", async () => {
    await withTempStore((store) => {
      const initialPayload = store.loginWithIdentity({
        sessionId: "session-oidc-1",
        sourceSessionId: "session-oidc-source",
        authProvider: "https://accounts.example.com",
        authSubject: "subject-123",
        email: "test@example.com",
        emailVerified: true,
        displayName: "Test User",
        avatarUrl: "https://cdn.example.com/avatar.png"
      });

      assert.equal(initialPayload.viewer.type, "registered");
      assert.notEqual(initialPayload.viewer.id, "u1");
      assert.equal(initialPayload.viewer.email, "test@example.com");
      assert.equal(initialPayload.viewer.authProvider, "https://accounts.example.com");
      assert.equal(initialPayload.viewer.displayName, "Usuario");
      assert.equal(initialPayload.viewer.avatarUrl, null);
      assert.equal(initialPayload.viewer.profilePending, true);
      assert.equal(initialPayload.viewer.profileSuggestedName, "Test User");
      assert.equal(
        initialPayload.viewer.profileSuggestedAvatarUrl,
        "https://cdn.example.com/avatar.png"
      );
      assert.throws(
        () =>
          store.createTopic({
            sessionId: "session-oidc-1",
            title: "Tema OAuth",
            text: "Mensaje"
          }),
        /Completa tu perfil/
      );

      assert.throws(
        () =>
          store.updateProfile({
            sessionId: "session-oidc-1",
            displayName: "Abril",
            username: "abril_uno",
            age: MINIMUM_REGISTRATION_AGE
          }),
        (error) => error.code === "TERMS_REQUIRED"
      );

      const completedPayload = store.updateProfile({
        sessionId: "session-oidc-1",
        displayName: "Abril",
        username: "abril_uno",
        age: MINIMUM_REGISTRATION_AGE,
        acceptedTerms: true,
        termsVersion: TERMS_VERSION,
        avatarDataUrl: "data:image/png;base64,aGVsbG8="
      });
      assert.equal(completedPayload.viewer.profilePending, false);
      assert.equal(completedPayload.viewer.displayName, "Abril");
      assert.equal(completedPayload.viewer.nickname, "Abril_uno");
      assert.equal(completedPayload.viewer.avatarUrl, null);
      assert.match(completedPayload.viewer.avatarPendingUrl, /^\/avatars\/[a-f0-9-]+\.png$/);
      assert.doesNotMatch(completedPayload.viewer.avatarPendingUrl, /^data:/);
      assert.equal(completedPayload.viewer.avatarReviewStatus, "pending");

      assert.throws(
        () =>
          store.updateProfile({
            sessionId: "session-oidc-1",
            displayName: "Abril",
            username: "otro_username"
          }),
        (error) => error.code === "USERNAME_IMMUTABLE"
      );

      const duplicateNameLogin = store.loginWithIdentity({
        sessionId: "session-oidc-duplicate-name",
        sourceSessionId: "session-oidc-duplicate-name-source",
        authProvider: "https://accounts.example.com",
        authSubject: "subject-duplicate-name",
        email: "duplicate-name@example.com",
        emailVerified: true,
        displayName: "Abril"
      });
      assert.throws(
        () =>
          store.updateProfile({
            sessionId: "session-oidc-duplicate-name",
            displayName: "Abril",
            username: "ABRIL_UNO"
          }),
        (error) => error.code === "NICKNAME_TAKEN"
      );
      const duplicateDisplayName = store.updateProfile({
        sessionId: "session-oidc-duplicate-name",
        displayName: "Abril",
        username: "abril_dos",
        age: MINIMUM_REGISTRATION_AGE,
        acceptedTerms: true,
        termsVersion: TERMS_VERSION
      });
      assert.notEqual(duplicateDisplayName.viewer.id, completedPayload.viewer.id);
      assert.equal(duplicateDisplayName.viewer.displayName, completedPayload.viewer.displayName);
      assert.notEqual(duplicateDisplayName.viewer.nickname, completedPayload.viewer.nickname);
      assert.notEqual(duplicateNameLogin.viewer.id, completedPayload.viewer.id);

      const secondPayload = store.loginWithIdentity({
        sessionId: "session-oidc-2",
        sourceSessionId: "session-oidc-source-2",
        authProvider: "https://accounts.example.com",
        authSubject: "subject-123",
        email: "test@example.com",
        emailVerified: true,
        displayName: "Test User Renamed"
      });

      assert.equal(secondPayload.viewer.id, initialPayload.viewer.id);
      assert.equal(secondPayload.viewer.displayName, "Abril");
      assert.equal(secondPayload.viewer.profilePending, false);
      assert.equal(secondPayload.viewer.profileSuggestedName, "Test User Renamed");
    });
  });

  await test("backend rejects unverified OIDC email claims without creating accounts", async () => {
    await withTempStore((store) => {
      assert.throws(
        () =>
          store.loginWithIdentity({
            sessionId: "session-oidc-unverified",
            sourceSessionId: "session-oidc-unverified-source",
            authProvider: "https://accounts.example.com",
            authSubject: "subject-unverified",
            email: "admin@example.com",
            emailVerified: false,
            displayName: "Unverified Admin"
          }),
        (error) => error.code === "OIDC_EMAIL_NOT_VERIFIED"
      );
      assert.equal(store.getDiagnostics().users, 0);
      assert.equal(store.getDiagnostics().sessions, 0);
    }, { seedDemoData: false });
  });

  await test("backend links verified password and Google identities to the same stable user id", async () => {
    await withTempStore((store) => {
      const nowMs = Date.UTC(2026, 6, 11, 12);
      const challenge = store.createEmailAuthChallenge({
        email: "linked@example.com",
        nickname: "linked_user",
        age: MINIMUM_REGISTRATION_AGE,
        acceptedTerms: true,
        termsVersion: TERMS_VERSION,
        password: "password-segura",
        nowMs
      });
      const registered = store.verifyEmailAuthChallenge({
        challengeId: challenge.challengeId,
        code: challenge.code,
        sessionId: "session-linked-password",
        nowMs: nowMs + 1_000
      });
      const originalId = registered.viewer.id;

      assert.equal(registered.viewer.emailVerified, true);
      assert.equal(registered.viewer.nickname, "Linked_user");
      assert.equal(Object.hasOwn(registered.viewer, "email"), true);
      assert.equal(registered.users.every((user) => !Object.hasOwn(user, "email")), true);

      const linked = store.loginWithIdentity({
        sessionId: "session-linked-google",
        sourceSessionId: "session-linked-google-source",
        authProvider: "https://accounts.google.com",
        authSubject: "google-linked-subject",
        email: "linked@example.com",
        emailVerified: true,
        displayName: "Abril"
      });
      const passwordLogin = store.loginWithPassword({
        sessionId: "session-linked-password-login",
        email: "linked@example.com",
        password: "password-segura"
      });

      assert.equal(linked.viewer.id, originalId);
      assert.equal(passwordLogin.viewer.id, originalId);
      assert.equal(linked.viewer.nickname, "Linked_user");
      assert.equal(linked.viewer.displayName, "Linked_user");
      assert.equal(linked.viewer.authProvider, "https://accounts.google.com");
      assert.equal(linked.users.every((user) => !Object.hasOwn(user, "email")), true);
      assert.equal(store.getDiagnostics().users, 1);
    }, { seedDemoData: false });
  });

  await test("backend refuses to auto-link a legacy password email that was never verified", async () => {
    await withTempStore((store) => {
      const legacy = store.registerWithPassword({
        sessionId: "session-legacy-password",
        email: "legacy@example.com",
        password: "password-segura",
        nickname: "legacy_user"
      });

      assert.equal(legacy.viewer.emailVerified, false);
      assert.throws(
        () =>
          store.loginWithIdentity({
            sessionId: "session-legacy-google",
            sourceSessionId: "session-legacy-google-source",
            authProvider: "https://accounts.google.com",
            authSubject: "legacy-google-subject",
            email: "legacy@example.com",
            emailVerified: true,
            displayName: "Legacy User"
          }),
        (error) => error.code === "ACCOUNT_LINK_REQUIRED"
      );
      assert.equal(store.getDiagnostics().users, 1);
    }, { seedDemoData: false });
  });

  await test("backend password reset is indistinguishable, rate limited and rotates credentials safely", async () => {
    await withTempStore((store) => {
      const nowMs = Date.UTC(2026, 6, 11, 12);
      const registration = store.createEmailAuthChallenge({
        email: "reset@example.com",
        nickname: "reset_user",
        age: MINIMUM_REGISTRATION_AGE,
        acceptedTerms: true,
        termsVersion: TERMS_VERSION,
        password: "password-vieja",
        nowMs
      });
      const registered = store.verifyEmailAuthChallenge({
        challengeId: registration.challengeId,
        code: registration.code,
        sessionId: "session-reset-origin",
        rotateSession: true,
        nowMs: nowMs + 1_000
      });
      const originalId = registered.viewer.id;
      const activeSessionId = registered.sessionId;
      assert.equal(store.refresh({ sessionId: activeSessionId }).viewer.type, "registered");

      const knownChallenge = store.createPasswordResetChallenge({
        email: "reset@example.com",
        ipAddress: "203.0.113.10",
        nowMs: nowMs + 10_000
      });
      const unknownChallenge = store.createPasswordResetChallenge({
        email: "nadie@example.com",
        ipAddress: "203.0.113.11",
        nowMs: nowMs + 10_000
      });

      assert.deepEqual(Object.keys(knownChallenge).sort(), Object.keys(unknownChallenge).sort());
      assert.match(knownChallenge.challengeId, /^password-reset-/);
      assert.match(unknownChallenge.challengeId, /^password-reset-/);
      assert.equal(knownChallenge.expiresInSeconds, unknownChallenge.expiresInSeconds);
      assert.equal(knownChallenge.deliveryRequired, true);
      assert.match(knownChallenge.code, /^\d{6}$/);
      assert.equal(unknownChallenge.deliveryRequired, false);
      assert.equal(unknownChallenge.code, null);
      assert.equal(unknownChallenge.email, null);

      const cooldownChallenge = store.createPasswordResetChallenge({
        email: "reset@example.com",
        ipAddress: "203.0.113.10",
        nowMs: nowMs + 20_000
      });
      assert.equal(cooldownChallenge.deliveryRequired, false);
      assert.equal(cooldownChallenge.code, null);

      const secondChallenge = store.createPasswordResetChallenge({
        email: "reset@example.com",
        ipAddress: "203.0.113.10",
        nowMs: nowMs + 71_000
      });
      assert.equal(secondChallenge.deliveryRequired, true);
      assert.throws(
        () => store.verifyPasswordResetChallenge({
          challengeId: knownChallenge.challengeId,
          code: knownChallenge.code,
          newPassword: "password-nueva",
          sessionId: "session-reset-old-challenge",
          nowMs: nowMs + 72_000
        }),
        (error) => error.code === "INVALID_PASSWORD_RESET_CODE"
      );

      const wrongCode = secondChallenge.code === "000000" ? "111111" : "000000";
      for (let attempt = 0; attempt < 5; attempt += 1) {
        assert.throws(
          () => store.verifyPasswordResetChallenge({
            challengeId: secondChallenge.challengeId,
            code: wrongCode,
            newPassword: "password-nueva",
            sessionId: "session-reset-wrong",
            nowMs: nowMs + 73_000
          }),
          (error) => error.code === "INVALID_PASSWORD_RESET_CODE"
        );
      }
      assert.throws(
        () => store.verifyPasswordResetChallenge({
          challengeId: secondChallenge.challengeId,
          code: secondChallenge.code,
          newPassword: "password-nueva",
          sessionId: "session-reset-locked",
          nowMs: nowMs + 74_000
        }),
        (error) => error.code === "PASSWORD_RESET_ATTEMPTS_EXCEEDED"
      );

      const expiredChallenge = store.createPasswordResetChallenge({
        email: "reset@example.com",
        ipAddress: "203.0.113.10",
        nowMs: nowMs + 140_000
      });
      assert.throws(
        () => store.verifyPasswordResetChallenge({
          challengeId: expiredChallenge.challengeId,
          code: expiredChallenge.code,
          newPassword: "password-nueva",
          sessionId: "session-reset-expired",
          nowMs: nowMs + 140_000 + 10 * 60_000 + 1
        }),
        (error) => error.code === "PASSWORD_RESET_CODE_EXPIRED"
      );

      const finalChallenge = store.createPasswordResetChallenge({
        email: "reset@example.com",
        ipAddress: "203.0.113.10",
        nowMs: nowMs + 210_000
      });
      const resetPayload = store.verifyPasswordResetChallenge({
        challengeId: finalChallenge.challengeId,
        code: finalChallenge.code,
        newPassword: "password-nueva",
        sessionId: "session-reset-confirm",
        rotateSession: true,
        nowMs: nowMs + 220_000
      });

      assert.equal(resetPayload.viewer.id, originalId);
      assert.equal(resetPayload.viewer.type, "registered");
      assert.equal(resetPayload.viewer.emailVerified, true);
      assert.notEqual(resetPayload.sessionId, "session-reset-confirm");

      assert.equal(store.refresh({ sessionId: activeSessionId }).viewer.type, "guest");
      assert.throws(
        () => store.verifyPasswordResetChallenge({
          challengeId: finalChallenge.challengeId,
          code: finalChallenge.code,
          newPassword: "password-replay",
          sessionId: "session-reset-replay",
          nowMs: nowMs + 230_000
        }),
        (error) => error.code === "INVALID_PASSWORD_RESET_CODE"
      );

      assert.throws(
        () => store.loginWithPassword({
          sessionId: "session-reset-old-password",
          email: "reset@example.com",
          password: "password-vieja"
        }),
        (error) => error.code === "INVALID_CREDENTIALS"
      );
      const newLogin = store.loginWithPassword({
        sessionId: "session-reset-new-password",
        email: "reset@example.com",
        password: "password-nueva",
        rotateSession: true
      });
      assert.equal(newLogin.viewer.id, originalId);
    }, { seedDemoData: false });
  });

  await test("backend account linking demands fresh password proof and a matching Google identity", async () => {
    await withTempStore((store) => {
      const registered = store.registerWithPassword({
        sessionId: "session-link-owner",
        email: "owner@example.com",
        password: "password-segura",
        nickname: "owner_user",
        rotateSession: true
      });
      const ownerSessionId = registered.sessionId;
      const ownerId = registered.viewer.id;
      assert.equal(registered.viewer.hasPassword, true);
      assert.equal(registered.viewer.canLinkGoogle, true);

      assert.throws(
        () => store.prepareIdentityLink({ sessionId: "session-link-guest", password: "password-segura" }),
        (error) => error.code === "ACCOUNT_LINK_NOT_AVAILABLE"
      );
      assert.throws(
        () => store.prepareIdentityLink({ sessionId: ownerSessionId, password: "password-mala" }),
        (error) => error.code === "INVALID_CREDENTIALS"
      );

      const target = store.prepareIdentityLink({ sessionId: ownerSessionId, password: "password-segura" });
      assert.equal(target.userId, ownerId);
      assert.equal(target.email, "owner@example.com");

      const baseLink = {
        sessionId: "session-link-next",
        sourceSessionId: target.sessionId,
        targetUserId: target.userId,
        expectedEmail: target.email,
        authProvider: "https://accounts.google.com",
        authSubject: "google-owner-subject",
        email: "owner@example.com",
        emailVerified: true
      };

      assert.throws(
        () => store.completeIdentityLink({ ...baseLink, emailVerified: false }),
        (error) => error.code === "INVALID_ACCOUNT_LINK_IDENTITY"
      );
      assert.throws(
        () => store.completeIdentityLink({ ...baseLink, email: "otra@example.com" }),
        (error) => error.code === "ACCOUNT_LINK_EMAIL_MISMATCH"
      );
      assert.throws(
        () => store.completeIdentityLink({ ...baseLink, sourceSessionId: "session-link-stranger" }),
        (error) => error.code === "ACCOUNT_LINK_SESSION_EXPIRED"
      );

      store.loginWithIdentity({
        sessionId: "session-link-other",
        sourceSessionId: "session-link-other-source",
        authProvider: "https://accounts.google.com",
        authSubject: "google-taken-subject",
        email: "otra-cuenta@example.com",
        emailVerified: true,
        displayName: "Otra"
      });
      assert.throws(
        () => store.completeIdentityLink({ ...baseLink, authSubject: "google-taken-subject" }),
        (error) => error.code === "AUTH_IDENTITY_TAKEN"
      );

      const linked = store.completeIdentityLink(baseLink);
      assert.equal(linked.viewer.id, ownerId);
      assert.equal(linked.viewer.authProvider, "https://accounts.google.com");
      assert.equal(linked.viewer.canLinkGoogle, false);

      assert.throws(
        () => store.prepareIdentityLink({ sessionId: linked.sessionId, password: "password-segura" }),
        (error) => error.code === "ACCOUNT_ALREADY_LINKED"
      );
    }, { seedDemoData: false });
  });

  await test("backend loginWithIdentity preserves existing account data when provider data is incomplete", async () => {
    await withTempStore((store) => {
      const initialPayload = store.loginWithIdentity({
        sessionId: "session-oidc-preserve-1",
        sourceSessionId: "session-oidc-preserve-source-1",
        authProvider: "https://accounts.example.com",
        authSubject: "subject-preserve",
        email: "preserve@example.com",
        emailVerified: true,
        displayName: "Provider User",
        avatarUrl: "https://cdn.example.com/provider-avatar.png"
      });

      const completedPayload = store.updateProfile({
        sessionId: "session-oidc-preserve-1",
        displayName: "Alias_protegido",
        username: "alias_protegido",
        age: MINIMUM_REGISTRATION_AGE,
        acceptedTerms: true,
        termsVersion: TERMS_VERSION,
        avatarDataUrl: "data:image/png;base64,c2FmZQ=="
      });

      store.login({
        sessionId: "session-oidc-preserve-moderator",
        userId: "u2"
      });
      const approvedPayload = store.applyModerationAction("approve_avatar", {
        sessionId: "session-oidc-preserve-moderator",
        targetType: "user",
        targetId: completedPayload.viewer.id
      });
      const approvedUser = approvedPayload.users.find(
        (user) => user.id === completedPayload.viewer.id
      );

      const secondPayload = store.loginWithIdentity({
        sessionId: "session-oidc-preserve-2",
        sourceSessionId: "session-oidc-preserve-source-2",
        authProvider: "https://accounts.example.com",
        authSubject: "subject-preserve",
        email: "",
        displayName: "   ",
        avatarUrl: "javascript:alert(1)"
      });

      assert.equal(secondPayload.viewer.id, initialPayload.viewer.id);
      assert.equal(secondPayload.viewer.email, "preserve@example.com");
      assert.equal(secondPayload.viewer.displayName, "Alias_protegido");
      assert.equal(secondPayload.viewer.profilePending, false);
      assert.equal(secondPayload.viewer.avatarUrl, approvedUser.avatarUrl);
      assert.equal(secondPayload.viewer.avatarPendingUrl, null);
      assert.equal(secondPayload.viewer.profileSuggestedName, null);
      assert.equal(secondPayload.viewer.profileSuggestedAvatarUrl, null);
    });
  });
  await test("backend loginWithIdentity ignores invalid provider avatar urls", async () => {
    await withTempStore((store) => {
      const longAvatarUrl = `https://cdn.example.com/avatar.png?signature=${"a".repeat(520)}`;

      const longAvatarPayload = store.loginWithIdentity({
        sessionId: "session-oidc-long-avatar",
        sourceSessionId: "session-oidc-long-avatar-source",
        authProvider: "https://accounts.example.com",
        authSubject: "subject-long-avatar",
        email: "long-avatar@example.com",
        emailVerified: true,
        displayName: "Long Avatar User",
        avatarUrl: longAvatarUrl
      });

      assert.equal(longAvatarPayload.viewer.type, "registered");
      assert.equal(longAvatarPayload.viewer.profileSuggestedName, "Long Avatar User");
      assert.equal(longAvatarPayload.viewer.profileSuggestedAvatarUrl, null);

      const invalidAvatarPayload = store.loginWithIdentity({
        sessionId: "session-oidc-invalid-avatar",
        sourceSessionId: "session-oidc-invalid-avatar-source",
        authProvider: "https://accounts.example.com",
        authSubject: "subject-invalid-avatar",
        email: "invalid-avatar@example.com",
        emailVerified: true,
        displayName: "Invalid Avatar User",
        avatarUrl: "javascript:alert(1)"
      });

      assert.equal(invalidAvatarPayload.viewer.type, "registered");
      assert.equal(invalidAvatarPayload.viewer.profileSuggestedName, "Invalid Avatar User");
      assert.equal(invalidAvatarPayload.viewer.profileSuggestedAvatarUrl, null);
    });
  });
  await test("backend persists registered users and topics across store reopen", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "topykly-persist-"));
    const dbPath = path.join(tempDir, "topykly.sqlite");
    let store = createBackendStore({ dbPath });

    try {
      const firstLogin = store.loginWithIdentity({
        sessionId: "session-persist-1",
        authProvider: "https://accounts.example.com",
        authSubject: "persist-subject",
        email: "persist@example.com",
        emailVerified: true,
        displayName: "Persist User"
      });
      const userId = firstLogin.viewer.id;

      store.updateProfile({
        sessionId: "session-persist-1",
        displayName: "Persist_alias",
        username: "persist_alias",
        age: MINIMUM_REGISTRATION_AGE,
        acceptedTerms: true,
        termsVersion: TERMS_VERSION
      });
      const created = store.createTopic({
        sessionId: "session-persist-1",
        title: "Tema persistente",
        text: "Mensaje persistente"
      });
      const topicId = created.selectedTopicId;

      store.close();
      store = createBackendStore({ dbPath });

      const secondLogin = store.loginWithIdentity({
        sessionId: "session-persist-2",
        authProvider: "https://accounts.example.com",
        authSubject: "persist-subject",
        email: "persist@example.com",
        emailVerified: true,
        displayName: "Persist User Renamed"
      });
      const persistedTopic = secondLogin.topics.find((topic) => topic.id === topicId);

      assert.equal(secondLogin.viewer.id, userId);
      assert.equal(secondLogin.viewer.displayName, "Persist_alias");
      assert.equal(secondLogin.viewer.profilePending, false);
      assert.ok(persistedTopic);
      assert.equal(persistedTopic.title, "Tema persistente");
      assert.equal(persistedTopic.messages[0].text, "Mensaje persistente");
    } finally {
      store.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
  await test("backend updateProfile lets registered users change display name and request avatar review", async () => {
    await withTempStore(async (store) => {
      const beforeUpdate = store.login({
        sessionId: "session-profile",
        selectedTopicId: null
      });

      const updated = store.updateProfile({
        sessionId: "session-profile",
        displayName: "Nombre_nuevo",
        description: "Descripcion breve del perfil",
        profileShowDescription: false,
        profileShowJoinedAt: false,
        socialWhatsapp: "+5491133334444",
        socialInstagram: "@abril.rosa",
        socialTiktok: "abril_rosa",
        socialFacebook: "abril.rosa",
        socialTwitter: "abrilrosa",
        socialDiscord: "abril_rosa_discord",
        profileShowSocial: false,
        avatarDataUrl: "data:image/jpeg;base64,aW1hZ2U="
      });

      assert.equal(updated.viewer.type, "registered");
      assert.equal(updated.viewer.displayName, "Nombre_nuevo");
      assert.equal(updated.viewer.id, beforeUpdate.viewer.id);
      assert.equal(updated.viewer.nickname, beforeUpdate.viewer.nickname);
      assert.equal(updated.viewer.description, "Descripcion breve del perfil");
      assert.equal(updated.viewer.profileShowDescription, false);
      assert.equal(updated.viewer.profileShowJoinedAt, false);
      assert.equal(updated.viewer.socialWhatsapp, "+5491133334444");
      assert.equal(updated.viewer.socialInstagram, "abril.rosa");
      assert.equal(updated.viewer.socialTiktok, "abril_rosa");
      assert.equal(updated.viewer.socialFacebook, "abril.rosa");
      assert.equal(updated.viewer.socialTwitter, "abrilrosa");
      assert.equal(updated.viewer.socialDiscord, "abril_rosa_discord");
      assert.equal(updated.viewer.profileShowSocial, false);
      assert.equal(
        updated.users.find((user) => user.id === updated.viewer.id)?.description,
        "Descripcion breve del perfil"
      );
      assert.equal(
        updated.users.find((user) => user.id === updated.viewer.id)?.profileShowDescription,
        false
      );
      assert.equal(
        updated.users.find((user) => user.id === updated.viewer.id)?.profileShowJoinedAt,
        false
      );
      assert.equal(
        updated.users.find((user) => user.id === updated.viewer.id)?.socialInstagram,
        "abril.rosa"
      );
      assert.equal(
        updated.users.find((user) => user.id === updated.viewer.id)?.profileShowSocial,
        false
      );
      assert.equal(updated.viewer.avatarUrl, null);
      assert.match(updated.viewer.avatarPendingUrl, /^\/avatars\/[a-f0-9-]+\.jpg$/);
      assert.doesNotMatch(updated.viewer.avatarPendingUrl, /^data:/);
      assert.equal(updated.viewer.avatarReviewStatus, "pending");
      assert.equal(
        updated.users.find((user) => user.id === updated.viewer.id)?.avatarPendingUrl,
        updated.viewer.avatarPendingUrl
      );
      const storedAvatar = await readFile(
        path.join(store.avatarStorageDir, path.basename(updated.viewer.avatarPendingUrl))
      );
      assert.equal(storedAvatar.toString("utf8"), "image");
      const sameDisplayName = store.registerWithPassword({
        sessionId: "session-profile-duplicate-register",
        email: "profile-duplicate@example.com",
        password: "password-segura",
        nickname: "nombre_nuevo"
      });
      assert.notEqual(sameDisplayName.viewer.id, updated.viewer.id);
      assert.equal(sameDisplayName.viewer.displayName, updated.viewer.displayName);
      assert.notEqual(sameDisplayName.viewer.nickname, updated.viewer.nickname);

      store.login({
        sessionId: "session-profile-moderator",
        userId: "u2"
      });
      const approved = store.applyModerationAction("approve_avatar", {
        sessionId: "session-profile-moderator",
        targetType: "user",
        targetId: updated.viewer.id
      });
      const approvedUser = approved.users.find((user) => user.id === updated.viewer.id);
      assert.equal(approvedUser.avatarUrl, updated.viewer.avatarPendingUrl);
      assert.doesNotMatch(approvedUser.avatarUrl, /^data:/);
      assert.equal(approvedUser.avatarPendingUrl, null);

      const removedAvatar = store.updateProfile({
        sessionId: "session-profile",
        displayName: "Nombre_nuevo",
        removeAvatar: true
      });
      assert.equal(removedAvatar.viewer.avatarUrl, null);
      assert.equal(removedAvatar.viewer.avatarPendingUrl, null);
      assert.equal(removedAvatar.viewer.avatarReviewStatus, null);
      assert.equal(
        removedAvatar.users.find((user) => user.id === updated.viewer.id)?.avatarUrl,
        null
      );
      await assert.rejects(
        () =>
          readFile(
            path.join(store.avatarStorageDir, path.basename(updated.viewer.avatarPendingUrl))
          ),
        /ENOENT/
      );

      const firstPendingAvatar = store.updateProfile({
        sessionId: "session-profile",
        displayName: "Nombre_nuevo",
        avatarDataUrl: "data:image/png;base64,b2xk"
      });
      const firstPendingAvatarPath = path.join(
        store.avatarStorageDir,
        path.basename(firstPendingAvatar.viewer.avatarPendingUrl)
      );
      const secondPendingAvatar = store.updateProfile({
        sessionId: "session-profile",
        displayName: "Nombre_nuevo",
        avatarDataUrl: "data:image/webp;base64,bmV3"
      });
      await assert.rejects(() => readFile(firstPendingAvatarPath), /ENOENT/);
      assert.equal(
        (
          await readFile(
            path.join(
              store.avatarStorageDir,
              path.basename(secondPendingAvatar.viewer.avatarPendingUrl)
            )
          )
        ).toString("utf8"),
        "new"
      );

      assert.throws(
        () =>
          store.updateProfile({
            sessionId: "session-profile-guest",
            avatarDataUrl: "data:image/png;base64,aGVsbG8="
          }),
        /Hace falta iniciar sesion/
      );

      assert.throws(
        () =>
          store.updateProfile({
            sessionId: "session-profile",
            avatarDataUrl: "data:text/html;base64,PHNjcmlwdD4="
          }),
        /PNG, JPG, WebP o GIF/
      );
      const oversizedAvatar = Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64");
      assert.throws(
        () =>
          store.updateProfile({
            sessionId: "session-profile",
            avatarDataUrl: `data:image/png;base64,${oversizedAvatar}`
          }),
        /2 MB/
      );
      assert.throws(
        () =>
          store.updateProfile({
            sessionId: "session-profile",
            displayName: "Nombre_nuevo",
            description: "x".repeat(181)
          }),
        (error) => error.code === "VALIDATION_ERROR"
      );

      assert.throws(
        () =>
          store.updateProfile({
            sessionId: "session-profile",
            displayName: "Nombre_nuevo",
            socialInstagram: "a".repeat(41)
          }),
        (error) => error.code === "VALIDATION_ERROR"
      );
      assert.throws(
        () =>
          store.updateProfile({
            sessionId: "session-profile",
            displayName: "Nombre_nuevo",
            socialInstagram: "javascript:alert(1)"
          }),
        (error) => error.code === "VALIDATION_ERROR"
      );
      assert.throws(
        () =>
          store.updateProfile({
            sessionId: "session-profile",
            displayName: "Nombre_nuevo",
            socialFacebook: "../../etc"
          }),
        (error) => error.code === "VALIDATION_ERROR"
      );
      assert.throws(
        () =>
          store.updateProfile({
            sessionId: "session-profile",
            displayName: "Nombre_nuevo",
            socialWhatsapp: "not-a-phone"
          }),
        (error) => error.code === "VALIDATION_ERROR"
      );
    });
  });

  await test("backend grants admin access to existing sessions when email becomes configured", async () => {
    const previousAdminEmails = process.env.TOPYKLY_ADMIN_EMAILS;
    delete process.env.TOPYKLY_ADMIN_EMAILS;

    try {
      await withTempStore((store) => {
        const userPayload = store.loginWithIdentity({
          sessionId: "session-existing-admin-email",
          sourceSessionId: "session-existing-admin-source",
          authProvider: "https://accounts.example.com",
          authSubject: "existing-admin-subject",
          email: "existing-admin@example.com",
          emailVerified: true,
          displayName: "Existing Admin"
        });

        assert.equal(userPayload.viewer.role, "Registrado");
        assert.equal(userPayload.viewer.isAdmin, false);

        process.env.TOPYKLY_ADMIN_EMAILS = "existing-admin@example.com";

        const bootstrapPayload = store.bootstrap({ sessionId: "session-existing-admin-email" });
        assert.equal(bootstrapPayload.viewer.role, "Admin");
        assert.equal(bootstrapPayload.viewer.isAdmin, true);

        const dashboard = store.getAdminDashboard({ sessionId: "session-existing-admin-email" });
        assert.equal(dashboard.viewer.isAdmin, true);
      });
    } finally {
      if (previousAdminEmails === undefined) {
        delete process.env.TOPYKLY_ADMIN_EMAILS;
      } else {
        process.env.TOPYKLY_ADMIN_EMAILS = previousAdminEmails;
      }
    }
  });
  await test("backend promotes configured OAuth emails to admin dashboard access", async () => {
    const previousAdminEmails = process.env.TOPYKLY_ADMIN_EMAILS;
    process.env.TOPYKLY_ADMIN_EMAILS = "admin@example.com";

    try {
      await withTempStore((store) => {
        const adminPayload = store.loginWithIdentity({
          sessionId: "session-admin-oauth",
          sourceSessionId: "session-admin-source",
          authProvider: "https://accounts.example.com",
          authSubject: "admin-subject",
          email: "admin@example.com",
          emailVerified: true,
          displayName: "Admin User"
        });

        assert.equal(adminPayload.viewer.role, "Admin");
        assert.equal(adminPayload.viewer.isAdmin, true);

        const userPayload = store.loginWithIdentity({
          sessionId: "session-avatar-review-user",
          sourceSessionId: "session-avatar-review-source",
          authProvider: "https://accounts.example.com",
          authSubject: "review-user-subject",
          email: "review@example.com",
          emailVerified: true,
          displayName: "Review User"
        });
        const pendingPayload = store.updateProfile({
          sessionId: "session-avatar-review-user",
          displayName: "Review_user",
          username: "review_user",
          age: MINIMUM_REGISTRATION_AGE,
          acceptedTerms: true,
          termsVersion: TERMS_VERSION,
          avatarDataUrl: "data:image/png;base64,aGVsbG8="
        });

        assert.equal(pendingPayload.viewer.avatarReviewStatus, "pending");
        assert.match(pendingPayload.viewer.avatarPendingUrl, /^\/avatars\/[a-f0-9-]+\.png$/);

        const dashboard = store.getAdminDashboard({ sessionId: "session-admin-oauth" });
        assert.equal(
          dashboard.pendingAvatars.some((item) => item.userId === userPayload.viewer.id),
          true
        );

        const approved = store.applyModerationAction("approve_avatar", {
          sessionId: "session-admin-oauth",
          targetType: "user",
          targetId: userPayload.viewer.id
        });
        const approvedUser = approved.users.find((user) => user.id === userPayload.viewer.id);
        assert.equal(approvedUser.avatarUrl, pendingPayload.viewer.avatarPendingUrl);
        assert.match(approvedUser.avatarUrl, /^\/avatars\/[a-f0-9-]+\.png$/);
        assert.doesNotMatch(approvedUser.avatarUrl, /^data:/);
        assert.equal(approvedUser.avatarPendingUrl, null);
        assert.equal(
          store.getAdminDashboard({ sessionId: "session-admin-oauth" }).pendingAvatars.length,
          0
        );
      });
    } finally {
      if (previousAdminEmails === undefined) {
        delete process.env.TOPYKLY_ADMIN_EMAILS;
      } else {
        process.env.TOPYKLY_ADMIN_EMAILS = previousAdminEmails;
      }
    }
  });
  await test("backend locks one message reaction per registered user until daily reset", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "topykly-likes-"));
    const dbPath = path.join(tempDir, "topykly.sqlite");
    let store = createBackendStore({ dbPath });

    function findMessage(payload, topicId, messageId) {
      return payload.topics
        .find((entry) => entry.id === topicId)
        .messages.find((entry) => entry.id === messageId);
    }

    try {
      store.registerWithPassword({
        sessionId: "session-like-user",
        email: "like@example.com",
        password: "password-segura",
        nickname: "like_user"
      });
      const created = store.createTopic({
        sessionId: "session-like-user",
        title: "Tema con likes reales",
        text: "Mensaje con likes reales"
      });
      const topic = created.topics[0];
      const message = topic.messages[0];

      const liked = store.toggleMessageLike(message.id, {
        sessionId: "session-like-user",
        selectedTopicId: topic.id
      });
      const likedMessage = findMessage(liked, topic.id, message.id);
      assert.equal(likedMessage.likes, 1);
      assert.equal(likedMessage.dislikes, 0);
      assert.equal(likedMessage.likedByViewer, true);
      assert.equal(likedMessage.dislikedByViewer, false);

      assert.throws(
        () =>
          store.toggleMessageLike(message.id, {
            sessionId: "session-like-user",
            selectedTopicId: topic.id
          }),
        (error) => error?.code === "MESSAGE_REACTION_LOCKED"
      );
      assert.throws(
        () =>
          store.toggleMessageDislike(message.id, {
            sessionId: "session-like-user",
            selectedTopicId: topic.id
          }),
        (error) => error?.code === "MESSAGE_REACTION_LOCKED"
      );

      const reset = store.resetDailyMessageReactions({
        now: new Date(Date.now() + 36 * 60 * 60_000)
      });
      assert.equal(reset.reset, true);
      assert.equal(reset.deletedLikes, 1);
      assert.equal(reset.deletedDislikes, 0);

      const disliked = store.toggleMessageDislike(message.id, {
        sessionId: "session-like-user",
        selectedTopicId: topic.id
      });
      const dislikedMessage = findMessage(disliked, topic.id, message.id);
      assert.equal(dislikedMessage.likes, 0);
      assert.equal(dislikedMessage.dislikes, 1);
      assert.equal(dislikedMessage.likedByViewer, false);
      assert.equal(dislikedMessage.dislikedByViewer, true);

      store.close();
      store = createBackendStore({ dbPath });
      const reopened = store.openTopic(topic.id, {
        sessionId: "session-like-user",
        authMode: "registered"
      });
      const reopenedMessage = findMessage(reopened, topic.id, message.id);
      assert.equal(reopenedMessage.likes, 0);
      assert.equal(reopenedMessage.dislikes, 1);
      assert.equal(reopenedMessage.likedByViewer, false);
      assert.equal(reopenedMessage.dislikedByViewer, true);
    } finally {
      store.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
  await test("backend hydrates persistent rankings from SQLite", async () => {
    await withTempStore(
      (store) => {
        store.registerWithPassword({
          sessionId: "session-ranking-author",
          email: "ranking-author@example.com",
          password: "password-segura",
          nickname: "Ranking_author"
        });
        store.registerWithPassword({
          sessionId: "session-ranking-voter",
          email: "ranking-voter@example.com",
          password: "password-segura",
          nickname: "ranking_voter"
        });
        const created = store.createTopic({
          sessionId: "session-ranking-author",
          title: "Tema para ranking real",
          text: "Primer comentario puntuable"
        });
        const topic = created.topics[0];
        const message = topic.messages[0];

        const liked = store.toggleMessageLike(message.id, {
          sessionId: "session-ranking-voter",
          selectedTopicId: topic.id
        });

        assert.equal(liked.rankings.global.posts.comments[0].id, topic.id);
        assert.equal(liked.rankings.global.posts.comments[0].count, 1);
        assert.equal(liked.rankings.global.posts.likes[0].id, topic.id);
        assert.equal(liked.rankings.global.posts.likes[0].count, 1);
        assert.equal(liked.rankings.global.users.comments[0].title, "Ranking_author");
        assert.equal(liked.rankings.global.users.comments[0].count, 1);
        assert.equal(liked.rankings.global.users.likes[0].title, "Ranking_author");
        assert.equal(liked.rankings.global.users.likes[0].count, 1);
        assert.equal(liked.rankings.topic.users.comments[0].title, "Ranking_author");
        assert.equal(liked.rankings.topic.users.likes[0].title, "Ranking_author");
      },
      { seedDemoData: false }
    );
  });
  await test("backend reports persist per session and moderation can resolve topic and message reports", async () => {
    await withTempStore((store) => {
      const bootstrapPayload = store.bootstrap({
        sessionId: "session-report-viewer",
        authMode: "guest"
      });
      const topicId = bootstrapPayload.topics[0].id;
      const reportableMessageId = bootstrapPayload.topics[0].messages.find(
        (message) => !message.isRoot
      )?.id;

      assert.ok(reportableMessageId);

      const topicReportedPayload = store.reportEntity("topic", topicId, {
        sessionId: "session-report-viewer",
        reason: "Tema conflictivo",
        selectedTopicId: topicId
      });

      assert.equal(topicReportedPayload.reportedTopicIds.includes(topicId), true);

      const messageReportedPayload = store.reportEntity("message", reportableMessageId, {
        sessionId: "session-report-viewer",
        reason: "Mensaje conflictivo",
        selectedTopicId: topicId
      });

      assert.equal(messageReportedPayload.reportedMessageIds.includes(reportableMessageId), true);

      store.login({
        sessionId: "session-moderator",
        userId: "u2"
      });

      const openReports = store.listReports({
        sessionId: "session-moderator"
      });

      assert.equal(openReports.reports.length, 2);
      assert.deepEqual(openReports.reportPagination, {
        page: 1,
        limit: 50,
        total: 2,
        hasMore: false
      });

      const reportedTopic = bootstrapPayload.topics[0];
      const reportedMessage = reportedTopic.messages.find((message) => message.id === reportableMessageId);
      const topicReport = openReports.reports.find((report) => report.entityType === "topic");
      const messageReport = openReports.reports.find((report) => report.entityType === "message");

      assert.equal(topicReport.target.kind, "topic");
      assert.equal(topicReport.target.title, reportedTopic.title);
      assert.equal(topicReport.target.authorId, reportedTopic.authorId);

      assert.equal(messageReport.target.kind, "message");
      assert.equal(messageReport.target.text, reportedMessage.text);
      assert.equal(messageReport.target.authorId, reportedMessage.authorId);
      assert.equal(messageReport.target.topicTitle, reportedTopic.title);

      const blockedPayload = store.applyModerationAction("block_topic", {
        sessionId: "session-moderator",
        targetType: "topic",
        targetId: topicId,
        selectedTopicId: topicId
      });
      const blockedTopic = blockedPayload.topics.find((topic) => topic.id === topicId);

      assert.ok(blockedTopic);
      assert.equal(blockedTopic.status, "blocked");
      assert.equal(
        store
          .listReports({ sessionId: "session-moderator" })
          .reports.some((report) => report.entityType === "topic" && report.entityId === topicId),
        false
      );

      const afterDeletePayload = store.applyModerationAction("delete_message", {
        sessionId: "session-moderator",
        targetType: "message",
        targetId: reportableMessageId,
        selectedTopicId: topicId
      });
      const moderatedTopic = afterDeletePayload.topics.find((topic) => topic.id === topicId);

      assert.ok(moderatedTopic);
      assert.equal(
        moderatedTopic.messages.some((message) => message.id === reportableMessageId),
        false
      );
      assert.equal(store.listReports({ sessionId: "session-moderator" }).reports.length, 0);
    });
  });

  await test("backend paginates moderation reports", async () => {
    await withTempStore((store) => {
      const bootstrapPayload = store.bootstrap({
        sessionId: "session-report-pagination",
        authMode: "guest"
      });
      const topicId = bootstrapPayload.topics[0].id;

      for (let index = 0; index < 55; index += 1) {
        store.reportEntity("topic", topicId, {
          sessionId: `session-report-pagination-${index}`,
          reason: `Reporte ${index}`,
          selectedTopicId: topicId,
          ipAddress: `198.51.100.${index}`
        });
      }

      store.login({
        sessionId: "session-report-pagination-moderator",
        userId: "u2"
      });

      const firstPage = store.listReports({
        sessionId: "session-report-pagination-moderator"
      });
      const secondPage = store.listReports({
        sessionId: "session-report-pagination-moderator",
        reportPage: 2
      });
      const oversizedLimit = store.listReports({
        sessionId: "session-report-pagination-moderator",
        reportLimit: 500
      });

      assert.equal(firstPage.reports.length, 50);
      assert.deepEqual(firstPage.reportPagination, {
        page: 1,
        limit: 50,
        total: 55,
        hasMore: true
      });
      assert.equal(secondPage.reports.length, 5);
      assert.deepEqual(secondPage.reportPagination, {
        page: 2,
        limit: 50,
        total: 55,
        hasMore: false
      });
      assert.equal(oversizedLimit.reports.length, 55);
      assert.equal(oversizedLimit.reportPagination.limit, 100);
    });
  });
  await test("backend supports user reports and moderator problematic flags", async () => {
    await withTempStore((store) => {
      const bootstrapPayload = store.bootstrap({
        sessionId: "session-user-report",
        authMode: "guest"
      });
      const topicId = bootstrapPayload.topics[0].id;
      const messageId = bootstrapPayload.topics[0].messages.find((message) => !message.isRoot)?.id;

      assert.ok(messageId);

      store.reportEntity("user", "u3", {
        sessionId: "session-user-report",
        reason: "Escala mal con otros usuarios",
        selectedTopicId: topicId
      });

      store.login({
        sessionId: "session-moderator",
        userId: "u2"
      });

      let openReports = store.listReports({
        sessionId: "session-moderator"
      });

      assert.equal(
        openReports.reports.some(
          (report) => report.entityType === "user" && report.entityId === "u3"
        ),
        true
      );

      store.applyModerationAction("expel_user", {
        sessionId: "session-moderator",
        targetType: "user",
        targetId: "u3"
      });

      openReports = store.listReports({
        sessionId: "session-moderator"
      });
      assert.equal(
        openReports.reports.some(
          (report) => report.entityType === "user" && report.entityId === "u3"
        ),
        false
      );

      store.applyModerationAction("mark_problematic", {
        sessionId: "session-moderator",
        targetType: "message",
        targetId: messageId,
        reason: "Revision manual",
        selectedTopicId: topicId
      });

      openReports = store.listReports({
        sessionId: "session-moderator"
      });
      assert.equal(
        openReports.reports.some(
          (report) =>
            report.entityType === "message" &&
            report.entityId === messageId.slice("message-".length)
        ),
        true
      );
    });
  });

  await test("backend expelled registered users cannot create topics, comment or report", async () => {
    await withTempStore((store) => {
      const topicId = store.bootstrap({
        sessionId: "session-pre-expel"
      }).topics[0].id;

      store.login({
        sessionId: "session-moderator",
        userId: "u2"
      });

      store.applyModerationAction("expel_user", {
        sessionId: "session-moderator",
        targetType: "user",
        targetId: "u1"
      });

      assert.throws(
        () => {
          store.createTopic({
            sessionId: "session-expelled-user",
            authMode: "registered",
            title: "No entra",
            text: "No entra"
          });
        },
        (error) => error.code === "USER_EXPELLED"
      );

      assert.throws(
        () => {
          store.addMessage(topicId, {
            sessionId: "session-expelled-user",
            authMode: "registered",
            text: "No comenta"
          });
        },
        (error) => error.code === "USER_EXPELLED"
      );

      assert.throws(
        () => {
          store.reportEntity("topic", topicId, {
            sessionId: "session-expelled-user",
            authMode: "registered",
            reason: "No reporta"
          });
        },
        (error) => error.code === "USER_EXPELLED"
      );
    });
  });

  await test("backend pin_topic promotes hidden active topics to the first visible slot", async () => {
    await withTempStore((store) => {
      const initialPayload = store.bootstrap({
        sessionId: "session-pin-bootstrap",
        authMode: "registered"
      });
      const hiddenTopic = initialPayload.topics.find((topic) => !topic.visible);

      assert.ok(hiddenTopic);

      store.login({
        sessionId: "session-moderator",
        userId: "u2"
      });

      const pinnedPayload = store.applyModerationAction("pin_topic", {
        sessionId: "session-moderator",
        targetType: "topic",
        targetId: hiddenTopic.id,
        selectedTopicId: hiddenTopic.id
      });

      assert.equal(pinnedPayload.topics[0].id, hiddenTopic.id);
      assert.equal(pinnedPayload.topics[0].status, "pinned");
      assert.equal(pinnedPayload.topics[0].visible, true);
      assert.equal(pinnedPayload.selectedTopicId, hiddenTopic.id);
    });
  });

  await test("backend createTopic inserts the new topic at rank 0 and pushes the last topic out of the active window", async () => {
    await withTempStore((store) => {
      const initialPayload = store.bootstrap({
        sessionId: "session-create-bootstrap",
        authMode: "registered"
      });
      const displacedTopicId = initialPayload.topics.at(-1).id;

      const created = store.createTopic({
        sessionId: "session-create",
        authMode: "registered",
        title: "Tema backend",
        text: "Primer mensaje persistido"
      });

      assert.equal(created.topics.length, TOPIC_ACTIVE_LIMIT);
      assert.equal(created.topics[0].title, "Tema backend");
      assert.equal(created.selectedTopicId, created.topics[0].id);
      assert.equal(created.topics[0].messages[0].isRoot, true);
      assert.equal(
        created.topics.some((topic) => topic.id === displacedTopicId),
        false
      );
    });
  });

  await test("backend comment revives hidden active topics to the top of the visible window", async () => {
    await withTempStore((store) => {
      const initialPayload = store.bootstrap({
        sessionId: "session-revive-bootstrap",
        authMode: "registered"
      });
      const hiddenTopic = initialPayload.topics.find((topic) => !topic.visible);

      assert.ok(hiddenTopic);

      const updated = store.addMessage(hiddenTopic.id, {
        sessionId: "session-revive-comment",
        authMode: "registered",
        text: "Comentario que revive el tema oculto."
      });

      assert.equal(updated.topics[0].id, hiddenTopic.id);
      assert.equal(updated.topics[0].visible, true);
      assert.equal(updated.selectedTopicId, hiddenTopic.id);
    });
  });

  await test("backend keeps the root message and only the latest 29 replies", async () => {
    await withTempStore((store) => {
      const created = store.createTopic({
        sessionId: "session-root-topic",
        authMode: "registered",
        title: "Overflow",
        text: "Raiz fija"
      });
      const topicId = created.selectedTopicId;

      for (let index = 0; index < 31; index += 1) {
        const sessionId = `session-root-reply-${index}`;
        store.registerWithPassword({
          sessionId,
          email: `root-reply-${index}@example.com`,
          password: "password-segura",
          nickname: `root_reply_${index}`
        });
        store.addMessage(topicId, {
          sessionId,
          text: `reply ${index}`
        });
      }

      const updated = store.openTopic(topicId, {
        sessionId: "session-root-open",
        authMode: "registered"
      });
      const topic = updated.topics.find((entry) => entry.id === topicId);

      assert.ok(topic);
      assert.equal(topic.messages.length, 30);
      assert.equal(topic.messages[0].text, "Raiz fija");
      assert.equal(topic.messages[0].isRoot, true);
      assert.equal(topic.messages[1].text, "reply 2");
      assert.equal(topic.messages[29].text, "reply 30");
    });
  });

  await test("backend rejects comments on expelled topics and enforces registered message rate limits across sessions", async () => {
    await withTempStore((store) => {
      const initialPayload = store.bootstrap({
        sessionId: "session-expel-bootstrap",
        authMode: "registered"
      });
      const expelledCandidateId = initialPayload.topics[TOPIC_ACTIVE_LIMIT - 1].id;

      store.createTopic({
        sessionId: "session-expel-create",
        authMode: "registered",
        title: "Tema que expulsa al ultimo",
        text: "Empuja la ventana activa"
      });

      assert.throws(
        () => {
          store.addMessage(expelledCandidateId, {
            sessionId: "session-expel-comment",
            authMode: "registered",
            text: "No deberia entrar"
          });
        },
        (error) => error.code === "TOPIC_EXPELLED_OR_BLOCKED" && error.topicStatus === "expelled"
      );

      const activeTopicId = store.bootstrap({
        sessionId: "session-rate-bootstrap",
        authMode: "registered"
      }).topics[0].id;

      store.addMessage(activeTopicId, {
        sessionId: "session-rate-a",
        authMode: "registered",
        text: "Primer comentario"
      });

      assert.throws(
        () => {
          store.addMessage(activeTopicId, {
            sessionId: "session-rate-b",
            authMode: "registered",
            text: "Segundo comentario demasiado rapido"
          });
        },
        (error) => error.code === "RATE_LIMITED" && Number.isInteger(error.retryAfterSeconds)
      );
    });
  });

  await test("backend rejects guest publishing without materializing guest state", async () => {
    await withTempStore((store) => {
      const activeTopicId = store.bootstrap({
        sessionId: "session-guest-ip-bootstrap",
        authMode: "guest",
        ipAddress: "203.0.113.50"
      }).topics[0].id;

      assert.throws(
        () => {
          store.addMessage(activeTopicId, {
            sessionId: "session-guest-ip-a",
            authMode: "guest",
            text: "Comentario guest bloqueado",
            ipAddress: "203.0.113.50"
          });
        },
        (error) => error.code === "LOGIN_REQUIRED"
      );
      assert.throws(
        () => {
          store.createTopic({
            sessionId: "session-guest-topic-ip-a",
            authMode: "guest",
            title: "Tema guest bloqueado",
            text: "No deberia publicarse",
            ipAddress: "203.0.113.52"
          });
        },
        (error) => error.code === "LOGIN_REQUIRED"
      );
      assert.equal(store.getDiagnostics().sessions, 0);
    });
  });
  await test("backend session and ip blocks deny participation without breaking read access", async () => {
    await withTempStore((store) => {
      const blockedSessionPayload = store.login({
        sessionId: "session-blocked-registered",
        authMode: "registered",
        ipAddress: "203.0.113.10"
      });
      const topicId = blockedSessionPayload.topics[0].id;

      store.addMessage(topicId, {
        sessionId: "session-blocked-registered",
        authMode: "registered",
        text: "Mensaje antes del bloqueo",
        ipAddress: "203.0.113.10"
      });

      store.login({
        sessionId: "session-moderator",
        userId: "u2",
        ipAddress: "198.51.100.20"
      });

      store.applyModerationAction("block_session", {
        sessionId: "session-moderator",
        targetType: "session",
        targetId: "session-blocked-registered",
        reason: "Spam reiterado"
      });

      assert.throws(
        () => {
          store.addMessage(topicId, {
            sessionId: "session-blocked-registered",
            authMode: "registered",
            text: "No deberia publicar",
            ipAddress: "203.0.113.10"
          });
        },
        (error) => error.code === "SESSION_BLOCKED"
      );

      const readOnlyPayload = store.openTopic(topicId, {
        sessionId: "session-blocked-registered",
        authMode: "registered",
        ipAddress: "203.0.113.10"
      });

      assert.equal(readOnlyPayload.selectedTopicId, topicId);

      store.applyModerationAction("block_ip", {
        sessionId: "session-moderator",
        targetType: "ip",
        targetId: "203.0.113.99",
        reason: "Reincidencia"
      });

      assert.throws(
        () => {
          store.createTopic({
            sessionId: "session-ip-blocked",
            authMode: "guest",
            title: "No entra",
            text: "No entra",
            ipAddress: "203.0.113.99"
          });
        },
        (error) => error.code === "IP_BLOCKED"
      );

      assert.throws(
        () => {
          store.login({
            sessionId: "session-ip-login",
            ipAddress: "203.0.113.99"
          });
        },
        (error) => error.code === "IP_BLOCKED"
      );

      const diagnostics = store.getDiagnostics();

      assert.deepEqual(diagnostics, {
        dbPath: diagnostics.dbPath,
        dbPathSource: "explicit",
        storageConfigured: true,
        storageWarning: null,
        topics: diagnostics.topics,
        messages: diagnostics.messages,
        users: diagnostics.users,
        sessions: diagnostics.sessions,
        reports: diagnostics.reports,
        blockedSessions: 1,
        blockedIps: 1
      });
    });
  });

  await test("manual refresh hydrates backend data while preserving the refresh feedback", async () => {
    const users = buildUsers(initialUsers);
    const topics = buildTopics(topicSeedData, users, 1_700_000_000_000);
    const buttonAttributes = new Map();
    const refreshButton = {
      classList: createClassList(),
      setAttribute(name, value) {
        buttonAttributes.set(name, value);
      }
    };
    const state = {
      viewer: { id: "u1", type: "registered" },
      topics,
      users,
      currentUserId: "u1",
      selectedTopicId: topics[0].id,
      refreshCount: 0
    };
    let renderCalls = 0;
    const initialMessages = topics[0].messages.length;
    const actions = createChatActions({
      state,
      dom: {
        refreshButton
      },
      render: () => {
        renderCalls += 1;
      },
      refreshFeedbackMs: 5,
      apiClient: {
        async refreshTopics(selectedTopicId) {
          return {
            viewer: { id: "u1", type: "registered" },
            users,
            topics,
            selectedTopicId
          };
        }
      }
    });

    await actions.refreshCurrentTopic();

    assert.equal(topics[0].messages.length, initialMessages);
    assert.equal(state.refreshCount, 1);
    assert.equal(refreshButton.classList.contains("is-refreshing"), true);
    assert.equal(buttonAttributes.get("aria-busy"), "true");
    assert.equal(renderCalls, 1);

    await new Promise((resolve) => setTimeout(resolve, 15));

    assert.equal(refreshButton.classList.contains("is-refreshing"), false);
    assert.equal(buttonAttributes.get("aria-busy"), "false");
  });

  await test("submitting a comment scrolls the message stream to the bottom", async () => {
    const users = buildUsers(initialUsers);
    const topics = buildTopics(topicSeedData, users, 1_700_000_000_000);
    const topicId = topics[0].id;
    const submittedMessage = createMessage("u1", "Nuevo comentario", 0, "user", 1_700_000_060_000);
    const updatedTopics = topics.map((topic) =>
      topic.id === topicId ? { ...topic, messages: [...topic.messages, submittedMessage] } : topic
    );
    const state = {
      viewer: { id: "u1", type: "registered" },
      topics,
      users,
      currentUserId: "u1",
      selectedTopicId: topicId,
      unreadTopicIds: [topicId],
      refreshCount: 0
    };
    const messageStream = {
      scrollTop: 0,
      scrollHeight: 320
    };
    const messageInput = {
      value: "Nuevo comentario",
      readOnly: false
    };
    let renderCalls = 0;
    const actions = createChatActions({
      state,
      dom: {
        messageInput,
        messageStream
      },
      render: () => {
        renderCalls += 1;
        messageStream.scrollHeight = 640;
      },
      apiClient: {
        async submitMessage(selectedTopicId, text) {
          assert.equal(selectedTopicId, topicId);
          assert.equal(text, "Nuevo comentario");
          return {
            viewer: { id: "u1", type: "registered" },
            users,
            topics: updatedTopics,
            selectedTopicId
          };
        }
      }
    });

    await actions.submitMessage({ preventDefault() {} });

    assert.equal(messageInput.value, "");
    assert.equal(messageStream.scrollTop, 640);
    assert.deepEqual(state.unreadTopicIds, []);
    assert.equal(renderCalls >= 2, true);
  });

  await test("submitting a comment updates the topic in place without reordering the topics list", async () => {
    const users = buildUsers(initialUsers);
    const topics = buildTopics(topicSeedData, users, 1_700_000_000_000);
    const originalOrder = topics.map((topic) => topic.id);
    const topicId = topics[1].id;
    const submittedMessage = createMessage("u1", "Nuevo comentario", 0, "user", 1_700_000_060_000);
    // Mirrors the backend, which returns the commented topic bumped to the front
    // (ordered by updated_at DESC) whenever a message is submitted.
    const reorderedTopics = reviveTopicWithMessage(topics, topicId, submittedMessage);
    assert.equal(reorderedTopics[0].id, topicId, "sanity check: the backend payload reorders topics");

    const state = {
      viewer: { id: "u1", type: "registered" },
      topics,
      users,
      currentUserId: "u1",
      selectedTopicId: topicId,
      unreadTopicIds: [],
      refreshCount: 0
    };
    const actions = createChatActions({
      state,
      dom: {
        messageInput: { value: "Nuevo comentario", readOnly: false },
        messageStream: { scrollTop: 0, scrollHeight: 320 }
      },
      render: () => {},
      apiClient: {
        async submitMessage(selectedTopicId) {
          return {
            viewer: { id: "u1", type: "registered" },
            users,
            topics: reorderedTopics,
            selectedTopicId
          };
        }
      }
    });

    await actions.submitMessage({ preventDefault() {} });

    assert.deepEqual(state.topics.map((topic) => topic.id), originalOrder);
    const updatedTopic = state.topics.find((topic) => topic.id === topicId);
    assert.equal(updatedTopic.messages.at(-1).id, submittedMessage.id);
  });

  await test("create topic action opens the composer view on mobile", () => {
    const state = {
      selectedTopicId: "topic-1",
      mobileView: "browse",
      topics: [],
      users: [],
      unreadTopicIds: [],
      followedTopicIds: []
    };
    const topicTitleInput = { value: "Titulo anterior", focus() {} };
    const messageInput = { value: "Mensaje anterior" };
    let renderCalls = 0;
    let responsiveSyncCalls = 0;
    const actions = createChatActions({
      state,
      dom: {
        topicTitleInput,
        messageInput
      },
      render: () => {
        renderCalls += 1;
      },
      isMobileViewport: () => true,
      syncResponsiveView: () => {
        responsiveSyncCalls += 1;
      }
    });

    actions.createNewTopic();

    assert.equal(state.selectedTopicId, null);
    assert.equal(state.mobileView, "chat");
    assert.equal(topicTitleInput.value, "");
    assert.equal(messageInput.value, "");
    assert.equal(responsiveSyncCalls, 1);
    assert.equal(renderCalls, 1);
  });
  await test("report action hydrates reported topic and message ids from backend payloads", async () => {
    const users = buildUsers(initialUsers);
    const topics = buildTopics(topicSeedData, users, 1_700_000_000_000);
    const topicId = topics[0].id;
    const messageId = topics[0].messages[0].id;
    const state = {
      viewer: { id: "u1", type: "registered" },
      reportedTopicIds: [],
      reportedMessageIds: [],
      topics,
      users,
      currentUserId: "u1",
      selectedTopicId: topicId,
      refreshCount: 0
    };
    let renderCalls = 0;
    const actions = createChatActions({
      state,
      dom: {},
      render: () => {
        renderCalls += 1;
      },
      apiClient: {
        async reportEntity(entityType, entityId, reason, selectedTopicId) {
          return {
            viewer: { id: "u1", type: "registered" },
            users,
            topics,
            selectedTopicId,
            reportedTopicIds: entityType === "topic" ? [entityId] : [topicId],
            reportedMessageIds: entityType === "message" ? [entityId] : []
          };
        }
      }
    });

    await actions.reportEntity("topic", topicId, { reason: "Tema" });
    assert.deepEqual(state.reportedTopicIds, [topicId]);

    await actions.reportEntity("message", messageId, { reason: "Mensaje" });
    assert.deepEqual(state.reportedMessageIds, [messageId]);
    assert.equal(renderCalls >= 2, true);
  });

  await test("composeReportReason combines a preset reason with optional extra detail", () => {
    assert.equal(composeReportReason("spam", ""), "Spam o publicidad");
    assert.equal(composeReportReason("spam", "   "), "Spam o publicidad");
    assert.equal(
      composeReportReason("spam", "Ademas insulta a otros usuarios"),
      "Spam o publicidad: Ademas insulta a otros usuarios"
    );
    assert.equal(composeReportReason("other", "  Explicacion libre  "), "Explicacion libre");
    assert.equal(composeReportReason("other", ""), "");
    assert.equal(composeReportReason("not-a-real-reason", "texto"), "");
    assert.equal(REPORT_REASONS.some((reason) => reason.value === "other"), true);
  });

  await test("openReportModal then submitReportModal composes the reason and reports the entity", async () => {
    const users = buildUsers(initialUsers);
    const topics = buildTopics(topicSeedData, users, 1_700_000_000_000);
    const topicId = topics[0].id;
    const messageId = topics[0].messages[0].id;
    const state = {
      viewer: { id: "u1", type: "registered" },
      reportedTopicIds: [],
      reportedMessageIds: [],
      reportModal: { isOpen: false, entityType: null, entityId: null },
      topics,
      users,
      currentUserId: "u1",
      selectedTopicId: topicId,
      refreshCount: 0
    };
    let capturedReason = null;
    const actions = createChatActions({
      state,
      dom: {},
      render: () => {},
      apiClient: {
        async reportEntity(entityType, entityId, reason, selectedTopicId) {
          capturedReason = reason;
          return {
            viewer: { id: "u1", type: "registered" },
            users,
            topics,
            selectedTopicId,
            reportedTopicIds: [],
            reportedMessageIds: entityType === "message" ? [entityId] : []
          };
        }
      }
    });

    actions.openReportModal("message", messageId, { trigger: null });
    assert.deepEqual(state.reportModal, { isOpen: true, entityType: "message", entityId: messageId });

    await actions.submitReportModal("spam", "Ademas es reincidente");
    assert.equal(capturedReason, "Spam o publicidad: Ademas es reincidente");
    assert.deepEqual(state.reportedMessageIds, [messageId]);
    assert.equal(state.reportModal.isOpen, false);
  });

  await test("submitReportModal requires custom text when 'other' is selected without one", async () => {
    const users = buildUsers(initialUsers);
    const topics = buildTopics(topicSeedData, users, 1_700_000_000_000);
    const messageId = topics[0].messages[0].id;
    const state = {
      viewer: { id: "u1", type: "registered" },
      reportedTopicIds: [],
      reportedMessageIds: [],
      reportModal: { isOpen: false, entityType: null, entityId: null },
      topics,
      users,
      currentUserId: "u1",
      selectedTopicId: topics[0].id,
      refreshCount: 0
    };
    let reportCalled = false;
    const actions = createChatActions({
      state,
      dom: {},
      render: () => {},
      apiClient: {
        async reportEntity() {
          reportCalled = true;
          return { viewer: { id: "u1", type: "registered" }, users, topics, reportedMessageIds: [] };
        }
      }
    });

    actions.openReportModal("message", messageId, { trigger: null });
    await actions.submitReportModal("other", "   ");

    assert.equal(reportCalled, false);
    assert.equal(state.reportModal.isOpen, true);
  });

  await test("syncResponsiveView closes mobile drawers when returning to desktop", () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;

    const rootClassList = createClassList();
    const rootStyle = {
      setProperty() {}
    };
    const createDrawer = () => {
      const values = new Set(["is-open", "is-closing"]);
      const attributes = new Map();
      return {
        classList: {
          add(...tokens) {
            tokens.forEach((token) => values.add(token));
          },
          remove(...tokens) {
            tokens.forEach((token) => values.delete(token));
          },
          contains(token) {
            return values.has(token);
          }
        },
        setAttribute(name, value) {
          attributes.set(name, value);
        },
        getAttribute(name) {
          return attributes.get(name);
        }
      };
    };

    try {
      globalThis.window = {
        matchMedia() {
          return { matches: false };
        }
      };
      globalThis.document = {
        documentElement: {
          classList: rootClassList,
          style: rootStyle
        }
      };

      const shell = { dataset: {} };
      const leftDrawer = createDrawer();
      const rightDrawer = createDrawer();
      const drawerBackdrop = { hidden: false };
      const state = { mobileView: "chat" };
      const responsive = createResponsiveHelpers({
        state,
        dom: {
          shell,
          leftDrawer,
          rightDrawer,
          drawerBackdrop,
          topbar: null
        }
      });

      responsive.syncResponsiveView();

      assert.equal(state.mobileView, "browse");
      assert.equal(shell.dataset.mobileView, "desktop");
      assert.equal(rootClassList.contains("is-mobile-viewport"), false);
      assert.equal(rootClassList.contains("is-desktop-viewport"), true);
      assert.equal(leftDrawer.classList.contains("is-open"), false);
      assert.equal(leftDrawer.classList.contains("is-closing"), false);
      assert.equal(rightDrawer.classList.contains("is-open"), false);
      assert.equal(rightDrawer.classList.contains("is-closing"), false);
      assert.equal(leftDrawer.getAttribute("aria-hidden"), "true");
      assert.equal(rightDrawer.getAttribute("aria-hidden"), "true");
      assert.equal(drawerBackdrop.hidden, true);
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }
  });

  await test("resize handler rerenders when viewport mode changes", () => {
    const previousDocument = globalThis.document;
    const rootClassList = createClassList();
    rootClassList.add("is-mobile-viewport");
    let renderCalls = 0;
    let closeDrawerCalls = 0;
    let rankingSyncCalls = 0;

    try {
      globalThis.document = {
        documentElement: {
          classList: rootClassList
        }
      };

      const handleResize = createResizeHandler({
        responsive: {
          isMobileViewport() {
            return false;
          },
          syncResponsiveView() {
            rootClassList.remove("is-mobile-viewport");
            rootClassList.add("is-desktop-viewport");
            return false;
          },
          updateLayoutMetrics() {}
        },
        render() {
          renderCalls += 1;
        },
        actions: {
          closeDrawers() {
            closeDrawerCalls += 1;
          }
        },
        syncRankingListHeights() {
          rankingSyncCalls += 1;
        }
      });

      handleResize();

      assert.equal(renderCalls, 1);
      assert.equal(closeDrawerCalls, 1);
      assert.equal(rankingSyncCalls, 0);
    } finally {
      globalThis.document = previousDocument;
    }
  });

  await test("resize handler only syncs ranking heights when viewport mode stays the same", () => {
    const previousDocument = globalThis.document;
    const rootClassList = createClassList();
    rootClassList.add("is-desktop-viewport");
    let renderCalls = 0;
    let closeDrawerCalls = 0;
    let rankingSyncCalls = 0;

    try {
      globalThis.document = {
        documentElement: {
          classList: rootClassList
        }
      };

      const handleResize = createResizeHandler({
        responsive: {
          isMobileViewport() {
            return false;
          },
          syncResponsiveView() {
            return false;
          },
          updateLayoutMetrics() {}
        },
        render() {
          renderCalls += 1;
        },
        actions: {
          closeDrawers() {
            closeDrawerCalls += 1;
          }
        },
        syncRankingListHeights() {
          rankingSyncCalls += 1;
        }
      });

      handleResize();

      assert.equal(renderCalls, 0);
      assert.equal(closeDrawerCalls, 0);
      assert.equal(rankingSyncCalls, 1);
    } finally {
      globalThis.document = previousDocument;
    }
  });

  await test("chat render helpers only autoscroll when topic changes or a new tail message arrives near the bottom", () => {
    const previousState = {
      topicId: "topic-1",
      messageCount: 30,
      lastMessageId: "m30",
      width: 420
    };

    assert.equal(
      shouldScrollChatToBottom(previousState, { ...previousState, topicId: "topic-2" }, false),
      true
    );
    assert.equal(
      shouldScrollChatToBottom(previousState, { ...previousState, lastMessageId: "m31" }, true),
      true
    );
    assert.equal(
      shouldScrollChatToBottom(previousState, { ...previousState, lastMessageId: "m31" }, false),
      false
    );
    assert.equal(shouldScrollChatToBottom(previousState, { ...previousState }, true), false);
  });

  await test("chat layout helper only recalculates when rendered content or width changes", () => {
    const previousState = {
      topicId: "topic-1",
      messageCount: 30,
      lastMessageId: "m30",
      width: 420
    };

    assert.equal(shouldSyncChatLayout(previousState, { ...previousState }), false);
    assert.equal(shouldSyncChatLayout(previousState, { ...previousState, width: 440 }), true);
    assert.equal(
      shouldSyncChatLayout(previousState, { ...previousState, lastMessageId: "m31" }),
      true
    );
    assert.equal(
      shouldSyncChatLayout(previousState, { ...previousState, topicId: "topic-2" }),
      true
    );
  });

  await test("ranking builders summarise activity and handle empty topics", () => {
    const users = buildUsers(initialUsers);
    const topics = buildTopics(topicSeedData, users, 1_700_000_000_000);

    const postComments = buildPostRankingEntries(topics, users, "u1", "comments");
    const postLikes = buildPostRankingEntries(topics, users, "u1", "likes");
    const userComments = buildUserRankingEntries(topics, users, "u1", "comments");
    const userLikes = buildUserRankingEntries(topics, users, "u1", "likes");

    assert.equal(postComments.length, Math.min(topics.length, 10));
    assert.equal(postLikes.length, Math.min(topics.length, 10));
    assert.equal(userComments.length, Math.min(users.length, 10));
    assert.equal(userLikes.length, Math.min(users.length, 10));
    assert.ok(postComments[0].count >= postComments[1].count);
    assert.ok(postLikes[0].count >= postLikes[1].count);
    assert.ok(userComments[0].count >= userComments[1].count);
    assert.ok(userLikes[0].count >= userLikes[1].count);
    assert.equal(formatCommentCount(1), "1 comentario");
    assert.equal(formatCommentCount(2), "2 comentarios");
  });

  await test("ranking state helpers keep indices isolated per scope", () => {
    const state = {
      rankingScope: "global",
      globalRankingIndex: 0,
      topicRankingIndex: 1
    };

    assert.equal(GLOBAL_RANKING_STEPS.length, 4);
    assert.equal(TOPIC_RANKING_STEPS.length, 2);
    assert.equal(getActiveRankingIndex(state), 0);
    assert.deepEqual(getActiveRankingStep(state), {
      type: "posts",
      metric: "comments",
      index: 0
    });

    setStoredRankingIndex(state, 6);
    assert.equal(state.globalRankingIndex, 2);
    assert.deepEqual(getActiveRankingStep(state), {
      type: "users",
      metric: "comments",
      index: 2
    });

    state.rankingScope = "topic";
    assert.equal(getActiveRankingIndex(state), 1);
    assert.deepEqual(getActiveRankingStep(state), {
      type: "users",
      metric: "likes",
      index: 1
    });

    setStoredRankingIndex(state, -1);
    assert.equal(state.topicRankingIndex, 1);

    state.rankingScope = "global";
    assert.equal(state.globalRankingIndex, 2);
    assert.deepEqual(getActiveRankingStep(state), {
      type: "users",
      metric: "comments",
      index: 2
    });
  });

  await test("palette registry exposes five selectable options", () => {
    assert.equal(DEFAULT_PALETTE_ID, "default");
    assert.equal(CUSTOM_PALETTE_ID, "custom");
    assert.equal(PALETTE_OPTIONS.length, 5);
    assert.equal(PALETTE_OPTIONS[0].id, DEFAULT_PALETTE_ID);
    assert.deepEqual(
      PALETTE_OPTIONS.map((option) => option.name),
      ["Default", "Turquesa", "Bosque", "Terracota", "Azul"]
    );
    assert.equal(PALETTE_OPTIONS[1].previews.light.surface, "rgba(197, 221, 226, 0.95)");
    assert.equal(PALETTE_OPTIONS[4].previews.light.surface, "rgba(199, 210, 232, 0.95)");
    assert.equal(isPaletteId("coast"), true);
    assert.equal(isPaletteId(CUSTOM_PALETTE_ID), true);
    assert.equal(isPaletteId("missing"), false);
  });

  await test("custom palette builder normalizes hex and derives both previews", () => {
    const customPalette = buildCustomPaletteOption("4a90e2");
    const lightVars = getCustomPaletteVars("#4A90E2", "light");

    assert.equal(customPalette.id, CUSTOM_PALETTE_ID);
    assert.equal(customPalette.name, "Personalizada");
    assert.equal(customPalette.hex, "#4A90E2");
    assert.equal(customPalette.previews.light.accent.startsWith("#"), true);
    assert.equal(customPalette.previews.dark.accent.startsWith("#"), true);
    assert.notEqual(customPalette.previews.light.bg, "#F5EFE5");
    assert.notEqual(customPalette.previews.light.bg, customPalette.previews.dark.bg);
    assert.notEqual(customPalette.previews.light.surface, "rgba(255, 251, 245, 0.96)");
    assert.notEqual(customPalette.previews.light.surface, customPalette.previews.dark.surface);
    assert.match(customPalette.previews.light.surface, /0\.95\)$/);
    assert.match(lightVars["--surface"], /0\.86\)$/);
    assert.match(lightVars["--surface-muted"], /0\.72\)$/);
    assert.match(lightVars["--line-strong"], /0\.38\)$/);
    assert.equal(normalizeHexColor("#abc"), "#AABBCC");
    assert.equal(parseHexColor("#4a90e2"), "#4A90E2");
    assert.equal(parseHexColor("zzz"), null);
    assert.equal(
      normalizeHexColor("invalid", DEFAULT_CUSTOM_PALETTE_HEX),
      DEFAULT_CUSTOM_PALETTE_HEX
    );
  });

  await test("custom palette stylesheet css contains app vars and modal preview vars", () => {
    const cssText = buildCustomPaletteStylesheetCss("4a90e2");

    assert.match(cssText, /html\[data-theme="light"\]\[data-palette="custom"\]/);
    assert.match(cssText, /html\[data-theme="dark"\]\[data-palette="custom"\]/);
    assert.match(cssText, /--palette-custom-preview: #4A90E2;/);
    assert.match(cssText, /\.palette-option__mode\[data-mode="light"\]/);
    assert.match(cssText, /--palette-preview-accent:/);
  });

  await test("applyStoredTheme restores theme and palette from storage", () => {
    const previousLocalStorage = globalThis.localStorage;
    const previousDocument = globalThis.document;
    const appliedStyle = new Map();
    const state = {
      theme: "light",
      paletteId: DEFAULT_PALETTE_ID,
      customPaletteHex: DEFAULT_CUSTOM_PALETTE_HEX
    };

    try {
      globalThis.localStorage = {
        getItem(key) {
          if (key === "topykly-theme") {
            return "dark";
          }
          if (key === "topykly-palette") {
            return "coast";
          }
          return null;
        }
      };
      globalThis.document = createMockDocumentWithFavicon(appliedStyle);

      applyStoredTheme(state);

      assert.equal(state.theme, "dark");
      assert.equal(state.paletteId, "coast");
      assert.equal(state.customPaletteHex, DEFAULT_CUSTOM_PALETTE_HEX);
      assert.equal(document.documentElement.dataset.theme, "dark");
      assert.equal(document.documentElement.dataset.palette, "coast");
      assert.match(document.querySelector("link[rel*='icon']").href, /^data:image\/svg\+xml/);
      assert.equal(appliedStyle.size, 0);
    } finally {
      globalThis.localStorage = previousLocalStorage;
      globalThis.document = previousDocument;
    }
  });

  await test("applyStoredTheme falls back to dark default palette without storage", () => {
    const previousLocalStorage = globalThis.localStorage;
    const previousDocument = globalThis.document;
    const appliedStyle = new Map();
    const state = {
      theme: "light",
      paletteId: "coast",
      customPaletteHex: "#123456"
    };

    try {
      globalThis.localStorage = {
        getItem() {
          return null;
        }
      };
      globalThis.document = createMockDocumentWithFavicon(appliedStyle);

      applyStoredTheme(state);

      assert.equal(state.theme, "dark");
      assert.equal(state.paletteId, DEFAULT_PALETTE_ID);
      assert.equal(state.customPaletteHex, DEFAULT_CUSTOM_PALETTE_HEX);
      assert.equal(document.documentElement.dataset.theme, "dark");
      assert.equal(document.documentElement.dataset.palette, DEFAULT_PALETTE_ID);
      assert.match(document.querySelector("link[rel*='icon']").href, /^data:image\/svg\+xml/);
      assert.equal(appliedStyle.size, 0);
    } finally {
      globalThis.localStorage = previousLocalStorage;
      globalThis.document = previousDocument;
    }
  });

  await test("applyStoredTheme reapplies custom palette vars from storage", () => {
    const previousLocalStorage = globalThis.localStorage;
    const previousDocument = globalThis.document;
    const appliedStyle = new Map();
    const state = {
      theme: "light",
      paletteId: DEFAULT_PALETTE_ID,
      customPaletteHex: DEFAULT_CUSTOM_PALETTE_HEX
    };

    try {
      globalThis.localStorage = {
        getItem(key) {
          if (key === "topykly-theme") {
            return "dark";
          }
          if (key === "topykly-palette") {
            return CUSTOM_PALETTE_ID;
          }
          if (key === "topykly-custom-palette-hex") {
            return "#4A90E2";
          }
          return null;
        }
      };
      globalThis.document = createMockDocumentWithFavicon(appliedStyle);

      applyStoredTheme(state);

      assert.equal(state.theme, "dark");
      assert.equal(state.paletteId, CUSTOM_PALETTE_ID);
      assert.equal(state.customPaletteHex, "#4A90E2");
      assert.equal(document.documentElement.dataset.palette, CUSTOM_PALETTE_ID);
      const customStylesheet = document.querySelector("#customPaletteStylesheet");
      assert.match(document.querySelector("link[rel*='icon']").href, /^data:image\/svg\+xml/);
      assert.equal(appliedStyle.size, 0);
      assert.equal(customStylesheet.tagName, "style");
      assert.match(customStylesheet.textContent, /html\[data-theme="dark"\]\[data-palette="custom"\]/);
      assert.match(customStylesheet.dataset.paletteCssSignature, /html\[data-theme="dark"\]\[data-palette="custom"\]/);
      assert.match(customStylesheet.dataset.paletteCssSignature, /--accent:/);
    } finally {
      globalThis.localStorage = previousLocalStorage;
      globalThis.document = previousDocument;
    }
  });

  await test("custom palette live updates can skip modal rerender while dragging picker", () => {
    const previousDocument = globalThis.document;
    const previousLocalStorage = globalThis.localStorage;
    const appliedStyle = new Map();
    let renderCount = 0;

    const hexInput = {
      value: "#B25B33",
      defaultValue: "#B25B33",
      dataset: {}
    };
    const pickerInput = {
      value: "#B25B33",
      dataset: {}
    };
    const state = {
      theme: "light",
      paletteId: CUSTOM_PALETTE_ID,
      customPaletteHex: "#B25B33",
      rankingScope: "global",
      rankingIndices: { global: 0, topic: 0 },
      topics: [],
      users: [],
      selectedTopicId: null,
      currentUserId: "user-1",
      refreshCount: 0,
      isPaletteModalOpen: true
    };

    const dom = {
      refreshButton: null,
      paletteOptionGrid: {
        querySelector() {
          return null;
        },
        querySelectorAll(selector) {
          if (selector === "[data-custom-palette-hex]") {
            return [hexInput];
          }
          if (selector === "[data-custom-palette-picker]") {
            return [pickerInput];
          }
          return [];
        }
      }
    };

    try {
      globalThis.localStorage = {
        setItem() {}
      };
      globalThis.document = createMockDocumentWithFavicon(appliedStyle);

      const handlers = createActionHandlers({
        state,
        dom,
        renderRef: {
          current() {
            renderCount += 1;
          }
        },
        syncResponsiveView() {},
        isMobileViewport() {
          return false;
        },
        closeDrawers() {}
      });

      const applied = handlers.updateCustomPaletteHex("#4A90E2", { render: false, focus: false });

      assert.equal(applied, true);
      assert.equal(renderCount, 0);
      assert.equal(state.customPaletteHex, "#4A90E2");
      assert.equal(state.paletteId, CUSTOM_PALETTE_ID);
      assert.equal(hexInput.value, "#4A90E2");
      assert.equal(hexInput.defaultValue, "#4A90E2");
      assert.equal(hexInput.dataset.lastValid, "#4A90E2");
      assert.equal(pickerInput.value, "#4A90E2");
      assert.equal(appliedStyle.size, 0);
      assert.match(document.querySelector("#customPaletteStylesheet").textContent, /--palette-custom-preview: #4A90E2;/);
      assert.match(
        document.querySelector("#customPaletteStylesheet").dataset.paletteCssSignature,
        /--palette-custom-preview: #4A90E2;/
      );
    } finally {
      globalThis.document = previousDocument;
      globalThis.localStorage = previousLocalStorage;
    }
  });

  await test("custom palette hex input updates live without rerendering the modal", async () => {
    const topbarActionEvents = await read("ui/topbar-action-events.js");
    const palettePickerEvents = await read("ui/palette-picker-events.js");
    const actions = await read("controller-actions.js");

    assert.match(
      topbarActionEvents,
      /handlers\.updateCustomPaletteHex\(nextValue, \{ render: false, focus: false \}\)/
    );
    assert.match(
      palettePickerEvents,
      /handlers\.updateCustomPaletteHex\(nextValue, \{ render: false, focus: false \}\)/
    );
    assert.match(actions, /const activeElement = typeof document !== "undefined" \? document\.activeElement : null;/);
    assert.match(actions, /input === activeElement/);
    assert.match(topbarActionEvents, /hexInputTarget\.focus\(\);/);
    assert.match(palettePickerEvents, /hexInputTarget\.focus\(\);/);
    assert.match(topbarActionEvents, /function isCustomPickerEventTarget/);
    assert.match(palettePickerEvents, /function isCustomPickerEventTarget/);
    assert.match(topbarActionEvents, /document\.addEventListener\("pointerdown",/);
    assert.match(topbarActionEvents, /pickerPointerStartedInside = isCustomPickerEventTarget\(event\.target\);/);
    assert.match(topbarActionEvents, /pickerIsOpen && !pickerPointerStartedInside && !isCustomPickerEventTarget\(event\.target\)/);
    assert.match(palettePickerEvents, /handleDocumentPointerDown/);
  });
  await test("connected user activation stores selected card", () => {
    const state = {
      theme: "light",
      paletteId: DEFAULT_PALETTE_ID,
      customPaletteHex: DEFAULT_CUSTOM_PALETTE_HEX,
      isPaletteModalOpen: false,
      selectedTopicId: null,
      rankingScope: "global",
      globalRankingIndex: 0,
      topicRankingIndex: 0,
      refreshCount: 0,
      mobileView: "browse",
      currentUserId: "u1",
      activeConnectedUserId: null,
      topics: [],
      users: [{ id: "u1", name: "Coco Mora", online: true }]
    };

    let renderCount = 0;
    const handlers = createActionHandlers({
      state,
      dom: {
        refreshButton: null,
        paletteOptionGrid: null
      },
      renderRef: {
        current() {
          renderCount += 1;
        }
      },
      syncResponsiveView() {},
      isMobileViewport() {
        return false;
      },
      closeDrawers() {}
    });

    handlers.activateConnectedUser("u1");

    assert.equal(state.activeConnectedUserId, "u1");
    assert.equal(state.feedback?.message, undefined);
    assert.equal(renderCount, 1);
  });

  await test("notifications and friend requests panels never stay open at the same time", () => {
    const state = {
      isNotificationsPanelOpen: false,
      isFriendRequestsPanelOpen: false,
      friendRequestsTab: "friends",
      friendRequestsLimits: { incoming: 20, outgoing: 10 }
    };

    const handlers = createActionHandlers({
      state,
      dom: {
        refreshButton: null,
        paletteOptionGrid: null
      },
      renderRef: {
        current() {}
      },
      syncResponsiveView() {},
      isMobileViewport() {
        return false;
      },
      closeDrawers() {}
    });

    handlers.toggleNotificationsPanel();
    assert.equal(state.isNotificationsPanelOpen, true);

    handlers.toggleFriendRequestsPanel();
    assert.equal(state.isFriendRequestsPanelOpen, true);
    assert.equal(state.isNotificationsPanelOpen, false);
    assert.equal(state.friendRequestsTab, "incoming");

    handlers.toggleNotificationsPanel();
    assert.equal(state.isNotificationsPanelOpen, true);
    assert.equal(state.isFriendRequestsPanelOpen, false);

    handlers.toggleNotificationsPanel();
    assert.equal(state.isNotificationsPanelOpen, false);
    assert.equal(state.isFriendRequestsPanelOpen, false);
  });

  await test("friend requests and notifications panels reuse DOM nodes across live polls", async () => {
    const friendRequests = await read("ui/friend-requests.js");
    const notifications = await read("ui/notifications.js");

    assert.match(friendRequests, /import \{ reconcile \} from "\.\/render-utils\.js";/);
    assert.match(friendRequests, /reconcile\(panel, \[header, tabsContainer, activeSection\]\);/);
    assert.doesNotMatch(friendRequests, /replaceChildren/);
    assert.match(friendRequests, /row\.dataset\.id = String\(user\.id\);/);

    assert.match(notifications, /import \{ reconcile \} from "\.\/render-utils\.js";/);
    assert.match(notifications, /reconcile\(node, \[createNotificationPanelHeader\(\), body\]\);/);
    assert.doesNotMatch(notifications, /replaceChildren/);
  });

  await test("applyAdminAction requires a second confirming click for destructive actions", async () => {
    const state = {
      theme: "dark",
      paletteId: DEFAULT_PALETTE_ID,
      customPaletteHex: DEFAULT_CUSTOM_PALETTE_HEX,
      isPaletteModalOpen: false,
      isAdminPanelOpen: true,
      adminDashboard: { loaded: true, reports: [], pendingAvatars: [] },
      adminConfirmAction: null,
      selectedTopicId: null,
      rankingScope: "global",
      globalRankingIndex: 0,
      topicRankingIndex: 0,
      refreshCount: 0,
      mobileView: "browse",
      currentUserId: "u1",
      topics: [],
      users: []
    };

    let applyCalls = 0;
    const originalApplyModerationAction = versionedApiForControllerActions.applyModerationAction;
    const originalGetAdminDashboard = versionedApiForControllerActions.getAdminDashboard;

    try {
      versionedApiForControllerActions.applyModerationAction = async () => {
        applyCalls += 1;
        return {};
      };
      versionedApiForControllerActions.getAdminDashboard = async () => ({ reports: [], pendingAvatars: [] });

      const handlers = createActionHandlers({
        state,
        dom: { adminPanelButton: null },
        renderRef: { current() {} },
        syncResponsiveView() {},
        isMobileViewport() {
          return false;
        },
        closeDrawers() {}
      });

      await handlers.applyAdminAction("delete_message", "message", "42");
      assert.equal(applyCalls, 0);
      assert.equal(state.adminConfirmAction?.key, "delete_message:message:42");

      await handlers.applyAdminAction("delete_message", "message", "42");
      assert.equal(applyCalls, 1);
      assert.equal(state.adminConfirmAction, null);

      await handlers.applyAdminAction("approve_avatar", "user", "u9");
      assert.equal(applyCalls, 2);
      assert.equal(state.adminConfirmAction, null);
    } finally {
      versionedApiForControllerActions.applyModerationAction = originalApplyModerationAction;
      versionedApiForControllerActions.getAdminDashboard = originalGetAdminDashboard;
    }
  });

  await test("changing topic clears the message composer draft", () => {
    const state = {
      theme: "light",
      paletteId: DEFAULT_PALETTE_ID,
      customPaletteHex: DEFAULT_CUSTOM_PALETTE_HEX,
      isPaletteModalOpen: false,
      selectedTopicId: "topic-1",
      rankingScope: "global",
      globalRankingIndex: 0,
      topicRankingIndex: 0,
      refreshCount: 0,
      mobileView: "browse",
      unreadTopicIds: [],
      followedTopicIds: [],
      currentUserId: "u1",
      activeConnectedUserId: null,
      topics: [
        { id: "topic-1", title: "Uno", messages: [] },
        { id: "topic-2", title: "Dos", messages: [] }
      ],
      users: [{ id: "u1", name: "Coco Mora", online: true }]
    };
    const removedClasses = [];
    const messageInput = {
      value: "> @Sergio\n> Mensaje\n\n",
      scrollTop: 12,
      classList: {
        remove(token) {
          removedClasses.push(token);
        }
      }
    };
    const handlers = createActionHandlers({
      state,
      dom: {
        messageInput,
        refreshButton: null,
        paletteOptionGrid: null
      },
      renderRef: { current() {} },
      syncResponsiveView() {},
      isMobileViewport() {
        return false;
      },
      closeDrawers() {}
    });

    handlers.focusTopic("topic-1");
    assert.equal(messageInput.value, "> @Sergio\n> Mensaje\n\n");

    handlers.focusTopic("topic-2");
    assert.equal(state.selectedTopicId, "topic-2");
    assert.equal(messageInput.value, "");
    assert.equal(messageInput.scrollTop, 0);
    assert.deepEqual(removedClasses, ["is-scrollable"]);
  });
  await test("custom palette picker opens only after Coloris emits open", async () => {
    const topbarActionEvents = await read("ui/topbar-action-events.js");
    const palettePickerEvents = await read("ui/palette-picker-events.js");
    const eventsModule = await read("ui/events.js");

    assert.match(
      topbarActionEvents,
      /pickerInput\.addEventListener\("open", \(\) => \{[\s\S]*setPickerOpenState\(true\);/
    );
    assert.doesNotMatch(
      topbarActionEvents,
      /syncCustomPickerDraft\(committedHex, \{ commit: true \}\);\s*setPickerOpenState\(true\);\s*pickerInput\.focus\(\);/
    );
    assert.doesNotMatch(
      palettePickerEvents,
      /syncCustomPickerDraft\(committedHex, \{ commit: true \}\);\s*setPickerOpenState\(true\);\s*pickerInput\.focus\(\);/
    );
    assert.match(
      eventsModule,
      /const pickerIsOpen = picker instanceof HTMLElement && picker\.classList\.contains\("clr-open"\);/
    );
    assert.doesNotMatch(eventsModule, /pickerMarkedOpen \|\|/);
  });
  await test("palette modal dismiss closes the active Coloris picker first", () => {
    const previousColoris = globalThis.Coloris;
    const previousDocument = globalThis.document;
    const previousElement = globalThis.Element;
    const previousHTMLElement = globalThis.HTMLElement;
    const previousHTMLInputElement = globalThis.HTMLInputElement;
    const previousHTMLButtonElement = globalThis.HTMLButtonElement;

    class FakeElement {
      constructor() {
        this.dataset = {};
        this.listeners = new Map();
      }

      addEventListener(type, listener) {
        this.listeners.set(type, listener);
      }

      dispatch(type, event = {}) {
        this.listeners.get(type)?.({
          preventDefault() {},
          stopImmediatePropagation() {},
          ...event,
          target: event.target || this
        });
      }

      closest() {
        return null;
      }
    }

    class FakeInput extends FakeElement {
      constructor(value) {
        super();
        this.value = value;
        this.defaultValue = value;
      }

      blur() {}
    }

    class FakeButton extends FakeElement {}

    const createTarget = () => new FakeElement();
    const pickerInput = new FakeInput("#4A90E2");
    const closePaletteModalButton = new FakeButton();
    const paletteModalBackdrop = createTarget();
    const paletteOptionGrid = createTarget();
    paletteOptionGrid.querySelector = (selector) =>
      selector === "[data-custom-palette-picker]" ? pickerInput : null;

    const dom = {
      themeToggle: createTarget(),
      refreshButton: createTarget(),
      messageForm: createTarget(),
      profileButton: createTarget(),
      backToTopics: createTarget(),
      contactAdminButton: createTarget(),
      storeButton: createTarget(),
      paletteButton: createTarget(),
      closePaletteModalButton,
      paletteModalBackdrop,
      paletteOptionGrid,
      createTopicButton: createTarget()
    };

    let closeCalls = 0;
    let dismissCalls = 0;

    try {
      globalThis.Element = FakeElement;
      globalThis.HTMLElement = FakeElement;
      globalThis.HTMLInputElement = FakeInput;
      globalThis.HTMLButtonElement = FakeButton;
      globalThis.Coloris = {
        close() {
          closeCalls += 1;
        }
      };
      globalThis.document = {
        documentElement: { dataset: {} },
        addEventListener() {},
        querySelector() {
          return null;
        }
      };

      bindTopbarActionEvents(dom, {
        toggleTheme() {},
        refreshCurrentTopic() {},
        submitMessage() {},
        flashTitle() {},
        backToTopics() {},
        openPaletteModal() {},
        closePaletteModal() {
          dismissCalls += 1;
        },
        updateCustomPaletteHex() {
          return true;
        },
        randomizeCustomPalette() {},
        selectPalette() {},
        createNewTopic() {}
      });

      closePaletteModalButton.dispatch("click");

      assert.equal(closeCalls, 1);
      assert.equal(dismissCalls, 1);
      assert.equal(pickerInput.dataset.pendingCommit, "false");
    } finally {
      globalThis.Coloris = previousColoris;
      globalThis.document = previousDocument;
      globalThis.Element = previousElement;
      globalThis.HTMLElement = previousHTMLElement;
      globalThis.HTMLInputElement = previousHTMLInputElement;
      globalThis.HTMLButtonElement = previousHTMLButtonElement;
    }
  });

  await test("getFaviconDataUrl changes only the favicon background color by palette", () => {
    const darkCoastIcon = decodeURIComponent(getFaviconDataUrl("dark", "coast").split(",")[1]);
    const lightEmberIcon = decodeURIComponent(getFaviconDataUrl("light", "ember").split(",")[1]);
    const customIcon = decodeURIComponent(
      getFaviconDataUrl("light", CUSTOM_PALETTE_ID, "#4A90E2").split(",")[1]
    );
    const customAccent = getCustomPaletteVars("#4A90E2", "light")["--accent"];

    assert.match(darkCoastIcon, /fill="#58a6ac"/i);
    assert.match(darkCoastIcon, /fill="#fff7ef"/i);
    assert.match(darkCoastIcon, /stroke="#fff7ef"/i);
    assert.match(lightEmberIcon, /fill="#a44b45"/i);
    assert.match(lightEmberIcon, /fill="#fff7ef"/i);
    assert.match(lightEmberIcon, /stroke="#fff7ef"/i);
    assert.match(customIcon, new RegExp(`fill="${customAccent}"`, "i"));
    assert.match(customIcon, /stroke="#fff7ef"/i);
  });

  await test("auth status exposes safe OIDC preflight details", () => {
    const req = {
      headers: { host: "127.0.0.1:4173" },
      socket: { encrypted: false }
    };
    const unconfigured = createAuthService({ env: {}, fetchImpl: null }).getStatus(req);

    assert.equal(unconfigured.configured, false);
    assert.equal(unconfigured.redirectUri, "http://127.0.0.1:4173/auth/oidc/callback");
    assert.equal(unconfigured.checks.clientId, false);
    assert.equal(unconfigured.checks.clientSecret, false);
    assert.equal(unconfigured.checks.sessionSecret, false);
    assert.deepEqual(unconfigured.turnstile, { configured: false, siteKey: null });
    assert.deepEqual(unconfigured.emailCode, { configured: false });

    const configured = createAuthService({
      env: {
        TOPYKLY_AUTH_PROVIDER_NAME: "Google",
        TOPYKLY_OIDC_ISSUER: "https://accounts.google.com",
        TOPYKLY_OIDC_CLIENT_ID: "client-id",
        TOPYKLY_OIDC_CLIENT_SECRET: "client-secret",
        TOPYKLY_SESSION_SECRET: "session-secret",
        TOPYKLY_PUBLIC_ORIGIN: "https://topykly.com",
        TOPYKLY_COOKIE_SECURE: "true",
        TOPYKLY_TURNSTILE_SITE_KEY: "site-key",
        TOPYKLY_TURNSTILE_SECRET_KEY: "secret-key",
        TOPYKLY_RESEND_API_KEY: "resend-key",
        TOPYKLY_RESEND_FROM: "TOPYKLY <access@topykly.com>",
        TOPYKLY_TRUST_PROXY: "true"
      },
      fetchImpl() {}
    }).getStatus(req);

    assert.equal(configured.configured, true);
    assert.equal(configured.provider, "Google");
    assert.equal(configured.issuer, "https://accounts.google.com");
    assert.equal(configured.redirectUri, "https://topykly.com/auth/oidc/callback");
    assert.equal(configured.cookieSecure, true);
    assert.deepEqual(configured.turnstile, { configured: true, siteKey: "site-key" });
    assert.deepEqual(configured.emailCode, { configured: true });
    assert.deepEqual(configured.checks, {
      issuer: true,
      clientId: true,
      clientSecret: true,
      sessionSecret: true,
      fetch: true
    });
    assert.equal(Object.prototype.hasOwnProperty.call(configured, "clientSecret"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(configured, "clientId"), false);
  });

  await test("OIDC callback only forwards provider emails marked as verified", async () => {
    async function completeCallback(emailVerified) {
      const authService = createAuthService({
        env: {
          TOPYKLY_OIDC_ISSUER: "https://accounts.google.com",
          TOPYKLY_OIDC_CLIENT_ID: "client-id",
          TOPYKLY_OIDC_CLIENT_SECRET: "client-secret",
          TOPYKLY_SESSION_SECRET: "session-secret",
          TOPYKLY_PUBLIC_ORIGIN: "https://topykly.com"
        },
        async fetchImpl(url) {
          if (String(url).includes(".well-known/openid-configuration")) {
            return {
              ok: true,
              async text() {
                return JSON.stringify({
                  authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
                  token_endpoint: "https://oauth2.googleapis.com/token",
                  userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo"
                });
              }
            };
          }
          if (String(url) === "https://oauth2.googleapis.com/token") {
            return {
              ok: true,
              async text() {
                return JSON.stringify({ access_token: "access-token" });
              }
            };
          }
          return {
            ok: true,
            async text() {
              return JSON.stringify({
                sub: "google-subject",
                email: "person@example.com",
                email_verified: emailVerified,
                name: "Abril"
              });
            }
          };
        }
      });
      const req = {
        headers: { host: "127.0.0.1:4173" },
        socket: { encrypted: false }
      };
      const loginResponse = await authService.createLoginResponse({
        req,
        sessionId: "session-oidc-callback"
      });
      const authUrl = new URL(loginResponse.payload.redirectUrl);
      const flowCookie = loginResponse.cookies
        .find((cookie) => cookie.startsWith("topykly_auth_flow="))
        .split(";", 1)[0]
        .slice("topykly_auth_flow=".length);

      return authService.handleCallback({
        req,
        cookies: { topykly_auth_flow: decodeURIComponent(flowCookie) },
        query: {
          code: "authorization-code",
          state: authUrl.searchParams.get("state")
        }
      });
    }

    const verified = await completeCallback(true);
    const unverified = await completeCallback(false);

    assert.equal(verified.identity.email, "person@example.com");
    assert.equal(verified.identity.emailVerified, true);
    assert.equal(unverified.identity.email, null);
    assert.equal(unverified.identity.emailVerified, false);
  });

  await test("auth service sends one-time access codes through Resend", async () => {
    const calls = [];
    const authService = createAuthService({
      env: {
        TOPYKLY_RESEND_API_KEY: "resend-key",
        TOPYKLY_RESEND_FROM: "TOPYKLY <access@topykly.com>"
      },
      async fetchImpl(url, options) {
        calls.push({ url, options });
        return {
          ok: true,
          async text() {
            return JSON.stringify({ id: "email-resend-1" });
          }
        };
      }
    });

    const result = await authService.sendEmailCode({
      email: "person@example.com",
      code: "123456",
      challengeId: "email-code-challenge-1"
    });
    const body = JSON.parse(calls[0].options.body);

    assert.deepEqual(result, { id: "email-resend-1" });
    assert.equal(calls[0].url, "https://api.resend.com/emails");
    assert.equal(calls[0].options.headers.Authorization, "Bearer resend-key");
    assert.equal(calls[0].options.headers["Idempotency-Key"], "email-code-challenge-1");
    assert.deepEqual(body.to, ["person@example.com"]);
    assert.match(body.subject, /Confirma tu cuenta/);
    assert.match(body.text, /123456/);
    assert.match(body.html, /123456/);
    assert.match(body.html, /TOPYKLY/);
    assert.match(body.html, /No se creó ninguna cuenta/);
  });

  await test("auth service recovery emails use the password reset copy", async () => {
    const calls = [];
    const authService = createAuthService({
      env: {
        TOPYKLY_RESEND_API_KEY: "resend-key",
        TOPYKLY_RESEND_FROM: "TOPYKLY <access@topykly.com>"
      },
      async fetchImpl(url, options) {
        calls.push({ url, options });
        return {
          ok: true,
          async text() {
            return JSON.stringify({ id: "email-resend-2" });
          }
        };
      }
    });

    await authService.sendEmailCode({
      email: "person@example.com",
      code: "654321",
      challengeId: "password-reset-challenge-1",
      purpose: "password_reset"
    });
    const body = JSON.parse(calls[0].options.body);

    assert.match(body.subject, /Recupera tu cuenta/);
    assert.match(body.text, /cambiar tu contrasena/);
    assert.match(body.text, /Tu contraseña no cambió/);
    assert.match(body.html, /Tu contraseña no cambió/);
    assert.equal(body.html.includes("No se creó ninguna cuenta"), false);

    await assert.rejects(
      authService.sendEmailCode({
        email: "person@example.com",
        code: "654321",
        purpose: "unknown"
      }),
      (error) => error.code === "INVALID_EMAIL_CODE_PURPOSE"
    );
  });

  await test("preview server disables local dev login in production", () => {
    assert.equal(isLocalDevLoginAllowed({}), true);
    assert.equal(isLocalDevLoginAllowed({ NODE_ENV: "development" }), true);
    assert.equal(isLocalDevLoginAllowed({ NODE_ENV: "production" }), false);
    assert.equal(isLocalDevLoginAllowed({ TOPYKLY_ALLOW_LOCAL_LOGIN: "false" }), false);
  });

  await test("preview server ignores spoofed IP headers unless proxy trust is enabled", () => {
    const req = {
      headers: {
        "cf-connecting-ip": "203.0.113.8",
        "x-forwarded-for": "198.51.100.7, 198.51.100.8"
      },
      socket: { remoteAddress: "127.0.0.1" }
    };

    assert.equal(shouldTrustProxy({}), false);
    assert.equal(shouldTrustProxy({ TOPYKLY_TRUST_PROXY: "true" }), true);
    assert.equal(shouldTrustProxy({ CHETREND_TRUST_PROXY: "1" }), true);
    assert.equal(getRequestIp(req, {}), "127.0.0.1");
    assert.equal(getRequestIp(req, { TOPYKLY_TRUST_PROXY: "false" }), "127.0.0.1");
    assert.equal(getRequestIp(req, { TOPYKLY_TRUST_PROXY: "true" }), "203.0.113.8");
    assert.equal(
      getRequestIp(
        { ...req, headers: { "x-forwarded-for": "198.51.100.7, 198.51.100.8" } },
        { TOPYKLY_TRUST_PROXY: "yes" }
      ),
      "198.51.100.7"
    );
  });

  await test("production headers restrict unused device permissions", async () => {
    const vercelConfig = JSON.parse(await read("vercel.json"));
    const globalHeaders =
      vercelConfig.headers.find((entry) => entry.source === "/(.*)")?.headers || [];
    const permissionsPolicy = globalHeaders.find((header) => header.key === "Permissions-Policy");

    assert.deepEqual(permissionsPolicy, {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()"
    });
  });

  await test("preview auth requires Turnstile, blocks unverified registration and scopes HSTS to production HTTPS", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousVercelEnv = process.env.VERCEL_ENV;
    const previousSessionSecret = process.env.TOPYKLY_SESSION_SECRET;
    const previousTurnstileSiteKey = process.env.TOPYKLY_TURNSTILE_SITE_KEY;
    const previousTurnstileSecretKey = process.env.TOPYKLY_TURNSTILE_SECRET_KEY;
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "topykly-preview-auth-"));
    let preview = null;

    try {
      process.env.NODE_ENV = "production";
      delete process.env.VERCEL_ENV;
      process.env.TOPYKLY_SESSION_SECRET = "test-session-secret";
      process.env.TOPYKLY_TURNSTILE_SITE_KEY = "test-site-key";
      process.env.TOPYKLY_TURNSTILE_SECRET_KEY = "test-secret-key";
      preview = startPreviewServer({
        port: 0,
        host: "127.0.0.1",
        log() {},
        dbPath: path.join(tempDir, "preview.sqlite")
      });
      if (!preview.server.listening) {
        await new Promise((resolve, reject) => {
          preview.server.once("listening", resolve);
          preview.server.once("error", reject);
        });
      }

      const address = preview.server.address();
      const origin = `http://127.0.0.1:${address.port}`;
      const localResponse = await fetch(`${origin}/index.html`);
      assert.equal(localResponse.headers.get("strict-transport-security"), null);
      await localResponse.arrayBuffer();

      const secureResponse = await fetch(`${origin}/index.html`, {
        headers: { "x-forwarded-proto": "https" }
      });
      assert.match(
        secureResponse.headers.get("strict-transport-security") || "",
        /^max-age=31536000; includeSubDomains$/
      );
      await secureResponse.arrayBuffer();

      const googleWithoutTurnstile = await fetch(`${origin}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedTopicId: null })
      });
      const googleWithoutTurnstilePayload = await googleWithoutTurnstile.json();
      assert.equal(googleWithoutTurnstile.status, 403);
      assert.equal(
        googleWithoutTurnstilePayload.error?.code,
        "TURNSTILE_REQUIRED"
      );

      const blockedResponse = await fetch(`${origin}/api/auth/password/register`, {
        method: "POST",
        headers: { "x-forwarded-proto": "https" }
      });
      const blockedPayload = await blockedResponse.json();
      assert.equal(blockedResponse.status, 410);
      assert.equal(
        blockedPayload.error?.code,
        "REGISTRATION_REQUIRES_EMAIL_VERIFICATION"
      );
    } finally {
      if (preview) {
        const closed = new Promise((resolve) => preview.server.once("close", resolve));
        preview.close();
        await closed;
      }
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
      if (previousVercelEnv === undefined) {
        delete process.env.VERCEL_ENV;
      } else {
        process.env.VERCEL_ENV = previousVercelEnv;
      }
      if (previousSessionSecret === undefined) {
        delete process.env.TOPYKLY_SESSION_SECRET;
      } else {
        process.env.TOPYKLY_SESSION_SECRET = previousSessionSecret;
      }
      if (previousTurnstileSiteKey === undefined) {
        delete process.env.TOPYKLY_TURNSTILE_SITE_KEY;
      } else {
        process.env.TOPYKLY_TURNSTILE_SITE_KEY = previousTurnstileSiteKey;
      }
      if (previousTurnstileSecretKey === undefined) {
        delete process.env.TOPYKLY_TURNSTILE_SECRET_KEY;
      } else {
        process.env.TOPYKLY_TURNSTILE_SECRET_KEY = previousTurnstileSecretKey;
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  await test("origin check only restricts cross-origin write requests", () => {
    const baseHeaders = { host: "topykly.local" };

    assert.equal(isRequestOriginAllowed({ method: "GET", headers: baseHeaders }, {}), true);
    assert.equal(isRequestOriginAllowed({ method: "POST", headers: baseHeaders }, {}), true);
    assert.equal(
      isRequestOriginAllowed(
        { method: "POST", headers: { ...baseHeaders, origin: "http://topykly.local" } },
        {}
      ),
      true
    );
    assert.equal(
      isRequestOriginAllowed(
        { method: "POST", headers: { ...baseHeaders, origin: "https://evil.example" } },
        {}
      ),
      false
    );
    assert.equal(
      isRequestOriginAllowed(
        { method: "POST", headers: { ...baseHeaders, origin: "https://topykly.com" } },
        { TOPYKLY_PUBLIC_ORIGIN: "https://topykly.com" }
      ),
      true
    );
    assert.equal(
      isRequestOriginAllowed(
        { method: "POST", headers: { ...baseHeaders, origin: "no-es-una-url" } },
        {}
      ),
      false
    );
  });

  await test("preview server refuses to start in production without session secret", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousSessionSecret = process.env.TOPYKLY_SESSION_SECRET;
    const previousLegacySecret = process.env.CHETREND_SESSION_SECRET;
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "topykly-preview-secret-"));

    try {
      process.env.NODE_ENV = "production";
      process.env.TOPYKLY_SESSION_SECRET = "";
      process.env.CHETREND_SESSION_SECRET = "";

      assert.throws(
        () => startPreviewServer({
          port: 0,
          host: "127.0.0.1",
          log() {},
          dbPath: path.join(tempDir, "preview.sqlite")
        }),
        /TOPYKLY_SESSION_SECRET/
      );
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
      if (previousSessionSecret === undefined) {
        delete process.env.TOPYKLY_SESSION_SECRET;
      } else {
        process.env.TOPYKLY_SESSION_SECRET = previousSessionSecret;
      }
      if (previousLegacySecret === undefined) {
        delete process.env.CHETREND_SESSION_SECRET;
      } else {
        process.env.CHETREND_SESSION_SECRET = previousLegacySecret;
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  await test("preview server removes agent endpoints and blocks internal static files", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "topykly-preview-static-"));
    let preview = null;

    try {
      preview = startPreviewServer({
        port: 0,
        host: "127.0.0.1",
        log() {},
        dbPath: path.join(tempDir, "preview.sqlite")
      });
      if (!preview.server.listening) {
        await new Promise((resolve, reject) => {
          preview.server.once("listening", resolve);
          preview.server.once("error", reject);
        });
      }

      const address = preview.server.address();
      const origin = `http://127.0.0.1:${address.port}`;

      for (const agentPath of ["/api/agents/run", "/api/agents/pause", "/api/agents/status", "/api/agents/decision"]) {
        const response = await fetch(`${origin}${agentPath}`);
        assert.equal(response.status, 404, `${agentPath} should not exist`);
        const payload = await response.json();
        assert.equal(payload.error?.code, "NOT_FOUND");
      }

      for (const blockedPath of [
        "/dashboard.html",
        "/server.err.log",
        "/server.out.log",
        "/task.md",
        "/GEMINI.md",
        "/node_modules/prettier/package.json",
        "/output/playwright/notifications-panel-reconcile.png",
        "/features/shared/components/base.js",
        "/local-server.cjs",
        "/vercel.json"
      ]) {
        const response = await fetch(`${origin}${blockedPath}`);
        assert.equal(response.status, 400, `${blockedPath} should be blocked`);
        await response.arrayBuffer();
      }

      const allowedResponse = await fetch(`${origin}/terms.html`);
      assert.equal(allowedResponse.status, 200);
      await allowedResponse.arrayBuffer();

      const diagnosticsResponse = await fetch(`${origin}/api/diagnostics`);
      assert.equal(diagnosticsResponse.status, 403);
      const diagnosticsPayload = await diagnosticsResponse.json();
      assert.equal(diagnosticsPayload.error?.code, "MODERATOR_REQUIRED");

      const crossOriginResponse = await fetch(`${origin}/api/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
        body: "{}"
      });
      assert.equal(crossOriginResponse.status, 403);
      const crossOriginPayload = await crossOriginResponse.json();
      assert.equal(crossOriginPayload.error?.code, "ORIGIN_NOT_ALLOWED");

      const sameOriginResponse = await fetch(`${origin}/api/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: "{}"
      });
      assert.notEqual(sameOriginResponse.status, 403);
      await sameOriginResponse.arrayBuffer();

      const preflightResponse = await fetch(`${origin}/api/bootstrap`, { method: "OPTIONS" });
      assert.equal(preflightResponse.status, 204);
      assert.equal(preflightResponse.headers.get("access-control-allow-origin"), null);
      await preflightResponse.arrayBuffer();
    } finally {
      if (preview) {
        const closed = new Promise((resolve) => preview.server.once("close", resolve));
        preview.close();
        await closed;
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  await test("seo page helpers escape user content and build stable slugs", () => {
    assert.equal(
      escapeHtml(`<script>alert("x")</script> & 'fin'`),
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;fin&#39;"
    );
    assert.equal(slugify("¿Qué opinan del fútbol argentino?"), "que-opinan-del-futbol-argentino");
    assert.equal(slugify("   ---   "), "");
    assert.equal(slugify("a".repeat(120)).length <= 60, true);
    assert.equal(resolvePublicOrigin({}), "https://topykly.com");
    assert.equal(resolvePublicOrigin({ TOPYKLY_PUBLIC_ORIGIN: "https://example.com/base/" }), "https://example.com");

    const xssTopic = {
      id: "topic-xss",
      title: `<script>alert(1)</script>`,
      createdAt: "2026-07-01T10:00:00.000Z",
      lastActivityAt: "2026-07-02T10:00:00.000Z",
      isExpelled: false,
      isBlocked: false,
      isThin: false,
      author: { name: `<img src=x onerror=alert(2)>`, nickname: null, type: "guest" },
      messages: [
        {
          text: `"><script>alert(3)</script>`,
          kind: "user",
          likes: 2,
          isRoot: true,
          createdAt: "2026-07-01T10:00:00.000Z",
          authorName: "Autor",
          authorNickname: null,
          authorType: "guest"
        }
      ],
      relatedTopics: [{ id: "topic-rel", title: `<b>otro</b>` }],
      commentCount: 4,
      likeCount: 2
    };
    const html = renderTopicPage(xssTopic, { origin: "https://topykly.com" });
    assert.equal(html.includes("<script>alert(1)</script>"), false);
    assert.equal(html.includes("<script>alert(3)</script>"), false);
    assert.equal(html.includes("<img src=x"), false);
    assert.equal(html.includes("<b>otro</b>"), false);
    assert.equal(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), true);
    assert.equal(html.includes(`<link rel="canonical" href="https://topykly.com/tema/topic-xss/script-alert-1-script">`), true);
    assert.equal(html.includes(`"@type":"DiscussionForumPosting"`), true);
    assert.equal(html.includes("\\u003cscript"), true);
  });

  await test("preview server renders crawlable topic pages with canonical redirects", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "topykly-preview-seo-"));
    let preview = null;

    try {
      preview = startPreviewServer({
        port: 0,
        host: "127.0.0.1",
        log() {},
        dbPath: path.join(tempDir, "preview.sqlite")
      });
      if (!preview.server.listening) {
        await new Promise((resolve, reject) => {
          preview.server.once("listening", resolve);
          preview.server.once("error", reject);
        });
      }

      const address = preview.server.address();
      const origin = `http://127.0.0.1:${address.port}`;
      const store = preview.store;

      store.registerWithPassword({
        sessionId: "session-seo-author",
        email: "seo-author@example.com",
        password: "password-segura",
        nickname: "seo_author"
      });
      const created = store.createTopic({
        sessionId: "session-seo-author",
        authMode: "registered",
        title: "El mejor tema de fútbol",
        text: "Un tema para hablar de fútbol con <script>etiquetas</script>."
      });
      const topicId = created.selectedTopicId || created.topics[0].id;

      const redirectResponse = await fetch(`${origin}/tema/${encodeURIComponent(topicId)}`, { redirect: "manual" });
      assert.equal(redirectResponse.status, 301);
      const location = redirectResponse.headers.get("location");
      assert.equal(location, `/tema/${encodeURIComponent(topicId)}/el-mejor-tema-de-futbol`);
      await redirectResponse.arrayBuffer();

      const pageResponse = await fetch(`${origin}${location}`);
      assert.equal(pageResponse.status, 200);
      assert.match(pageResponse.headers.get("content-type") || "", /text\/html/);
      const pageHtml = await pageResponse.text();
      assert.equal(pageHtml.includes("El mejor tema de fútbol"), true);
      assert.equal(pageHtml.includes("<script>etiquetas</script>"), false);
      assert.equal(pageHtml.includes("&lt;script&gt;etiquetas&lt;/script&gt;"), true);
      assert.equal(pageHtml.includes(`<meta name="robots" content="noindex,follow">`), true);
      assert.equal(pageHtml.includes("Abrir en TOPYKLY"), true);

      for (let index = 0; index < 3; index += 1) {
        const commenterSession = `session-seo-commenter-${index}`;
        store.registerWithPassword({
          sessionId: commenterSession,
          email: `seo-commenter-${index}@example.com`,
          password: "password-segura",
          nickname: `seo_com_${index}`
        });
        store.addMessage(topicId, {
          sessionId: commenterSession,
          authMode: "registered",
          text: `Comentario número ${index + 1}`
        });
      }

      const indexableResponse = await fetch(`${origin}${location}`);
      const indexableHtml = await indexableResponse.text();
      assert.equal(indexableHtml.includes(`<meta name="robots" content="index,follow">`), true);
      assert.equal(indexableHtml.includes(`"commentCount":3`), true);

      const hubResponse = await fetch(`${origin}/temas`);
      assert.equal(hubResponse.status, 200);
      const hubHtml = await hubResponse.text();
      assert.equal(hubHtml.includes("El mejor tema de fútbol"), true);
      assert.equal(hubHtml.includes(`<link rel="canonical" href="https://topykly.com/temas">`), true);

      const missingResponse = await fetch(`${origin}/tema/topic-inexistente`);
      assert.equal(missingResponse.status, 404);
      const missingHtml = await missingResponse.text();
      assert.equal(missingHtml.includes(`<meta name="robots" content="noindex,follow">`), true);

      const shellResponse = await fetch(`${origin}/`);
      const shellHtml = await shellResponse.text();
      assert.equal(shellHtml.includes(`<a href="/temas">`), true);
    } finally {
      if (preview) {
        const closed = new Promise((resolve) => preview.server.once("close", resolve));
        preview.close();
        await closed;
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  await test("client auth surface has no direct password registration bypass", async () => {
    const apiSource = await read("services/api.js");
    const actionsSource = await read("controller-actions.js");
    const controllerSource = await read("controller-app.js");

    assert.equal("registerWithPassword" in api, false);
    assert.doesNotMatch(apiSource, /registerWithPassword|\/api\/auth\/password\/register/);
    assert.doesNotMatch(actionsSource, /registerWithPassword/);
    assert.doesNotMatch(controllerSource, /registerWithPassword/);
  });

  await test("fallback Google auth keeps its label stable and reports modal errors", async () => {
    const fallback = await read("auth-fallback.js");

    assert.match(fallback, /button\.disabled = pending/);
    assert.match(fallback, /button\.setAttribute\("aria-busy", String\(pending\)\)/);
    assert.match(fallback, /button\.classList\.toggle\("is-pending", pending\)/);
    assert.match(fallback, /document\.getElementById\("authStatus"\)/);
    assert.doesNotMatch(fallback, /Verificando acceso|actionFeedback/);
    assert.doesNotMatch(fallback, /authGoogleButton[\s\S]*textContent\s*=/);
  });

  await test("auth service validates Turnstile tokens server-side when configured", async () => {
    const req = {
      headers: { host: "127.0.0.1:4173", "cf-connecting-ip": "203.0.113.8" },
      socket: { encrypted: false }
    };
    const calls = [];
    const authService = createAuthService({
      env: {
        TOPYKLY_TURNSTILE_SITE_KEY: "site-key",
        TOPYKLY_TURNSTILE_SECRET_KEY: "secret-key",
        TOPYKLY_TRUST_PROXY: "true"
      },
      async fetchImpl(url, options) {
        calls.push({ url, body: options.body.toString() });
        return {
          ok: true,
          async text() {
            return JSON.stringify({ success: true });
          }
        };
      }
    });

    await assert.rejects(
      () => authService.validateTurnstile({ req, token: "" }),
      (error) => error.code === "TURNSTILE_REQUIRED"
    );

    await authService.validateTurnstile({ req, token: "token-123" });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    assert.match(calls[0].body, /secret=secret-key/);
    assert.match(calls[0].body, /response=token-123/);
    assert.match(calls[0].body, /remoteip=203\.0\.113\.8/);
  });
  await test("auth callback errors resolve to visible feedback messages", () => {
    assert.equal(getAuthErrorFeedbackMessage("access_denied"), "Inicio de sesion cancelado.");
    assert.equal(
      getAuthErrorFeedbackMessage("AUTH_FLOW_EXPIRED"),
      "La solicitud de inicio de sesion expiro. Intentalo de nuevo."
    );
    assert.equal(
      getAuthErrorFeedbackMessage("invalid_auth_callback"),
      "No se pudo validar el inicio de sesion. Intentalo de nuevo."
    );
    assert.equal(
      getAuthErrorFeedbackMessage("unknown_error"),
      "No se pudo completar el inicio de sesion."
    );
  });

  await test("api login redirects through the browser when external auth is configured", async () => {
    const previousFetch = globalThis.fetch;
    const previousWindow = globalThis.window;
    const previousLocalStorage = globalThis.localStorage;

    const storage = new Map();
    let assignedUrl = "";

    try {
      globalThis.localStorage = {
        getItem(key) {
          return storage.has(key) ? storage.get(key) : null;
        },
        setItem(key, value) {
          storage.set(key, value);
        },
        removeItem(key) {
          storage.delete(key);
        }
      };
      globalThis.window = {
        location: {
          origin: "http://127.0.0.1:4173",
          assign(url) {
            assignedUrl = url;
          }
        }
      };
      globalThis.fetch = async () => ({
        ok: true,
        async json() {
          return {
            mode: "redirect",
            redirectUrl: "https://accounts.example.com/oauth/authorize"
          };
        }
      });

      const result = await api.login("topic-1");

      assert.deepEqual(result, { redirected: true });
      assert.equal(assignedUrl, "https://accounts.example.com/oauth/authorize");
      assert.equal(storage.has("topykly-session-id"), false);
      assert.equal(storage.has("chetrend-session-id"), false);
    } finally {
      globalThis.fetch = previousFetch;
      globalThis.window = previousWindow;
      globalThis.localStorage = previousLocalStorage;
    }
  });

  await test("auth button toggles backend login state and syncs the UI mode", async () => {
    const previousLocalStorage = globalThis.localStorage;
    const previousDocument = globalThis.document;
    const previousElement = globalThis.Element;
    const previousHTMLElement = globalThis.HTMLElement;

    class FakeElement {
      constructor() {
        this.dataset = {};
        this.listeners = new Map();
        this.hidden = false;
        this.className = "";
        this.parentElement = null;
        this.textContent = "";
        const classValues = new Set();
        this.classList = {
          add: (...tokens) => tokens.forEach((token) => classValues.add(token)),
          remove: (...tokens) => tokens.forEach((token) => classValues.delete(token)),
          toggle: (token, force) => {
            if (force === undefined) {
              if (classValues.has(token)) {
                classValues.delete(token);
                return false;
              }
              classValues.add(token);
              return true;
            }
            if (force) {
              classValues.add(token);
              return true;
            }
            classValues.delete(token);
            return false;
          },
          contains: (token) => classValues.has(token)
        };
      }

      addEventListener(type, listener) {
        this.listeners.set(type, listener);
      }

      dispatch(type, event = {}) {
        this.listeners.get(type)?.({
          preventDefault() {},
          stopImmediatePropagation() {},
          ...event,
          target: event.target || this
        });
      }

      querySelector(selector) {
        if (selector === ".button-label") {
          return this.label;
        }

        return null;
      }

      focus() {
        if (globalThis.document) {
          globalThis.document.activeElement = this;
        }
      }

      append(child) {
        child.parentElement = this;
        this.firstElementChild = child;
      }

      setAttribute(name, value) {
        this[name] = value;
      }
    }

    const authButton = new FakeElement();
    authButton.label = { textContent: "" };
    const authTools = new FakeElement();
    const themeToggle = new FakeElement();
    const themeToggleDesktopSlot = new FakeElement();
    const themeToggleMobileSlot = new FakeElement();
    const themeToggleDrawerSlot = new FakeElement();
    const flashCalls = [];
    const state = {
      viewer: { id: "guest-auth", type: "guest" }
    };
    let loginCalls = 0;
    let logoutCalls = 0;

    const dom = {
      themeToggle,
      refreshButton: new FakeElement(),
      messageForm: new FakeElement(),
      profileButton: new FakeElement(),
      openRightDrawer: new FakeElement(),
      backToTopics: new FakeElement(),
      storeButton: new FakeElement(),
      paletteButton: new FakeElement(),
      themeToggleDesktopSlot,
      themeToggleMobileSlot,
      themeToggleDrawerSlot,
      closePaletteModalButton: new FakeElement(),
      paletteModalBackdrop: new FakeElement(),
      paletteOptionGrid: new FakeElement(),
      createTopicButton: new FakeElement(),
      friendRequestsButton: new FakeElement(),
      notificationsButton: new FakeElement(),
      authButton,
      authTools,
      authModalBackdrop: new FakeElement(),
      authModal: new FakeElement(),
      authGoogleButton: new FakeElement(),
      authGoogleTermsInput: { checked: true },
      authTurnstile: new FakeElement(),
      authTurnstileToken: { value: "" },
      authPasswordForm: new FakeElement(),
      authLoginModeButton: new FakeElement(),
      authRegisterModeButton: new FakeElement(),
      authNicknameInput: new FakeElement(),
      authEmailInput: new FakeElement(),
      authPasswordInput: new FakeElement(),
      authPasswordButton: new FakeElement(),
      closeAuthModalButton: new FakeElement()
    };

    try {
      globalThis.Element = FakeElement;
      globalThis.HTMLElement = FakeElement;
      globalThis.localStorage = {
        getItem() {
          return null;
        },
        setItem() {}
      };
      globalThis.document = {
        documentElement: { dataset: {} },
        addEventListener() {},
        querySelector() {
          return null;
        }
      };

      bindTopbarActionEvents(dom, {
        toggleTheme() {},
        refreshCurrentTopic() {},
        submitMessage() {},
        flashTitle(message) {
          flashCalls.push(message);
        },
        state,
        async login() {
          loginCalls += 1;
          state.viewer = { id: "u1", type: "registered" };
        },
        async logout() {
          logoutCalls += 1;
          state.viewer = { id: "guest-after-logout", type: "guest" };
        },
        backToTopics() {},
        openPaletteModal() {},
        closePaletteModal() {},
        updateCustomPaletteHex() {
          return true;
        },
        randomizeCustomPalette() {},
        selectPalette() {},
        createNewTopic() {}
      });

      assert.equal(authTools.hidden, true);
      assert.equal(dom.profileButton.hidden, true);
      assert.equal(dom.storeButton.hidden, true);
      assert.equal(dom.openRightDrawer.hidden, false);
      assert.equal(themeToggle.parentElement, themeToggleDesktopSlot);
      assert.equal(themeToggle.dataset.themeTogglePlacement, "desktop");
      assert.equal(authButton.label.textContent, "Iniciar sesión");
      assert.equal(globalThis.document.documentElement.dataset.authState, "logged-out");

      authButton.dispatch("click");
      await flushAsyncEvents();

      assert.equal(dom.authModalBackdrop.hidden, false);
      assert.equal(dom.authModal["aria-hidden"], "false");
      assert.equal(loginCalls, 0);

      dom.authGoogleButton.dispatch("click");
      await flushAsyncEvents();
      await flushAsyncEvents();

      assert.equal(dom.authModalBackdrop.hidden, true);
      assert.equal(authTools.hidden, false);
      assert.equal(dom.profileButton.hidden, false);
      assert.equal(dom.storeButton.hidden, false);
      assert.equal(dom.openRightDrawer.hidden, false);
      assert.equal(authButton.label.textContent, "Cerrar sesión");
      assert.equal(loginCalls, 1);
      assert.equal(state.viewer.type, "registered");
      assert.equal(globalThis.document.documentElement.dataset.authState, "logged-in");
      assert.equal(flashCalls.at(-1), "Sesión iniciada");

      authButton.dispatch("click");
      await flushAsyncEvents();

      assert.equal(logoutCalls, 0);
      assert.equal(state.viewer.type, "registered");
      assert.equal(flashCalls.at(-1), "Toca de nuevo para cerrar sesión");

      authButton.dispatch("click");
      await flushAsyncEvents();

      assert.equal(authTools.hidden, true);
      assert.equal(dom.profileButton.hidden, true);
      assert.equal(dom.storeButton.hidden, true);
      assert.equal(dom.openRightDrawer.hidden, false);
      assert.equal(authButton.label.textContent, "Iniciar sesión");
      assert.equal(logoutCalls, 1);
      assert.equal(state.viewer.type, "guest");
      assert.equal(globalThis.document.documentElement.dataset.authState, "logged-out");
      assert.equal(flashCalls.at(-1), "Sesión cerrada");
    } finally {
      globalThis.localStorage = previousLocalStorage;
      globalThis.document = previousDocument;
      globalThis.Element = previousElement;
      globalThis.HTMLElement = previousHTMLElement;
    }
  });

  await test("email registration validates and navigates credentials, profile and verify steps", async () => {
    const previousDocument = globalThis.document;
    const previousElement = globalThis.Element;
    const previousHTMLElement = globalThis.HTMLElement;
    const previousRequestAnimationFrame = globalThis.requestAnimationFrame;

    class FakeElement {
      constructor() {
        this.dataset = {};
        this.listeners = new Map();
        this.hidden = false;
        this.className = "";
        this.textContent = "";
        this.value = "";
        this.parentElement = null;
        this.classList = createClassList();
      }

      addEventListener(type, listener) {
        this.listeners.set(type, listener);
      }

      dispatch(type, event = {}) {
        this.listeners.get(type)?.({
          preventDefault() {},
          stopImmediatePropagation() {},
          ...event,
          target: event.target || this
        });
      }

      querySelector() {
        return null;
      }

      querySelectorAll() {
        return [];
      }

      append(child) {
        child.parentElement = this;
      }

      focus() {
        if (globalThis.document) {
          globalThis.document.activeElement = this;
        }
      }

      setAttribute(name, value) {
        this[name] = value;
      }
    }

    const state = {
      viewer: { id: "guest-register", type: "guest" },
      selectedTopicId: "topic-original"
    };
    const authButton = new FakeElement();
    authButton.label = { textContent: "" };
    const themeToggle = new FakeElement();
    const themeToggleDesktopSlot = new FakeElement();
    let requestedChallengePayload = null;
    let verifiedPayload = null;

    const dom = {
      themeToggle,
      refreshButton: new FakeElement(),
      messageForm: new FakeElement(),
      profileButton: new FakeElement(),
      openRightDrawer: new FakeElement(),
      backToTopics: new FakeElement(),
      storeButton: new FakeElement(),
      paletteButton: new FakeElement(),
      themeToggleDesktopSlot,
      themeToggleMobileSlot: new FakeElement(),
      themeToggleDrawerSlot: new FakeElement(),
      closePaletteModalButton: new FakeElement(),
      paletteModalBackdrop: new FakeElement(),
      paletteOptionGrid: new FakeElement(),
      createTopicButton: new FakeElement(),
      friendRequestsButton: new FakeElement(),
      notificationsButton: new FakeElement(),
      authButton,
      authTools: new FakeElement(),
      authModalBackdrop: new FakeElement(),
      authModal: new FakeElement(),
      authGoogleButton: new FakeElement(),
      authGoogleTermsInput: { checked: true },
      authTurnstile: new FakeElement(),
      authTurnstileToken: { value: "" },
      authPasswordForm: new FakeElement(),
      authLoginModeButton: new FakeElement(),
      authRegisterModeButton: new FakeElement(),
      authBackButton: new FakeElement(),
      authNicknameInput: new FakeElement(),
      authEmailInput: new FakeElement(),
      authAgeInput: new FakeElement(),
      authPasswordInput: new FakeElement(),
      authTermsField: new FakeElement(),
      authTermsInput: new FakeElement(),
      authCodeInput: new FakeElement(),
      authPasswordButton: new FakeElement(),
      authSendCodeAgainButton: new FakeElement(),
      closeAuthModalButton: new FakeElement()
    };
    dom.authLoginModeButton.dataset.authMode = "login";
    dom.authRegisterModeButton.dataset.authMode = "register";

    try {
      globalThis.Element = FakeElement;
      globalThis.HTMLElement = FakeElement;
      globalThis.requestAnimationFrame = (task) => {
        task();
        return 0;
      };
      globalThis.document = {
        documentElement: { dataset: {} },
        activeElement: null,
        addEventListener() {},
        querySelector() {
          return null;
        }
      };

      bindTopbarActionEvents(dom, {
        state,
        toggleTheme() {},
        refreshCurrentTopic() {},
        submitMessage() {},
        flashTitle() {},
        backToTopics() {},
        openPaletteModal() {},
        closePaletteModal() {},
        updateCustomPaletteHex() {
          return true;
        },
        randomizeCustomPalette() {},
        selectPalette() {},
        createNewTopic() {},
        async getAuthStatus() {
          return { turnstile: { configured: false, siteKey: null } };
        },
        async requestEmailAuthCode(payload) {
          requestedChallengePayload = payload;
          return { challengeId: "email-code-register-topic", email: payload.email };
        },
        async verifyEmailAuthCode(payload) {
          verifiedPayload = payload;
          state.viewer = { id: "u-new", type: "registered" };
          return {
            viewer: state.viewer,
            selectedTopicId: payload.selectedTopicId,
            users: [],
            topics: []
          };
        }
      });

      authButton.dispatch("click");
      await flushAsyncEvents();

      state.selectedTopicId = "topic-after-modal-open";
      dom.authRegisterModeButton.dispatch("click");

      assert.equal(dom.authPasswordForm.dataset.authStep, "credentials");
      assert.equal(dom.authBackButton.hidden, true);

      dom.authEmailInput.value = "email-invalido";
      dom.authPasswordInput.value = "corta";
      dom.authPasswordForm.dispatch("submit");
      await flushAsyncEvents();

      assert.equal(dom.authPasswordForm.dataset.authStep, "credentials");
      assert.equal(requestedChallengePayload, null);
      assert.equal(dom.authEmailInput["aria-invalid"], "true");
      assert.equal(dom.authPasswordInput["aria-invalid"], "true");
      assert.equal(
        dom.authPasswordButton.textContent,
        "Completa tu email y contraseña."
      );

      dom.authEmailInput.value = "new@example.com";
      dom.authPasswordForm.dispatch("submit");
      await flushAsyncEvents();

      assert.equal(dom.authEmailInput["aria-invalid"], "false");
      assert.equal(dom.authPasswordInput["aria-invalid"], "true");
      assert.equal(dom.authPasswordButton.textContent, "La contraseña debe tener al menos 8 caracteres.");

      dom.authPasswordInput.value = "password123";
      dom.authPasswordForm.dispatch("submit");
      await flushAsyncEvents();

      assert.equal(dom.authPasswordForm.dataset.authStep, "profile");
      assert.equal(dom.authBackButton.hidden, false);
      assert.equal(globalThis.document.activeElement, dom.authNicknameInput);
      assert.equal(dom.authEmailInput.value, "new@example.com");
      assert.equal(dom.authPasswordInput.value, "password123");
      assert.equal(requestedChallengePayload, null);

      dom.authPasswordForm.dispatch("submit");
      await flushAsyncEvents();

      assert.equal(dom.authPasswordForm.dataset.authStep, "profile");
      assert.equal(requestedChallengePayload, null);
      assert.equal(dom.authNicknameInput["aria-invalid"], "true");
      assert.equal(dom.authAgeInput["aria-invalid"], "true");
      assert.equal(dom.authTermsInput["aria-invalid"], "true");
      assert.equal(
        dom.authPasswordButton.textContent,
        "El nombre de usuario debe tener 3 a 24 caracteres y empezar con una letra."
      );

      dom.authNicknameInput.value = "Nuevo";
      dom.authTermsInput.checked = true;
      dom.authPasswordForm.dispatch("submit");
      await flushAsyncEvents();

      assert.equal(dom.authNicknameInput["aria-invalid"], "false");
      assert.equal(dom.authAgeInput["aria-invalid"], "true");
      assert.equal(dom.authTermsInput["aria-invalid"], "false");
      assert.equal(dom.authPasswordButton.textContent, "Completa tu fecha de nacimiento.");

      dom.authAgeInput.value = "15";
      dom.authPasswordForm.dispatch("submit");
      await flushAsyncEvents();

      assert.equal(
        dom.authPasswordButton.textContent,
        `Debes tener al menos ${MINIMUM_REGISTRATION_AGE} años para registrarte.`
      );

      dom.authAgeInput.value = String(MINIMUM_REGISTRATION_AGE);
      dom.authTermsInput.checked = false;
      dom.authPasswordForm.dispatch("submit");
      await flushAsyncEvents();

      assert.equal(dom.authAgeInput["aria-invalid"], "false");
      assert.equal(dom.authTermsInput["aria-invalid"], "true");
      assert.equal(dom.authPasswordButton.textContent, "Acepta los Términos y Condiciones para continuar.");

      dom.authTermsInput.checked = true;
      dom.authBackButton.dispatch("click");

      assert.equal(dom.authPasswordForm.dataset.authStep, "credentials");
      assert.equal(dom.authNicknameInput.value, "Nuevo");
      assert.equal(dom.authAgeInput.value, String(MINIMUM_REGISTRATION_AGE));

      dom.authPasswordForm.dispatch("submit");
      await flushAsyncEvents();
      dom.authPasswordForm.dispatch("submit");
      await flushAsyncEvents();
      await flushAsyncEvents();

      assert.equal(requestedChallengePayload?.password, "password123");
      assert.equal(requestedChallengePayload?.nickname, "Nuevo");
      assert.equal(dom.authPasswordForm.dataset.authStep, "verify");
      assert.equal(dom.authBackButton.hidden, true);
      assert.equal(dom.authLoginModeButton.disabled, true);
      assert.equal(dom.authRegisterModeButton.disabled, true);
      assert.equal(dom.authModalBackdrop.hidden, false);

      dom.authBackButton.dispatch("click");
      assert.equal(dom.authPasswordForm.dataset.authStep, "verify");

      dom.authCodeInput.value = "12";
      dom.authPasswordForm.dispatch("submit");
      await flushAsyncEvents();

      assert.equal(dom.authCodeInput["aria-invalid"], "true");
      assert.equal(
        dom.authPasswordButton.textContent,
        "Ingresa el código de 6 dígitos que te enviamos por email."
      );
      assert.equal(dom.authPasswordForm.dataset.authStep, "verify");

      dom.authCodeInput.value = "654321";
      dom.authPasswordForm.dispatch("submit");
      await flushAsyncEvents();
      await flushAsyncEvents();

      assert.equal(verifiedPayload?.selectedTopicId, "topic-original");
      assert.equal(dom.authModalBackdrop.hidden, true);
      assert.equal(dom.authPasswordForm.dataset.authStep, "credentials");
      assert.equal(dom.authEmailInput.value, "");
      assert.equal(dom.authPasswordInput.value, "");
      assert.equal(dom.authNicknameInput.value, "");
      assert.equal(dom.authAgeInput.value, "");
      assert.equal(dom.authCodeInput.value, "");
      assert.equal(dom.authTermsInput.checked, false);
    } finally {
      globalThis.requestAnimationFrame = previousRequestAnimationFrame;
      globalThis.document = previousDocument;
      globalThis.Element = previousElement;
      globalThis.HTMLElement = previousHTMLElement;
    }
  });

  await test("auth modal auto-opens the register profile step to complete a pending Google account, not the edit-profile modal", async () => {
    const previousDocument = globalThis.document;
    const previousElement = globalThis.Element;
    const previousHTMLElement = globalThis.HTMLElement;
    const previousRequestAnimationFrame = globalThis.requestAnimationFrame;

    class FakeElement {
      constructor() {
        this.dataset = {};
        this.listeners = new Map();
        this.hidden = false;
        this.className = "";
        this.textContent = "";
        this.value = "";
        this.parentElement = null;
        this.classList = createClassList();
      }

      addEventListener(type, listener) {
        this.listeners.set(type, listener);
      }

      dispatch(type, event = {}) {
        this.listeners.get(type)?.({
          preventDefault() {},
          stopImmediatePropagation() {},
          ...event,
          target: event.target || this
        });
      }

      querySelector() {
        return null;
      }

      querySelectorAll() {
        return [];
      }

      append(child) {
        child.parentElement = this;
      }

      focus() {
        if (globalThis.document) {
          globalThis.document.activeElement = this;
        }
      }

      setAttribute(name, value) {
        this[name] = value;
      }
    }

    const state = {
      viewer: { id: "u-oidc-pending", type: "registered", profilePending: true, profileSuggestedName: "Abril" },
      selectedTopicId: "topic-original"
    };
    const authButton = new FakeElement();
    authButton.label = { textContent: "" };
    let completedProfilePayload = null;

    const dom = {
      themeToggle: new FakeElement(),
      refreshButton: new FakeElement(),
      messageForm: new FakeElement(),
      profileButton: new FakeElement(),
      openRightDrawer: new FakeElement(),
      backToTopics: new FakeElement(),
      storeButton: new FakeElement(),
      paletteButton: new FakeElement(),
      themeToggleDesktopSlot: new FakeElement(),
      themeToggleMobileSlot: new FakeElement(),
      themeToggleDrawerSlot: new FakeElement(),
      closePaletteModalButton: new FakeElement(),
      paletteModalBackdrop: new FakeElement(),
      paletteOptionGrid: new FakeElement(),
      createTopicButton: new FakeElement(),
      friendRequestsButton: new FakeElement(),
      notificationsButton: new FakeElement(),
      authButton,
      authTools: new FakeElement(),
      authModalBackdrop: new FakeElement(),
      authModal: new FakeElement(),
      authModalTitle: new FakeElement(),
      authGoogleButton: new FakeElement(),
      authTurnstile: new FakeElement(),
      authTurnstileToken: { value: "" },
      authPasswordForm: new FakeElement(),
      authLoginModeButton: new FakeElement(),
      authRegisterModeButton: new FakeElement(),
      authBackButton: new FakeElement(),
      authNicknameInput: new FakeElement(),
      authEmailInput: new FakeElement(),
      authAgeInput: new FakeElement(),
      authPasswordInput: new FakeElement(),
      authTermsField: new FakeElement(),
      authTermsInput: new FakeElement(),
      authCodeInput: new FakeElement(),
      authPasswordButton: new FakeElement(),
      authSendCodeAgainButton: new FakeElement(),
      closeAuthModalButton: new FakeElement()
    };
    dom.authLoginModeButton.dataset.authMode = "login";
    dom.authRegisterModeButton.dataset.authMode = "register";

    try {
      globalThis.Element = FakeElement;
      globalThis.HTMLElement = FakeElement;
      globalThis.requestAnimationFrame = (task) => {
        task();
        return 0;
      };
      globalThis.document = {
        documentElement: { dataset: {} },
        activeElement: null,
        addEventListener() {},
        querySelector() {
          return null;
        }
      };

      bindTopbarActionEvents(dom, {
        state,
        toggleTheme() {},
        refreshCurrentTopic() {},
        submitMessage() {},
        flashTitle() {},
        backToTopics() {},
        openPaletteModal() {},
        closePaletteModal() {},
        updateCustomPaletteHex() {
          return true;
        },
        randomizeCustomPalette() {},
        selectPalette() {},
        createNewTopic() {},
        async getAuthStatus() {
          return { turnstile: { configured: false, siteKey: null } };
        },
        async completeOidcProfile(payload) {
          completedProfilePayload = payload;
          state.viewer = { id: "u-oidc-pending", type: "registered", profilePending: false };
          return { viewer: state.viewer, users: [], topics: [] };
        }
      });

      // bindTopbarActionEvents syncs the auth UI once on init, which must already
      // detect the pending Google profile and open the register modal's profile step.
      assert.equal(dom.authModalBackdrop.hidden, false);
      assert.equal(dom.authPasswordForm.dataset.authStep, "profile");
      assert.equal(dom.authModalTitle.textContent, "Completa tu registro");
      assert.equal(dom.authLoginModeButton.disabled, true);
      assert.equal(dom.authRegisterModeButton.disabled, true);
      assert.equal(dom.authBackButton.hidden, false);
      assert.equal(dom.authBackButton.textContent, "Más tarde");

      dom.authPasswordForm.dispatch("submit");
      await flushAsyncEvents();

      assert.equal(dom.authNicknameInput["aria-invalid"], "true");
      assert.equal(completedProfilePayload, null);

      dom.authNicknameInput.value = "Abril";
      dom.authAgeInput.value = String(MINIMUM_REGISTRATION_AGE);
      dom.authTermsInput.checked = true;
      dom.authPasswordForm.dispatch("submit");
      await flushAsyncEvents();

      assert.equal(completedProfilePayload?.username, "Abril");
      assert.equal(completedProfilePayload?.age, MINIMUM_REGISTRATION_AGE);
      assert.equal(completedProfilePayload?.acceptedTerms, true);
      assert.equal(dom.authModalBackdrop.hidden, true);
    } finally {
      globalThis.requestAnimationFrame = previousRequestAnimationFrame;
      globalThis.document = previousDocument;
      globalThis.Element = previousElement;
      globalThis.HTMLElement = previousHTMLElement;
    }
  });

  await test("auth modal marks an invalid email code field in red until the user edits it", async () => {
    const previousDocument = globalThis.document;
    const previousElement = globalThis.Element;
    const previousHTMLElement = globalThis.HTMLElement;
    const previousConsoleError = console.error;

    class FakeElement {
      constructor() {
        this.dataset = {};
        this.listeners = new Map();
        this.hidden = false;
        this.textContent = "";
        this.value = "";
        this.classList = createClassList();
      }

      addEventListener(type, listener) {
        this.listeners.set(type, listener);
      }

      dispatch(type, event = {}) {
        this.listeners.get(type)?.({
          preventDefault() {},
          stopImmediatePropagation() {},
          ...event,
          target: event.target || this
        });
      }

      querySelector(selector) {
        return selector === ".button-label" ? this.label : null;
      }

      querySelectorAll() {
        return [];
      }

      setAttribute(name, value) {
        this[name] = value;
      }

      append(child) {
        child.parentElement = this;
      }

      focus() {}
    }

    const authButton = new FakeElement();
    authButton.label = { textContent: "" };
    const authStatus = new FakeElement();
    const state = {
      viewer: { id: "guest-invalid-code", type: "guest" },
      selectedTopicId: "topic-auth"
    };
    let verifyAttempts = 0;

    const dom = {
      themeToggle: new FakeElement(),
      refreshButton: new FakeElement(),
      messageForm: new FakeElement(),
      profileButton: new FakeElement(),
      openRightDrawer: new FakeElement(),
      backToTopics: new FakeElement(),
      storeButton: new FakeElement(),
      paletteButton: new FakeElement(),
      themeToggleDesktopSlot: new FakeElement(),
      themeToggleMobileSlot: new FakeElement(),
      themeToggleDrawerSlot: new FakeElement(),
      closePaletteModalButton: new FakeElement(),
      paletteModalBackdrop: new FakeElement(),
      paletteOptionGrid: new FakeElement(),
      createTopicButton: new FakeElement(),
      friendRequestsButton: new FakeElement(),
      notificationsButton: new FakeElement(),
      authButton,
      authTools: new FakeElement(),
      authModalBackdrop: new FakeElement(),
      authModal: new FakeElement(),
      authGoogleButton: new FakeElement(),
      authTurnstile: new FakeElement(),
      authTurnstileToken: { value: "" },
      authStatus,
      authPasswordForm: new FakeElement(),
      authLoginModeButton: new FakeElement(),
      authRegisterModeButton: new FakeElement(),
      authNicknameInput: new FakeElement(),
      authEmailInput: new FakeElement(),
      authAgeInput: new FakeElement(),
      authCodeInput: new FakeElement(),
      authTermsField: new FakeElement(),
      authTermsInput: new FakeElement(),
      authPasswordButton: new FakeElement(),
      authSendCodeAgainButton: new FakeElement(),
      closeAuthModalButton: new FakeElement()
    };
    dom.authLoginModeButton.dataset.authMode = "login";
    dom.authRegisterModeButton.dataset.authMode = "register";
    dom.authPasswordInput = new FakeElement();

    try {
      globalThis.Element = FakeElement;
      globalThis.HTMLElement = FakeElement;
      console.error = () => {};
      globalThis.document = {
        documentElement: { dataset: {} },
        addEventListener() {},
        querySelector() {
          return null;
        }
      };

      bindTopbarActionEvents(dom, {
        state,
        toggleTheme() {},
        refreshCurrentTopic() {},
        submitMessage() {},
        flashTitle() {},
        backToTopics() {},
        openPaletteModal() {},
        closePaletteModal() {},
        updateCustomPaletteHex() {
          return true;
        },
        randomizeCustomPalette() {},
        selectPalette() {},
        createNewTopic() {},
        async getAuthStatus() {
          return { turnstile: { configured: false, siteKey: null } };
        },
        async requestEmailAuthCode() {
          return {
            challengeId: "email-code-test",
            email: "user@example.com"
          };
        },
        async verifyEmailAuthCode() {
          verifyAttempts += 1;
          const error = new Error("El codigo ingresado no es correcto.");
          error.code = "INVALID_EMAIL_CODE";
          throw error;
        }
      });

      authButton.dispatch("click");
      await flushAsyncEvents();
      dom.authRegisterModeButton.dispatch("click");
      dom.authEmailInput.value = "user@example.com";
      dom.authPasswordInput.value = "password123";
      dom.authNicknameInput.value = "Coco_mora";
      dom.authAgeInput.value = String(MINIMUM_REGISTRATION_AGE);
      dom.authTermsInput.checked = true;

      dom.authPasswordForm.dispatch("submit");
      await flushAsyncEvents();
      dom.authPasswordForm.dispatch("submit");
      await flushAsyncEvents();
      await flushAsyncEvents();

      dom.authCodeInput.value = "123456";
      dom.authPasswordForm.dispatch("submit");
      await flushAsyncEvents();
      await flushAsyncEvents();

      assert.equal(verifyAttempts, 1);
      assert.equal(dom.authCodeInput["aria-invalid"], "true");
      assert.match(authStatus.textContent, /codigo ingresado/);

      dom.authCodeInput.dispatch("input");
      assert.equal(dom.authCodeInput["aria-invalid"], "false");
    } finally {
      console.error = previousConsoleError;
      globalThis.document = previousDocument;
      globalThis.Element = previousElement;
      globalThis.HTMLElement = previousHTMLElement;
    }
  });
  await test("auth modal walks the password recovery flow from request to confirmation", async () => {
    const previousDocument = globalThis.document;
    const previousElement = globalThis.Element;
    const previousHTMLElement = globalThis.HTMLElement;
    const previousConsoleError = console.error;

    class FakeElement {
      constructor() {
        this.dataset = {};
        this.listeners = new Map();
        this.hidden = false;
        this.textContent = "";
        this.value = "";
        this.classList = createClassList();
      }

      addEventListener(type, listener) {
        this.listeners.set(type, listener);
      }

      dispatch(type, event = {}) {
        this.listeners.get(type)?.({
          preventDefault() {},
          stopImmediatePropagation() {},
          ...event,
          target: event.target || this
        });
      }

      querySelector(selector) {
        return selector === ".button-label" ? this.label : null;
      }

      querySelectorAll() {
        return [];
      }

      setAttribute(name, value) {
        this[name] = value;
      }

      append(child) {
        child.parentElement = this;
      }

      focus() {}
    }

    const authButton = new FakeElement();
    authButton.label = { textContent: "" };
    const authStatus = new FakeElement();
    const state = {
      viewer: { id: "guest-recovery", type: "guest" },
      selectedTopicId: "topic-auth"
    };
    let resetRequest = null;
    let resetConfirm = null;

    const dom = {
      themeToggle: new FakeElement(),
      refreshButton: new FakeElement(),
      messageForm: new FakeElement(),
      profileButton: new FakeElement(),
      openRightDrawer: new FakeElement(),
      backToTopics: new FakeElement(),
      storeButton: new FakeElement(),
      paletteButton: new FakeElement(),
      themeToggleDesktopSlot: new FakeElement(),
      themeToggleMobileSlot: new FakeElement(),
      themeToggleDrawerSlot: new FakeElement(),
      closePaletteModalButton: new FakeElement(),
      paletteModalBackdrop: new FakeElement(),
      paletteOptionGrid: new FakeElement(),
      createTopicButton: new FakeElement(),
      friendRequestsButton: new FakeElement(),
      notificationsButton: new FakeElement(),
      authButton,
      authTools: new FakeElement(),
      authModalBackdrop: new FakeElement(),
      authModal: new FakeElement(),
      authGoogleButton: new FakeElement(),
      authTurnstile: new FakeElement(),
      authTurnstileToken: { value: "" },
      authStatus,
      authPasswordForm: new FakeElement(),
      authLoginModeButton: new FakeElement(),
      authRegisterModeButton: new FakeElement(),
      authNicknameInput: new FakeElement(),
      authEmailInput: new FakeElement(),
      authEmailField: new FakeElement(),
      authAgeInput: new FakeElement(),
      authCodeInput: new FakeElement(),
      authTermsField: new FakeElement(),
      authTermsInput: new FakeElement(),
      authPasswordInput: new FakeElement(),
      authPasswordField: new FakeElement(),
      authPasswordConfirmInput: new FakeElement(),
      authPasswordConfirmField: new FakeElement(),
      authPasswordButton: new FakeElement(),
      authRecoveryButton: new FakeElement(),
      authBackButton: new FakeElement(),
      authSendCodeAgainButton: new FakeElement(),
      closeAuthModalButton: new FakeElement()
    };
    dom.authLoginModeButton.dataset.authMode = "login";
    dom.authRegisterModeButton.dataset.authMode = "register";

    try {
      globalThis.Element = FakeElement;
      globalThis.HTMLElement = FakeElement;
      console.error = () => {};
      globalThis.document = {
        documentElement: { dataset: {} },
        addEventListener() {},
        querySelector() {
          return null;
        }
      };

      bindTopbarActionEvents(dom, {
        state,
        toggleTheme() {},
        refreshCurrentTopic() {},
        submitMessage() {},
        flashTitle() {},
        backToTopics() {},
        openPaletteModal() {},
        closePaletteModal() {},
        updateCustomPaletteHex() {
          return true;
        },
        randomizeCustomPalette() {},
        selectPalette() {},
        createNewTopic() {},
        async getAuthStatus() {
          return { turnstile: { configured: false, siteKey: null } };
        },
        async requestPasswordResetCode(payload) {
          resetRequest = payload;
          return {
            challengeId: "password-reset-test",
            expiresInSeconds: 600,
            message: "Si existe una cuenta con ese email, enviamos un código de recuperación."
          };
        },
        async confirmPasswordReset(payload) {
          resetConfirm = payload;
          state.viewer = { id: "u-recovered", type: "registered" };
          return { viewer: state.viewer, users: [], topics: [] };
        }
      });

      authButton.dispatch("click");
      await flushAsyncEvents();

      assert.equal(dom.authModalBackdrop.hidden, false);
      assert.equal(dom.authRecoveryButton.hidden, false);

      dom.authRecoveryButton.dispatch("click");

      assert.equal(dom.authPasswordForm.dataset.authMode, "recovery");
      assert.equal(dom.authPasswordForm.dataset.authStep, "request");
      assert.equal(dom.authEmailField.hidden, false);
      assert.equal(dom.authPasswordField.hidden, true);
      assert.equal(dom.authRecoveryButton.hidden, true);
      assert.equal(dom.authBackButton.hidden, false);

      dom.authPasswordForm.dispatch("submit");
      await flushAsyncEvents();

      assert.equal(resetRequest, null);
      assert.equal(dom.authEmailInput["aria-invalid"], "true");

      dom.authEmailInput.value = "person@example.com";
      dom.authEmailInput.dispatch("input");
      dom.authPasswordForm.dispatch("submit");
      await flushAsyncEvents();
      await flushAsyncEvents();

      assert.equal(resetRequest?.email, "person@example.com");
      assert.equal(dom.authPasswordForm.dataset.authStep, "verify");
      assert.equal(dom.authEmailField.hidden, true);
      assert.equal(dom.authPasswordField.hidden, false);
      assert.equal(dom.authPasswordConfirmField.hidden, false);
      assert.equal(dom.authSendCodeAgainButton.hidden, false);
      // The restore label must follow the mode so error/pending flashes never
      // revert the button to a previous mode's text.
      assert.equal(dom.authPasswordButton.dataset.defaultAuthLabel, "Cambiar contraseña");

      dom.authCodeInput.value = "123456";
      dom.authPasswordInput.value = "password-nueva";
      dom.authPasswordConfirmInput.value = "password-distinta";
      dom.authPasswordForm.dispatch("submit");
      await flushAsyncEvents();

      assert.equal(resetConfirm, null);
      assert.equal(dom.authPasswordConfirmInput["aria-invalid"], "true");

      dom.authPasswordConfirmInput.value = "password-nueva";
      dom.authPasswordConfirmInput.dispatch("input");
      dom.authPasswordForm.dispatch("submit");
      await flushAsyncEvents();
      await flushAsyncEvents();

      assert.equal(resetConfirm?.challengeId, "password-reset-test");
      assert.equal(resetConfirm?.code, "123456");
      assert.equal(resetConfirm?.newPassword, "password-nueva");
      assert.equal(dom.authModalBackdrop.hidden, true);
    } finally {
      console.error = previousConsoleError;
      globalThis.document = previousDocument;
      globalThis.Element = previousElement;
      globalThis.HTMLElement = previousHTMLElement;
    }
  });
  await test("switching between login and register clears the red error state on the continue button", async () => {
    const previousDocument = globalThis.document;
    const previousElement = globalThis.Element;
    const previousHTMLElement = globalThis.HTMLElement;
    const previousConsoleError = console.error;

    class FakeElement {
      constructor() {
        this.dataset = {};
        this.listeners = new Map();
        this.hidden = false;
        this.textContent = "";
        this.value = "";
        this.classList = createClassList();
      }

      addEventListener(type, listener) {
        this.listeners.set(type, listener);
      }

      dispatch(type, event = {}) {
        this.listeners.get(type)?.({
          preventDefault() {},
          stopImmediatePropagation() {},
          ...event,
          target: event.target || this
        });
      }

      querySelector(selector) {
        return selector === ".button-label" ? this.label : null;
      }

      querySelectorAll() {
        return [];
      }

      setAttribute(name, value) {
        this[name] = value;
      }

      append(child) {
        child.parentElement = this;
      }

      focus() {}
    }

    const authButton = new FakeElement();
    authButton.label = { textContent: "" };
    const authStatus = new FakeElement();
    const state = {
      viewer: { id: "guest-mode-switch", type: "guest" },
      selectedTopicId: "topic-auth"
    };

    const dom = {
      themeToggle: new FakeElement(),
      refreshButton: new FakeElement(),
      messageForm: new FakeElement(),
      profileButton: new FakeElement(),
      openRightDrawer: new FakeElement(),
      backToTopics: new FakeElement(),
      storeButton: new FakeElement(),
      paletteButton: new FakeElement(),
      themeToggleDesktopSlot: new FakeElement(),
      themeToggleMobileSlot: new FakeElement(),
      themeToggleDrawerSlot: new FakeElement(),
      closePaletteModalButton: new FakeElement(),
      paletteModalBackdrop: new FakeElement(),
      paletteOptionGrid: new FakeElement(),
      createTopicButton: new FakeElement(),
      friendRequestsButton: new FakeElement(),
      notificationsButton: new FakeElement(),
      authButton,
      authTools: new FakeElement(),
      authModalBackdrop: new FakeElement(),
      authModal: new FakeElement(),
      authGoogleButton: new FakeElement(),
      authTurnstile: new FakeElement(),
      authTurnstileToken: { value: "" },
      authStatus,
      authPasswordForm: new FakeElement(),
      authLoginModeButton: new FakeElement(),
      authRegisterModeButton: new FakeElement(),
      authNicknameInput: new FakeElement(),
      authEmailInput: new FakeElement(),
      authAgeInput: new FakeElement(),
      authCodeInput: new FakeElement(),
      authTermsField: new FakeElement(),
      authTermsInput: new FakeElement(),
      authPasswordButton: new FakeElement(),
      authSendCodeAgainButton: new FakeElement(),
      closeAuthModalButton: new FakeElement()
    };
    dom.authLoginModeButton.dataset.authMode = "login";
    dom.authRegisterModeButton.dataset.authMode = "register";
    dom.authPasswordInput = new FakeElement();

    try {
      globalThis.Element = FakeElement;
      globalThis.HTMLElement = FakeElement;
      console.error = () => {};
      globalThis.document = {
        documentElement: { dataset: {} },
        addEventListener() {},
        querySelector() {
          return null;
        }
      };

      bindTopbarActionEvents(dom, {
        state,
        toggleTheme() {},
        refreshCurrentTopic() {},
        submitMessage() {},
        flashTitle() {},
        backToTopics() {},
        openPaletteModal() {},
        closePaletteModal() {},
        updateCustomPaletteHex() {
          return true;
        },
        randomizeCustomPalette() {},
        selectPalette() {},
        createNewTopic() {},
        async getAuthStatus() {
          return { turnstile: { configured: false, siteKey: null } };
        }
      });

      authButton.dispatch("click");
      await flushAsyncEvents();

      dom.authEmailInput.value = "email-invalido";
      dom.authPasswordInput.value = "corta";
      dom.authPasswordForm.dispatch("submit");
      await flushAsyncEvents();

      assert.equal(dom.authPasswordButton.classList.contains("is-error"), true);
      assert.equal(
        dom.authPasswordButton.textContent,
        "Completa tu email y contraseña."
      );

      dom.authRegisterModeButton.dispatch("click");

      assert.equal(dom.authPasswordButton.classList.contains("is-error"), false);
      assert.equal(dom.authPasswordButton.textContent, "Siguiente");
    } finally {
      console.error = previousConsoleError;
      globalThis.document = previousDocument;
      globalThis.Element = previousElement;
      globalThis.HTMLElement = previousHTMLElement;
    }
  });
  await test("auth modal submits login with a password instead of an email code even when the code input exists", async () => {
    const previousDocument = globalThis.document;
    const previousElement = globalThis.Element;
    const previousHTMLElement = globalThis.HTMLElement;

    class FakeElement {
      constructor() {
        this.dataset = {};
        this.listeners = new Map();
        this.hidden = false;
        this.textContent = "";
        this.value = "";
        this.classList = createClassList();
      }

      addEventListener(type, listener) {
        this.listeners.set(type, listener);
      }

      dispatch(type, event = {}) {
        this.listeners.get(type)?.({
          preventDefault() {},
          stopImmediatePropagation() {},
          ...event,
          target: event.target || this
        });
      }

      querySelector(selector) {
        return selector === ".button-label" ? this.label : null;
      }

      querySelectorAll() {
        return [];
      }

      setAttribute(name, value) {
        this[name] = value;
      }

      append(child) {
        child.parentElement = this;
      }

      focus() {}
    }

    const authButton = new FakeElement();
    authButton.label = { textContent: "" };
    const state = {
      viewer: { id: "guest-login", type: "guest" },
      selectedTopicId: "topic-login"
    };
    let loginCalls = 0;
    let requestCodeCalls = 0;
    let loggedInPayload = null;

    const dom = {
      themeToggle: new FakeElement(),
      refreshButton: new FakeElement(),
      messageForm: new FakeElement(),
      profileButton: new FakeElement(),
      openRightDrawer: new FakeElement(),
      backToTopics: new FakeElement(),
      storeButton: new FakeElement(),
      paletteButton: new FakeElement(),
      themeToggleDesktopSlot: new FakeElement(),
      themeToggleMobileSlot: new FakeElement(),
      themeToggleDrawerSlot: new FakeElement(),
      closePaletteModalButton: new FakeElement(),
      paletteModalBackdrop: new FakeElement(),
      paletteOptionGrid: new FakeElement(),
      createTopicButton: new FakeElement(),
      friendRequestsButton: new FakeElement(),
      notificationsButton: new FakeElement(),
      authButton,
      authTools: new FakeElement(),
      authModalBackdrop: new FakeElement(),
      authModal: new FakeElement(),
      authGoogleButton: new FakeElement(),
      authGoogleTermsInput: { checked: true },
      authTurnstile: new FakeElement(),
      authTurnstileToken: { value: "" },
      authPasswordForm: new FakeElement(),
      authLoginModeButton: new FakeElement(),
      authRegisterModeButton: new FakeElement(),
      authNicknameInput: new FakeElement(),
      authEmailInput: new FakeElement(),
      authAgeInput: new FakeElement(),
      authPasswordInput: new FakeElement(),
      authTermsField: new FakeElement(),
      authTermsInput: new FakeElement(),
      authCodeInput: new FakeElement(),
      authPasswordButton: new FakeElement(),
      authSendCodeAgainButton: new FakeElement(),
      closeAuthModalButton: new FakeElement()
    };
    dom.authLoginModeButton.dataset.authMode = "login";
    dom.authRegisterModeButton.dataset.authMode = "register";

    try {
      globalThis.Element = FakeElement;
      globalThis.HTMLElement = FakeElement;
      globalThis.document = {
        documentElement: { dataset: {} },
        addEventListener() {},
        querySelector() {
          return null;
        }
      };

      bindTopbarActionEvents(dom, {
        state,
        toggleTheme() {},
        refreshCurrentTopic() {},
        submitMessage() {},
        flashTitle() {},
        backToTopics() {},
        openPaletteModal() {},
        closePaletteModal() {},
        updateCustomPaletteHex() {
          return true;
        },
        randomizeCustomPalette() {},
        selectPalette() {},
        createNewTopic() {},
        async getAuthStatus() {
          return { turnstile: { configured: false, siteKey: null } };
        },
        async loginWithPassword(payload) {
          loginCalls += 1;
          loggedInPayload = payload;
          state.viewer = { id: "u-login", type: "registered" };
          return {
            viewer: state.viewer,
            selectedTopicId: payload.selectedTopicId,
            users: [],
            topics: []
          };
        },
        async requestEmailAuthCode() {
          requestCodeCalls += 1;
          return { challengeId: "should-not-be-used", email: "login-user@example.com" };
        }
      });

      authButton.dispatch("click");
      await flushAsyncEvents();
      dom.authEmailInput.value = "login-user@example.com";
      dom.authPasswordInput.value = "password123";

      dom.authPasswordForm.dispatch("submit");
      await flushAsyncEvents();
      await flushAsyncEvents();

      assert.equal(loginCalls, 1);
      assert.equal(requestCodeCalls, 0);
      assert.equal(loggedInPayload?.email, "login-user@example.com");
      assert.equal(loggedInPayload?.password, "password123");
      assert.equal(dom.authModalBackdrop.hidden, true);
    } finally {
      globalThis.document = previousDocument;
      globalThis.Element = previousElement;
      globalThis.HTMLElement = previousHTMLElement;
    }
  });
  await test("auth modal lazy-loads Turnstile script only after login interaction", async () => {
    const previousDocument = globalThis.document;
    const previousElement = globalThis.Element;
    const previousHTMLElement = globalThis.HTMLElement;
    const previousWindow = globalThis.window;
    const previousTurnstile = globalThis.turnstile;

    class FakeElement {
      constructor() {
        this.dataset = {};
        this.listeners = new Map();
        this.hidden = false;
        this.className = "";
        this.textContent = "";
        this.classList = createClassList();
      }

      addEventListener(type, listener) {
        this.listeners.set(type, listener);
      }

      dispatch(type, event = {}) {
        this.listeners.get(type)?.({
          preventDefault() {},
          stopImmediatePropagation() {},
          ...event,
          target: event.target || this
        });
      }

      querySelector(selector) {
        return selector === ".button-label" ? this.label : null;
      }

      querySelectorAll() {
        return [];
      }

      setAttribute(name, value) {
        this[name] = value;
      }

      append(child) {
        child.parentElement = this;
      }

      focus() {}
    }

    const authButton = new FakeElement();
    authButton.label = { textContent: "" };
    const authTurnstile = new FakeElement();
    const appendedScripts = [];
    let renderCalls = 0;

    try {
      globalThis.Element = FakeElement;
      globalThis.HTMLElement = FakeElement;
      globalThis.turnstile = undefined;
      globalThis.window = {
        addEventListener() {},
        matchMedia() {
          return { matches: false };
        }
      };
      globalThis.document = {
        documentElement: { dataset: {} },
        head: {
          appendChild(node) {
            appendedScripts.push(node);
            globalThis.turnstile = {
              render() {
                renderCalls += 1;
                return "widget-lazy";
              }
            };
            node.onload?.();
            return node;
          }
        },
        addEventListener() {},
        createElement(tagName) {
          return { tagName, async: false, defer: false, onload: null, onerror: null };
        },
        getElementById(id) {
          return appendedScripts.find((script) => script.id === id) ?? null;
        },
        querySelector() {
          return null;
        }
      };

      bindTopbarActionEvents(
        {
          themeToggle: new FakeElement(),
          refreshButton: new FakeElement(),
          messageForm: new FakeElement(),
          profileButton: new FakeElement(),
          openRightDrawer: new FakeElement(),
          backToTopics: new FakeElement(),
          storeButton: new FakeElement(),
          paletteButton: new FakeElement(),
          themeToggleDesktopSlot: new FakeElement(),
          themeToggleMobileSlot: new FakeElement(),
          themeToggleDrawerSlot: new FakeElement(),
          closePaletteModalButton: new FakeElement(),
          paletteModalBackdrop: new FakeElement(),
          paletteOptionGrid: new FakeElement(),
          createTopicButton: new FakeElement(),
          friendRequestsButton: new FakeElement(),
          notificationsButton: new FakeElement(),
          authButton,
          authTools: new FakeElement(),
          authModalBackdrop: new FakeElement(),
          authModal: new FakeElement(),
          authGoogleButton: new FakeElement(),
          authTurnstile,
          authTurnstileToken: { value: "" },
          authPasswordForm: new FakeElement(),
          authLoginModeButton: new FakeElement(),
          authRegisterModeButton: new FakeElement(),
          authNicknameInput: new FakeElement(),
          authEmailInput: new FakeElement(),
          authPasswordInput: new FakeElement(),
          authPasswordButton: new FakeElement(),
          closeAuthModalButton: new FakeElement()
        },
        {
          toggleTheme() {},
          refreshCurrentTopic() {},
          submitMessage() {},
          flashTitle() {},
          state: { viewer: { id: "guest-lazy-turnstile", type: "guest" } },
          async getAuthStatus() {
            return { turnstile: { configured: true, siteKey: "site-key" } };
          },
          backToTopics() {},
          openPaletteModal() {},
          closePaletteModal() {},
          updateCustomPaletteHex() {
            return true;
          },
          randomizeCustomPalette() {},
          selectPalette() {},
          createNewTopic() {}
        }
      );

      assert.equal(appendedScripts.length, 0);
      assert.equal(renderCalls, 0);

      authButton.dispatch("click");
      await flushAsyncEvents();
      await flushAsyncEvents();

      assert.equal(appendedScripts.length, 1);
      assert.equal(appendedScripts[0].id, "turnstile-script");
      assert.equal(
        appendedScripts[0].src,
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
      );
      assert.equal(appendedScripts[0].async, true);
      assert.equal(appendedScripts[0].defer, true);
      assert.equal(renderCalls, 1);
      assert.equal(authTurnstile.hidden, false);
    } finally {
      globalThis.document = previousDocument;
      globalThis.Element = previousElement;
      globalThis.HTMLElement = previousHTMLElement;
      globalThis.window = previousWindow;
      globalThis.turnstile = previousTurnstile;
    }
  });
  await test("auth modal requires Turnstile when backend advertises it", async () => {
    const previousDocument = globalThis.document;
    const previousElement = globalThis.Element;
    const previousHTMLElement = globalThis.HTMLElement;
    const previousWindow = globalThis.window;
    const previousTurnstile = globalThis.turnstile;

    class FakeElement {
      constructor() {
        this.dataset = {};
        this.listeners = new Map();
        this.hidden = false;
        this.className = "";
        this.textContent = "";
      }

      addEventListener(type, listener) {
        this.listeners.set(type, listener);
      }

      dispatch(type, event = {}) {
        this.listeners.get(type)?.({
          preventDefault() {},
          stopImmediatePropagation() {},
          ...event,
          target: event.target || this
        });
      }

      querySelector(selector) {
        return selector === ".button-label" ? this.label : null;
      }

      setAttribute(name, value) {
        this[name] = value;
      }

      append(child) {
        child.parentElement = this;
      }

      focus() {}
    }

    const authButton = new FakeElement();
    authButton.label = { textContent: "" };
    const authGoogleButton = new FakeElement();
    const authTurnstile = new FakeElement();
    const authTurnstileToken = { value: "" };
    const state = {
      viewer: { id: "guest-turnstile", type: "guest" }
    };
    let renderCalls = 0;
    let executeCalls = 0;
    let resetCalls = 0;
    let loginCalls = 0;
    let renderOptions = null;
    let receivedTurnstileToken = "";

    try {
      globalThis.Element = FakeElement;
      globalThis.HTMLElement = FakeElement;
      globalThis.window = {
        addEventListener() {},
        matchMedia() {
          return { matches: false };
        }
      };
      globalThis.document = {
        documentElement: { dataset: {} },
        addEventListener() {},
        querySelector() {
          return null;
        }
      };
      globalThis.turnstile = {
        render(_target, options) {
          renderCalls += 1;
          renderOptions = options;
          return "widget-1";
        },
        execute(widgetId) {
          assert.equal(widgetId, "widget-1");
          executeCalls += 1;
          renderOptions.callback("turnstile-token");
        },
        reset() {
          resetCalls += 1;
        }
      };

      bindTopbarActionEvents(
        {
          themeToggle: new FakeElement(),
          refreshButton: new FakeElement(),
          messageForm: new FakeElement(),
          profileButton: new FakeElement(),
          openRightDrawer: new FakeElement(),
          backToTopics: new FakeElement(),
          storeButton: new FakeElement(),
          paletteButton: new FakeElement(),
          themeToggleDesktopSlot: new FakeElement(),
          themeToggleMobileSlot: new FakeElement(),
          closePaletteModalButton: new FakeElement(),
          paletteModalBackdrop: new FakeElement(),
          paletteOptionGrid: new FakeElement(),
          createTopicButton: new FakeElement(),
          friendRequestsButton: new FakeElement(),
          notificationsButton: new FakeElement(),
          authButton,
          authTools: new FakeElement(),
          authModalBackdrop: new FakeElement(),
          authModal: new FakeElement(),
          authGoogleButton,
          authGoogleTermsInput: { checked: true },
          authTurnstile,
          authTurnstileToken,
          authPasswordForm: new FakeElement(),
          authLoginModeButton: new FakeElement(),
          authRegisterModeButton: new FakeElement(),
          authNicknameInput: new FakeElement(),
          authEmailInput: new FakeElement(),
          authPasswordInput: new FakeElement(),
          authPasswordButton: new FakeElement(),
          closeAuthModalButton: new FakeElement()
        },
        {
          toggleTheme() {},
          refreshCurrentTopic() {},
          submitMessage() {},
          flashTitle() {},
          state,
          async getAuthStatus() {
            return { configured: true, turnstile: { configured: true, siteKey: "site-key" } };
          },
          async login({ turnstileToken = "" } = {}) {
            loginCalls += 1;
            receivedTurnstileToken = turnstileToken;
            state.viewer = { id: "u1", type: "registered" };
            return { viewer: state.viewer };
          },
          async logout() {},
          backToTopics() {},
          openPaletteModal() {},
          closePaletteModal() {},
          updateCustomPaletteHex() {
            return true;
          },
          randomizeCustomPalette() {},
          selectPalette() {},
          createNewTopic() {}
        }
      );

      authButton.dispatch("click");
      await flushAsyncEvents();
      authButton.dispatch("click");
      await flushAsyncEvents();
      authGoogleButton.dispatch("click");
      await flushAsyncEvents();
      await flushAsyncEvents();

      assert.equal(renderCalls, 1);
      assert.equal(executeCalls, 1);
      assert.equal(resetCalls, 0);
      assert.equal(renderOptions.appearance, "interaction-only");
      assert.equal(renderOptions.execution, "execute");
      assert.equal(loginCalls, 1);
      assert.equal(receivedTurnstileToken, "turnstile-token");
      assert.equal(authTurnstile.hidden, false);
      assert.equal(authTurnstileToken.value, "");
    } finally {
      globalThis.document = previousDocument;
      globalThis.Element = previousElement;
      globalThis.HTMLElement = previousHTMLElement;
      globalThis.window = previousWindow;
      globalThis.turnstile = previousTurnstile;
    }
  });
  await test("mobile keeps private actions hidden until login and then routes drawer actions", async () => {
    const previousLocalStorage = globalThis.localStorage;
    const previousDocument = globalThis.document;
    const previousElement = globalThis.Element;
    const previousHTMLElement = globalThis.HTMLElement;
    const previousWindow = globalThis.window;
    const previousRequestAnimationFrame = globalThis.requestAnimationFrame;

    class FakeElement {
      constructor() {
        this.dataset = {};
        this.listeners = new Map();
        this.hidden = false;
        this.className = "";
        this.parentElement = null;
        this.textContent = "";
        const classValues = new Set();
        this.classList = {
          add: (...tokens) => tokens.forEach((token) => classValues.add(token)),
          remove: (...tokens) => tokens.forEach((token) => classValues.delete(token)),
          toggle: (token, force) => {
            if (force === undefined) {
              if (classValues.has(token)) {
                classValues.delete(token);
                return false;
              }
              classValues.add(token);
              return true;
            }
            if (force) {
              classValues.add(token);
              return true;
            }
            classValues.delete(token);
            return false;
          },
          contains: (token) => classValues.has(token)
        };
      }

      addEventListener(type, listener) {
        this.listeners.set(type, listener);
      }

      dispatch(type, event = {}) {
        this.listeners.get(type)?.({
          preventDefault() {},
          stopImmediatePropagation() {},
          ...event,
          target: event.target || this
        });
      }

      querySelector(selector) {
        if (selector === ".button-label") {
          return this.label;
        }

        return null;
      }

      closest(selector) {
        if (selector === "[data-mobile-topbar-action]" && this.dataset.mobileTopbarAction) {
          return this;
        }

        if (selector === "[data-mobile-drawer-panel]" && this.dataset.mobileDrawerPanel) {
          return this;
        }

        if (selector === "[data-mobile-drawer-back]" && this.dataset.mobileDrawerBack) {
          return this;
        }

        return null;
      }

      setAttribute(name, value) {
        this[name] = value;
      }

      append(child) {
        child.parentElement = this;
        this.firstElementChild = child;
      }
    }

    const authButton = new FakeElement();
    authButton.label = { textContent: "" };
    const authTools = new FakeElement();
    const mobileTopbarMenu = new FakeElement();
    const mobileDrawerPanels = new FakeElement();
    const drawerUsersSection = new FakeElement();
    const drawerRankingsSection = new FakeElement();
    const themeToggle = new FakeElement();
    const themeToggleDesktopSlot = new FakeElement();
    const themeToggleMobileSlot = new FakeElement();
    const themeToggleDrawerSlot = new FakeElement();
    const openRightDrawer = new FakeElement();
    const searchInput = new FakeElement();
    searchInput.value = "";
    const menuProfileButton = new FakeElement();
    menuProfileButton.dataset.authPrivate = "true";
    menuProfileButton.dataset.mobileTopbarAction = "profile";
    menuProfileButton.textContent = "Perfil";
    const homeButton = new FakeElement();
    homeButton.dataset.mobileTopbarAction = "home";
    homeButton.textContent = "Inicio";
    const menuAuthButton = new FakeElement();
    menuAuthButton.dataset.authPrivate = "true";
    menuAuthButton.dataset.mobileTopbarAction = "auth";
    menuAuthButton.textContent = "Cerrar sesión";
    const usersPanelButton = new FakeElement();
    usersPanelButton.dataset.mobileDrawerPanel = "users";
    usersPanelButton.textContent = "Usuarios";
    const rankingPanelButton = new FakeElement();
    rankingPanelButton.dataset.mobileDrawerPanel = "ranking";
    rankingPanelButton.textContent = "Ranking";
    const backButton = new FakeElement();
    backButton.dataset.mobileDrawerBack = "true";
    const paletteTarget = new FakeElement();
    paletteTarget.dataset.mobileTopbarAction = "palette";
    paletteTarget.textContent = "Paletas";
    const menuButtons = [
      menuProfileButton,
      homeButton,
      paletteTarget,
      usersPanelButton,
      rankingPanelButton,
      menuAuthButton
    ];
    mobileTopbarMenu.querySelector = (selector) =>
      selector === "#mobileDrawerSearch" ? searchInput : null;
    mobileTopbarMenu.querySelectorAll = (selector) =>
      selector === "[data-mobile-drawer-panel]"
        ? [usersPanelButton, rankingPanelButton]
        : selector === "[data-auth-private]"
          ? [menuProfileButton, menuAuthButton]
          : selector === ".drawer-action-button"
            ? menuButtons
            : [];
    drawerUsersSection.querySelector = () => backButton;
    drawerRankingsSection.querySelector = () => backButton;
    const flashCalls = [];
    let closeDrawersCalls = 0;
    let toggleThemeCalls = 0;
    let openPaletteModalCalls = 0;
    let openProfileModalCalls = 0;
    let syncResponsiveViewCalls = 0;
    const state = {
      mobileView: "chat",
      viewer: { id: "guest-mobile", type: "guest" }
    };
    let loginCalls = 0;
    let logoutCalls = 0;

    const dom = {
      themeToggle,
      refreshButton: new FakeElement(),
      messageForm: new FakeElement(),
      profileButton: new FakeElement(),
      backToTopics: new FakeElement(),
      storeButton: new FakeElement(),
      paletteButton: new FakeElement(),
      themeToggleDesktopSlot,
      themeToggleMobileSlot,
      themeToggleDrawerSlot,
      mobileTopbarMenu,
      mobileDrawerPanels,
      drawerUsersSection,
      drawerRankingsSection,
      openRightDrawer,
      closePaletteModalButton: new FakeElement(),
      paletteModalBackdrop: new FakeElement(),
      paletteOptionGrid: new FakeElement(),
      createTopicButton: new FakeElement(),
      friendRequestsButton: new FakeElement(),
      notificationsButton: new FakeElement(),
      authButton,
      authTools,
      authModalBackdrop: new FakeElement(),
      authModal: new FakeElement(),
      authGoogleButton: new FakeElement(),
      authGoogleTermsInput: { checked: true },
      authTurnstile: new FakeElement(),
      authTurnstileToken: { value: "" },
      authPasswordForm: new FakeElement(),
      authLoginModeButton: new FakeElement(),
      authRegisterModeButton: new FakeElement(),
      authNicknameInput: new FakeElement(),
      authEmailInput: new FakeElement(),
      authPasswordInput: new FakeElement(),
      authPasswordButton: new FakeElement(),
      closeAuthModalButton: new FakeElement()
    };

    try {
      globalThis.Element = FakeElement;
      globalThis.HTMLElement = FakeElement;
      globalThis.window = {
        addEventListener() {},
        matchMedia(query) {
          return { matches: query.includes("960px") };
        }
      };
      globalThis.requestAnimationFrame = (task) => {
        task();
        return 0;
      };
      globalThis.localStorage = {
        getItem() {
          return null;
        },
        setItem() {}
      };
      globalThis.document = {
        documentElement: { dataset: {} },
        activeElement: null,
        addEventListener() {},
        querySelector() {
          return null;
        }
      };

      bindTopbarActionEvents(dom, {
        toggleTheme() {
          toggleThemeCalls += 1;
        },
        refreshCurrentTopic() {},
        submitMessage() {},
        flashTitle(message) {
          flashCalls.push(message);
        },
        state,
        async login() {
          loginCalls += 1;
          state.viewer = { id: "u1", type: "registered" };
        },
        async logout() {
          logoutCalls += 1;
          state.viewer = { id: "guest-mobile-after-logout", type: "guest" };
        },
        syncResponsiveView() {
          syncResponsiveViewCalls += 1;
        },
        backToTopics() {},
        openPaletteModal() {
          openPaletteModalCalls += 1;
        },
        openProfileModal() {
          openProfileModalCalls += 1;
        },
        closePaletteModal() {},
        closeDrawers() {
          closeDrawersCalls += 1;
        },
        updateCustomPaletteHex() {
          return true;
        },
        randomizeCustomPalette() {},
        selectPalette() {},
        createNewTopic() {}
      });

      assert.equal(authTools.hidden, true);
      assert.equal(dom.profileButton.hidden, true);
      assert.equal(dom.storeButton.hidden, true);
      assert.equal(dom.openRightDrawer.hidden, false);
      assert.equal(menuProfileButton.hidden, true);
      assert.equal(menuAuthButton.hidden, true);
      assert.equal(authButton.label.textContent, "Iniciar sesión");
      assert.equal(globalThis.document.documentElement.dataset.authState, "logged-out");
      assert.equal(authButton.hidden, false);
      assert.equal(themeToggle.parentElement, themeToggleMobileSlot);
      assert.equal(themeToggle.dataset.themeTogglePlacement, "mobile");

      authButton.dispatch("click");
      await flushAsyncEvents();

      assert.equal(dom.authModalBackdrop.hidden, false);
      assert.equal(dom.authModal["aria-hidden"], "false");
      assert.equal(loginCalls, 0);

      dom.authGoogleButton.dispatch("click");
      await flushAsyncEvents();
      await flushAsyncEvents();

      assert.equal(dom.authModalBackdrop.hidden, true);
      assert.equal(authTools.hidden, false);
      assert.equal(dom.profileButton.hidden, false);
      assert.equal(dom.storeButton.hidden, false);
      assert.equal(dom.openRightDrawer.hidden, false);
      assert.equal(menuProfileButton.hidden, false);
      assert.equal(menuAuthButton.hidden, false);
      assert.equal(loginCalls, 1);
      assert.equal(globalThis.document.documentElement.dataset.authState, "logged-in");
      assert.equal(flashCalls.at(-1), "Sesión iniciada");
      assert.equal(authButton.hidden, true);

      usersPanelButton.setAttribute = FakeElement.prototype.setAttribute;
      rankingPanelButton.setAttribute = FakeElement.prototype.setAttribute;
      openRightDrawer.dispatch("click");
      assert.equal(mobileDrawerPanels.hidden, true);

      mobileTopbarMenu.dispatch("click", { target: usersPanelButton });
      assert.equal(mobileDrawerPanels.hidden, false);
      assert.equal(mobileTopbarMenu.hidden, true);
      assert.equal(drawerUsersSection.hidden, false);
      assert.equal(drawerRankingsSection.hidden, true);
      assert.equal(usersPanelButton["aria-pressed"], "true");

      mobileTopbarMenu.dispatch("click", { target: rankingPanelButton });
      assert.equal(drawerUsersSection.hidden, true);
      assert.equal(drawerRankingsSection.hidden, false);
      assert.equal(rankingPanelButton["aria-pressed"], "true");

      mobileDrawerPanels.dispatch("click", { target: backButton });
      assert.equal(mobileDrawerPanels.hidden, true);
      assert.equal(mobileTopbarMenu.hidden, false);
      assert.equal(drawerRankingsSection.hidden, true);

      mobileTopbarMenu.dispatch("click", { target: menuProfileButton });

      themeToggle.dispatch("click");

      searchInput.value = "rank";
      searchInput.dispatch("input");
      assert.equal(menuProfileButton.classList.contains("is-search-hidden"), true);
      assert.equal(homeButton.classList.contains("is-search-hidden"), true);
      assert.equal(usersPanelButton.classList.contains("is-search-hidden"), true);
      assert.equal(rankingPanelButton.classList.contains("is-search-hidden"), false);

      mobileTopbarMenu.dispatch("click", { target: paletteTarget });
      mobileTopbarMenu.dispatch("click", { target: homeButton });

      mobileTopbarMenu.dispatch("click", { target: menuAuthButton });
      await flushAsyncEvents();

      assert.equal(logoutCalls, 0);
      assert.equal(globalThis.document.documentElement.dataset.authState, "logged-in");
      assert.equal(flashCalls.at(-1), "Toca de nuevo para cerrar sesión");

      mobileTopbarMenu.dispatch("click", { target: menuAuthButton });
      await flushAsyncEvents();

      assert.equal(closeDrawersCalls, 4);
      assert.equal(toggleThemeCalls, 1);
      assert.equal(openPaletteModalCalls, 1);
      assert.equal(openProfileModalCalls, 1);
      assert.equal(logoutCalls, 1);
      assert.equal(state.mobileView, "browse");
      assert.equal(syncResponsiveViewCalls, 1);
      assert.equal(flashCalls.includes("Perfil listo para conectar"), false);
      assert.equal(globalThis.document.documentElement.dataset.authState, "logged-out");
      assert.equal(authButton.hidden, false);
    } finally {
      globalThis.requestAnimationFrame = previousRequestAnimationFrame;
      globalThis.window = previousWindow;
      globalThis.localStorage = previousLocalStorage;
      globalThis.document = previousDocument;
      globalThis.Element = previousElement;
      globalThis.HTMLElement = previousHTMLElement;
    }
  });

  await test("topbar auth does not announce success before the OAuth redirect completes", async () => {
    const previousDocument = globalThis.document;
    const previousElement = globalThis.Element;
    const previousHTMLElement = globalThis.HTMLElement;
    const previousWindow = globalThis.window;

    class FakeElement {
      constructor() {
        this.dataset = {};
        this.listeners = new Map();
        this.hidden = false;
        this.className = "";
        this.parentElement = null;
        this.textContent = "";
        const classValues = new Set();
        this.classList = {
          add: (...tokens) => tokens.forEach((token) => classValues.add(token)),
          remove: (...tokens) => tokens.forEach((token) => classValues.delete(token)),
          toggle: (token, force) => {
            if (force === undefined) {
              if (classValues.has(token)) {
                classValues.delete(token);
                return false;
              }
              classValues.add(token);
              return true;
            }
            if (force) {
              classValues.add(token);
              return true;
            }
            classValues.delete(token);
            return false;
          },
          contains: (token) => classValues.has(token)
        };
      }

      addEventListener(type, listener) {
        this.listeners.set(type, listener);
      }

      dispatch(type, event = {}) {
        this.listeners.get(type)?.({
          preventDefault() {},
          stopImmediatePropagation() {},
          ...event,
          target: event.target || this
        });
      }

      querySelector(selector) {
        if (selector === ".button-label") {
          return this.label;
        }

        return null;
      }

      append(child) {
        child.parentElement = this;
      }

      setAttribute(name, value) {
        this[name] = value;
      }
    }

    const authButton = new FakeElement();
    authButton.label = { textContent: "" };
    const authGoogleButton = new FakeElement();
    authGoogleButton.authLabel = { textContent: "Continuar con Google" };
    authGoogleButton.querySelector = (selector) =>
      [".auth-google-button__label", "span:last-child", "span"].includes(selector)
        ? authGoogleButton.authLabel
        : null;
    const authStatus = new FakeElement();
    const flashCalls = [];
    let resolveRedirect;
    const redirectPromise = new Promise((resolve) => {
      resolveRedirect = resolve;
    });
    const state = {
      viewer: { id: "guest-redirect", type: "guest" }
    };

    try {
      globalThis.Element = FakeElement;
      globalThis.HTMLElement = FakeElement;
      globalThis.window = {
        addEventListener() {},
        matchMedia() {
          return { matches: false };
        }
      };
      globalThis.document = {
        documentElement: { dataset: {} },
        addEventListener() {},
        querySelector() {
          return null;
        }
      };

      bindTopbarActionEvents(
        {
          themeToggle: new FakeElement(),
          refreshButton: new FakeElement(),
          messageForm: new FakeElement(),
          profileButton: new FakeElement(),
          openRightDrawer: new FakeElement(),
          backToTopics: new FakeElement(),
          storeButton: new FakeElement(),
          paletteButton: new FakeElement(),
          themeToggleDesktopSlot: new FakeElement(),
          themeToggleMobileSlot: new FakeElement(),
          closePaletteModalButton: new FakeElement(),
          paletteModalBackdrop: new FakeElement(),
          paletteOptionGrid: new FakeElement(),
          createTopicButton: new FakeElement(),
          friendRequestsButton: new FakeElement(),
          notificationsButton: new FakeElement(),
          authButton,
          authTools: new FakeElement(),
          authModalBackdrop: new FakeElement(),
          authModal: new FakeElement(),
          authGoogleButton,
          authGoogleTermsInput: { checked: true },
          authTurnstile: new FakeElement(),
          authTurnstileToken: { value: "" },
          authStatus,
          authPasswordForm: new FakeElement(),
          authLoginModeButton: new FakeElement(),
          authRegisterModeButton: new FakeElement(),
          authNicknameInput: new FakeElement(),
          authEmailInput: new FakeElement(),
          authPasswordInput: new FakeElement(),
          authPasswordButton: new FakeElement(),
          closeAuthModalButton: new FakeElement()
        },
        {
          toggleTheme() {},
          refreshCurrentTopic() {},
          submitMessage() {},
          flashTitle(message) {
            flashCalls.push(message);
          },
          state,
          async login() {
            return redirectPromise;
          },
          async logout() {},
          backToTopics() {},
          openPaletteModal() {},
          closePaletteModal() {},
          updateCustomPaletteHex() {
            return true;
          },
          randomizeCustomPalette() {},
          selectPalette() {},
          createNewTopic() {}
        }
      );

      authButton.dispatch("click");
      await flushAsyncEvents();
      authGoogleButton.dispatch("click");
      await flushAsyncEvents();
      await flushAsyncEvents();

      assert.equal(authGoogleButton.authLabel.textContent, "Continuar con Google");
      assert.equal(authGoogleButton["aria-busy"], "true");
      assert.equal(authGoogleButton.disabled, true);
      assert.equal(authStatus.textContent, "");
      assert.equal(authStatus.hidden, false);
      assert.equal(authStatus.dataset.statusKind, "off");
      assert.deepEqual(flashCalls, []);
      assert.equal(state.viewer.type, "guest");
      assert.equal(globalThis.document.documentElement.dataset.authState, "logged-out");

      resolveRedirect({ redirected: true });
      await flushAsyncEvents();
      await flushAsyncEvents();

      assert.equal(authGoogleButton.authLabel.textContent, "Continuar con Google");
      assert.equal(authGoogleButton["aria-busy"], "false");
      assert.equal(authGoogleButton.disabled, false);
    } finally {
      globalThis.document = previousDocument;
      globalThis.Element = previousElement;
      globalThis.HTMLElement = previousHTMLElement;
      globalThis.window = previousWindow;
    }
  });

  await test("renderTitles syncs theme switch semantics with current theme and page title", () => {
    const previousDocument = globalThis.document;
    const themeToggle = {
      setAttribute(name, value) {
        this[name] = value;
      }
    };

    const state = {
      topics: [],
      selectedTopicId: null,
      rankingScope: "global",
      globalRankingIndex: 0,
      topicRankingIndex: 0,
      theme: "dark"
    };

    try {
      globalThis.document = { title: "" };

      renderTitles(state, { themeToggle });
      assert.equal(themeToggle.role, "switch");
      assert.equal(themeToggle["aria-checked"], "true");
      assert.equal(themeToggle["aria-label"], "Tema oscuro");
      assert.equal(themeToggle.title, "Cambiar a tema claro");
      assert.equal(document.title, "TOPYKLY");

      state.theme = "light";
      state.topics = [{ id: "topic-1", title: "Tema alpha", subtitle: "Subtitulo", messages: [] }];
      state.selectedTopicId = "topic-1";
      renderTitles(state, { themeToggle });
      assert.equal(themeToggle["aria-checked"], "false");
      assert.equal(themeToggle.title, "Cambiar a tema oscuro");
      assert.equal(document.title, "TOPYKLY - Tema alpha");
    } finally {
      globalThis.document = previousDocument;
    }
  });

  await test("quote action writes author and message lines with cursor after the quote", () => {
    const quotedMessage = createMessage("u2", "Mensaje citado con    espacios", 0, "user", 1_700_000_070_000);
    quotedMessage.id = "message-quoted";
    const topics = [{ id: "topic-quote", title: "Tema", messages: [quotedMessage] }];
    const users = [{ id: "u2", name: "Sergio13134" }];
    const state = {
      topics,
      users,
      selectedTopicId: "topic-quote",
      unreadTopicIds: [],
      followedTopicIds: []
    };
    const selection = [];
    const messageInput = {
      value: "",
      maxLength: 240,
      scrollTop: 0,
      scrollHeight: 118,
      focusOptions: null,
      focus(options = null) {
        this.focusOptions = options;
      },
      setSelectionRange(start, end) {
        selection.push([start, end]);
      }
    };
    let renderCalls = 0;
    const actions = createChatActions({
      state,
      dom: { messageInput },
      render: () => {
        renderCalls += 1;
      }
    });

    actions.quoteMessage("message-quoted");

    const expectedQuote = "> @Sergio13134\n> Mensaje citado con espacios\n\n";
    assert.equal(messageInput.value, expectedQuote);
    assert.deepEqual(selection.at(-1), [expectedQuote.length, expectedQuote.length]);
    assert.equal(messageInput.scrollTop, 118);
    assert.equal(renderCalls, 1);
  });

  await test("quoted messages render the quote in a framed block above the reply", () => {
    const previousDocument = globalThis.document;

    class MockNode {
      constructor(tagName) {
        this.tagName = tagName;
        this.children = [];
        this.dataset = {};
        this.attributes = new Map();
        this.className = "";
        this.textContent = "";
        this.hidden = false;
        this.classList = {
          add: (...tokens) => {
            this.className = [this.className, ...tokens].filter(Boolean).join(" ");
          },
          contains: (token) => this.className.split(/\s+/).includes(token)
        };
      }

      append(...nodes) {
        this.children.push(...nodes);
      }

      appendChild(node) {
        this.children.push(node);
        return node;
      }

      setAttribute(name, value) {
        this.attributes.set(name, value);
      }

      querySelectorAll(selector) {
        const matches = [];
        const visit = (node) => {
          if (selector === "button" && node.tagName === "button") {
            matches.push(node);
          }
          node.children.forEach(visit);
        };
        this.children.forEach(visit);
        return matches;
      }
    }

    function findByClass(node, className) {
      if (node.className.split(/\s+/).includes(className)) {
        return node;
      }
      for (const child of node.children) {
        const match = findByClass(child, className);
        if (match) {
          return match;
        }
      }
      return null;
    }

    try {
      globalThis.document = {
        createElement: (tagName) => new MockNode(tagName),
        createElementNS: (namespace, tagName) => new MockNode(tagName)
      };

      const message = createMessage("u2", "> @Sergio13134\n> Mensaje citado\n\nRespuesta propia", 0, "user", 1_700_000_070_000);
      const node = createMessageItem(message, [{ id: "u2", name: "Sergio13134" }]);

      assert.equal(findByClass(node, "message__quote-author").textContent, "@Sergio13134");
      assert.equal(findByClass(node, "message__quote-text").textContent, "Mensaje citado");
      assert.equal(findByClass(node, "message__text").textContent, "Respuesta propia");
    } finally {
      globalThis.document = previousDocument;
    }
  });
  await test("source files stay free of mojibake markers", async () => {
    const files = await collectSourceFiles(rootDir);
    const offenders = [];

    for (const file of files) {
      const text = await readFile(file, "utf8");
      const hit = MOJIBAKE_PATTERNS.find((pattern) => text.includes(pattern));
      if (hit) {
        offenders.push(`${path.relative(rootDir, file)} => ${JSON.stringify(hit)}`);
      }
    }

    assert.equal(offenders.length, 0, offenders.join("\n"));
  });

  await test("index and app structure stay trimmed", async () => {
    const html = await read("index.html");
    const app = await read("app.js");
    const components = await read("components.js");
    const controller = await read("controller.js");
    const controllerApp = await read("controller-app.js");
    const controllerTheme = await read("controller-theme.js");
    const controllerViewport = await read("controller-viewport.js");
    const actions = await read("controller-actions.js");
    const chatActions = await read("controller-chat-actions.js");
    const rankingActions = await read("controller-ranking-actions.js");
    const rankingState = await read("ranking-state.js");
    const palettes = await read("palettes.js");
    const responsiveController = await read("controller-responsive.js");
    const renderController = await read("controller-render.js");
    const stateStore = await read("state-store.js");
    const domStore = await read("dom-store.js");
    const timerStore = await read("timer-store.js");
    const store = await read("app-store.js");
    const data = await read("data.js");
    const styles = await read("styles.css");
    const domModule = await read("ui/dom.js");
    const eventsModule = await read("ui/events.js");
    const chat = await read("ui/chat.js");
    const rankings = await read("ui/rankings.js");
    const rankingPanelState = await read("ui/ranking-panel-state.js");
    const rankingLabels = await read("ui/ranking-labels.js");
    const rankingIcons = await read("ui/ranking-icons.js");
    const paletteModal = await read("ui/palette-modal.js");
    const publicProfileModal = await read("ui/public-profile-modal.js");
    const profileModal = await read("ui/profile-modal.js");
    const adminPanel = await read("ui/admin-panel.js");
    const icons = await read("ui/icons.js");
    const sharedBaseComponents = await read("features/shared/components/base.js");
    const dateUtils = await read("ui/date-utils.js");
    const titles = await read("ui/titles.js");
    const topics = await read("ui/topics.js");
    const users = await read("ui/users.js");
    const renderUtils = await read("ui/render-utils.js");
    assert.doesNotMatch(renderUtils, /outerHTML/);
    assert.match(renderUtils, /function patchElement\(existing, incoming\)/);
    assert.match(renderUtils, /shouldPreserveOpenOverlayState/);
    assert.match(
      renderUtils,
      /existing\.dataset\.messageMenu[\s\S]*existing\.dataset\.messageReactionMenu[\s\S]*existing\.dataset\.userMenu/
    );
    assert.match(renderUtils, /function patchChildren\(existing, incoming\)/);
    const previewServer = await read("services/preview-server.js");
    const backendStore = await read("services/backend-store.js");
    assert.match(
      previewServer,
      /await authService\.validateTurnstile[\s\S]*const authLoginResponse = await authService\.createLoginResponse/
    );
    assert.match(
      previewServer,
      /if \(authLoginResponse\) \{[\s\S]*sendJson\(res, 200, authLoginResponse\.payload/
    );
    assert.match(previewServer, /segments\.some\(\(segment\) => segment\.startsWith\("\."\)\)/);
    assert.match(previewServer, /PUBLIC_SERVICE_MODULES/);
    assert.match(
      previewServer,
      /socialWhatsapp: body\.socialWhatsapp,[\s\S]*socialInstagram: body\.socialInstagram,[\s\S]*socialTiktok: body\.socialTiktok,[\s\S]*socialFacebook: body\.socialFacebook,[\s\S]*socialTwitter: body\.socialTwitter,[\s\S]*socialDiscord: body\.socialDiscord,[\s\S]*profileShowSocial: body\.profileShowSocial !== false/
    );
    assert.match(previewServer, /PROTECTED_STATIC_DIRECTORIES/);
    assert.match(previewServer, /PROTECTED_STATIC_ROOT_FILES/);
    assert.match(previewServer, /segments\[0\] === "services"/);
    assert.match(previewServer, /PROTECTED_STATIC_DIRECTORIES\.has\(segments\[0\] \|\| ""\)/);
    assert.match(previewServer, /path\.relative\(root, absolutePath\)/);
    assert.match(
      previewServer,
      /relativePath\.startsWith\("\.\."\) \|\| path\.isAbsolute\(relativePath\)/
    );
    assert.match(previewServer, /"X-Content-Type-Options": "nosniff"/);
    assert.match(previewServer, /"X-Frame-Options": "DENY"/);
    assert.match(
      previewServer,
      /"Permissions-Policy": "camera=\(\), microphone=\(\), geolocation=\(\)"/
    );
    assert.match(previewServer, /"Content-Security-Policy"/);
    assert.match(previewServer, /base-uri 'self'/);
    assert.match(previewServer, /frame-ancestors 'none'/);
    assert.match(previewServer, /getSecurityHeaders\(\{ includeCsp: false, req: (?:res\.req|req) \}\)/);
    assert.match(previewServer, /getSecurityHeaders\(\{ includeCsp: extension === "\.html", req: res\.req \}\)/);
    assert.match(previewServer, /"Strict-Transport-Security"/);
    assert.match(previewServer, /DEFAULT_GUEST_CLEANUP_INTERVAL_MS/);
    assert.match(previewServer, /DEFAULT_HTTP_RATE_LIMIT_WINDOW_MS/);
    assert.match(previewServer, /MAX_JSON_BODY_BYTES = 3 \* 1024 \* 1024/);
    assert.match(previewServer, /content-length/);
    assert.match(previewServer, /PAYLOAD_TOO_LARGE/);
    assert.match(previewServer, /receivedBytes > maxBytes/);
    assert.match(previewServer, /req\.destroy\(\)/);
    assert.match(previewServer, /isLocalDevLoginAllowed/);
    assert.match(previewServer, /NODE_ENV/);
    assert.match(previewServer, /TOPYKLY_ALLOW_LOCAL_LOGIN/);
    assert.match(previewServer, /AUTH_NOT_CONFIGURED/);
    assert.match(previewServer, /function enforceHttpRateLimit\(res, buckets, req, url, config\)/);
    assert.match(previewServer, /sendJson\(res, 429/);
    assert.match(backendStore, /created_at AS createdAt/);
    assert.match(backendStore, /profile_show_description AS profileShowDescription/);
    assert.match(backendStore, /profile_show_joined_at AS profileShowJoinedAt/);
    assert.match(backendStore, /social_whatsapp AS socialWhatsapp/);
    assert.match(backendStore, /profile_show_social AS profileShowSocial/);
    assert.match(backendStore, /function normalizeSocialHandle\(value, label\)/);
    assert.match(backendStore, /function normalizeSocialWhatsapp\(value\)/);
    assert.match(backendStore, /function getFrontendUsers\(db, viewerId, profileUserIds = \[\]\)/);
    assert.match(
      backendStore,
      /users: getFrontendUsers\(db, context\.viewer\.id, profileUserIds\)/
    );
    assert.match(previewServer, /"Retry-After": String\(result.retryAfterSeconds\)/);
    assert.match(
      previewServer,
      /if \(!enforceHttpRateLimit\(res, httpRateLimitBuckets, req, url, httpRateLimitConfig\)\)/
    );
    assert.match(
      previewServer,
      /setInterval\(\(\) => runGuestCleanup\(store, log\), guestCleanupIntervalMs\)/
    );
    assert.match(previewServer, /clearInterval\(guestCleanupTimer\)/);
    const vercelConfig = await read("vercel.json");
    assert.match(vercelConfig, /"key": "Permissions-Policy"/);
    assert.match(vercelConfig, /"value": "camera=\(\), microphone=\(\), geolocation=\(\)"/);
    assert.match(vercelConfig, /"key": "Content-Security-Policy"/);
    assert.match(vercelConfig, /base-uri 'self'/);
    const drawers = await read("ui/drawers.js");
    const topbar = await read("ui/topbar.js");
    const topbarActionEvents = await read("ui/topbar-action-events.js");

    assert.match(html, /<title>TOPYKLY<\/title>/);
    assert.match(html, /<main id="main-content" class="workspace" aria-label="Chat social">/);
    assert.match(html, /class="topbar__title" aria-label="TOPYKLY"/);
    assert.match(html, /class="brand-mark__che">TOPY<\/span>/);
    assert.match(html, /class="brand-mark__trend">KLY<\/span>/);
    assert.match(html, /id="topicList"/);
    assert.match(html, /id="createTopicButton"/);
    assert.match(html, /id="createTopicButton"[\s\S]*aria-label="Crear nuevo tema de chat"/);
    assert.match(html, /id="topicTitleInput"/);
    assert.match(html, /id="topicTitleInput"[\s\S]*aria-label="Titulo del nuevo tema"/);
    assert.match(html, /id="chatTitle"/);
    assert.match(
      html,
      /class="panel__header-title"[\s\S]*id="backToTopics"[\s\S]*aria-label="Volver a temas"[\s\S]*id="chatTitle"/
    );
    assert.match(html, /id="reportTopicButton"/);
    assert.match(html, /icon-button--refresh/);
    assert.match(html, /id="leftDrawerTopics"/);
    assert.match(html, /refresh-button__wheel/);
    assert.match(html, /id="backToTopics"/);
    assert.match(html, /placeholder="Escribe aqui\.\.\."/);
    assert.match(html, /id="messageInput"[\s\S]*aria-label="Mensaje del chat"/);
    assert.match(
      html,
      /<button class="primary-button" type="submit" aria-label="Enviar mensaje al chat">/
    );
    assert.match(html, /<p class="panel__kicker">Menú<\/p>/);
    assert.match(html, /id="rankingPrev"/);
    assert.match(html, /id="rankingCurrent"/);
    assert.match(html, /id="rankingNext"/);
    assert.match(html, /id="drawerRankingPrev"/);
    assert.match(html, /id="drawerRankingCurrent"/);
    assert.match(html, /id="drawerRankingNext"/);
    assert.match(html, /id="rankingScopeTabs"/);
    assert.match(html, /id="rankingModeList"/);
    assert.match(html, /id="drawerRankingScopeTabs"/);
    assert.doesNotMatch(html, /id="drawerRankingModeList"/);
    assert.match(html, /id="drawerUsersSection"[\s\S]*<h3>Usuarios activos<\/h3>/);
    assert.doesNotMatch(html, /[\u00daU]ltimos usuarios activos/);
    assert.match(html, /id="paletteModalBackdrop"/);
    assert.match(html, /id="paletteModal"/);
    assert.match(html, /id="paletteModal"[\s\S]*aria-label="Selector de paletas"/);
    assert.match(html, /class="palette-modal__body"/);
    assert.match(html, /id="paletteOptionGrid"/);
    assert.match(html, /id="authGoogleButton"[\s\S]*id="authPasswordForm"/);
    assert.doesNotMatch(html, /id="authGoogleTermsInput"/);
    assert.match(
      html,
      /id="authGoogleButton"[^>]*disabled[\s\S]*Continuar con Google[\s\S]*auth-google-button__spinner/
    );
    assert.match(html, /data-auth-mode="register">Crear cuenta<\/button>/);
    assert.match(html, /id="authBackButton"[^>]*>[\s\S]*Volver[\s\S]*<\/button>/);
    assert.match(html, /Nombre de Usuario[\s\S]*id="authNicknameInput"/);
    assert.match(html, /Email[\s\S]*id="authEmailInput"[\s\S]*required/);
    assert.match(
      html,
      /Fecha de nacimiento[\s\S]*id="authBirthDay"[\s\S]*id="authBirthMonth"[\s\S]*id="authBirthYear"[\s\S]*id="authAgeInput"[\s\S]*type="hidden"[\s\S]*min="16"/
    );
    assert.match(
      html,
      /Código de acceso[\s\S]*id="authCodeBoxes"[\s\S]*(?:class="auth-code-box"[\s\S]*autocomplete="one-time-code"[\s\S]*){6}id="authCodeInput"[\s\S]*type="hidden"/
    );
    assert.match(html, /id="authTermsInput"[\s\S]*Términos y Condiciones/);
    assert.match(html, /id="authSendCodeAgainButton"/);
    assert.match(html, /class="auth-field-error-marker"[\s\S]*>\*<\/span>/);
    assert.doesNotMatch(html, /id="auth(?:Nickname|Email|Age|Code)Input"[^>]*placeholder=/);
    assert.match(html, /<h2 class="profile-modal__title">Perfil<\/h2>/);
    assert.match(
      html,
      /<meta name="description" content="TOPYKLY es una comunidad social para conversar por temas, descubrir rankings, conectar con usuarios y personalizar tu perfil\." \/>/
    );
    assert.match(
      html,
      /id="profileNameSection"[\s\S]*data-editing="false"[\s\S]*id="profileAvatarPreview"/
    );
    assert.match(
      html,
      /id="profileNameEditButton"[\s\S]*aria-label="Editar nombre visible"[\s\S]*data-profile-section-edit="name"/
    );
    assert.match(html, /id="profileNameFeedback"/);
    assert.match(html, /id="profileNameInput"[\s\S]*readonly/);
    assert.match(
      html,
      /id="profileDescriptionEditButton"[\s\S]*aria-label="Editar descripción"[\s\S]*data-profile-section-edit="description"/
    );
    assert.match(html, /id="profileDescriptionInput"[\s\S]*maxlength="180"[\s\S]*readonly/);
    assert.doesNotMatch(html, /id="profileDescriptionInput"[\s\S]*rows=/);
    assert.match(html, /id="profileAvatarPreview"[\s\S]*aria-label="Cambiar avatar"/);
    assert.match(
      html,
      /<img class="profile-avatar-crop__image" id="profileAvatarCropImage" alt="" width="320" height="320" \/>[\s\S]*<span class="profile-avatar-crop__window" aria-hidden="true"><\/span>/
    );
    assert.match(html, /id="profileJoinedAtText"/);
    assert.match(
      html,
      /id="profileJoinedAtVisibilityButton"[\s\S]*data-profile-visibility="joinedAt"/
    );
    assert.match(
      html,
      /id="profileDescriptionVisibilityButton"[\s\S]*data-profile-visibility="description"/
    );
    assert.match(
      html,
      /id="profileSocialVisibilityButton"[\s\S]*data-profile-visibility="social"/
    );
    assert.match(html, /id="socialWhatsappInput"/);
    assert.match(html, /id="socialInstagramInput"/);
    assert.match(html, /id="socialTiktokInput"/);
    assert.match(html, /id="socialFacebookInput"/);
    assert.match(html, /id="socialTwitterInput"/);
    assert.match(html, /id="socialDiscordInput"/);
    assert.match(html, /id="publicProfileSocial"/);
    assert.match(
      html,
      /id="socialWhatsappInput"[^>]*readonly[^>]*aria-readonly="true"[\s\S]*profile-modal__social-edit[\s\S]*type="button"[\s\S]*data-profile-social-edit/
    );
    assert.doesNotMatch(html, /profile-modal__social-edit" type="submit"/);
    assert.match(styles, /\.profile-modal__social-field\.is-editing \.profile-modal__social-check-icon\s*\{[\s\S]*display:\s*block;/);
    assert.match(html, /id="profileAvatarPickButton"[\s\S]*Elegir avatar/);
    assert.doesNotMatch(
      html,
      /Foto de perfil|Elegir foto|<span>Avatar<\/span>|id="profileAvatarEditButton"/
    );
    assert.match(html, /id="skipProfileButton"[\s\S]*>Cancelar<\/button>/);
    assert.doesNotMatch(
      html,
      /Puedes completar esto ahora|Quitar seleccion|id="profileAvatarClearButton"/
    );
    assert.doesNotMatch(html, /id="paletteModalTitle"/);
    assert.match(
      html,
      /cdn\.jsdelivr\.net\/gh\/mdbassit\/Coloris@v0\.25\.0\/dist\/coloris\.min\.css/
    );
    assert.match(
      html,
      /cdn\.jsdelivr\.net\/gh\/mdbassit\/Coloris@v0\.25\.0\/dist\/coloris\.min\.js/
    );
    assert.doesNotMatch(html, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/);
    assert.match(
      html,
      /integrity="sha384-DY3umZptOgjUNshBFbvu1\+3RVFPoD1\/CgGcc1yyJ77\/aFOJ7jtN4BORnz\/D\/xF0n"/
    );
    assert.match(
      html,
      /integrity="sha384-olpkBKjEFqOOAAUzqL1y4xnKDCVmmXNaoRDWmHnRTutomMnUySX9hqDgVQVcvMdc"/
    );
    assert.match(html, /crossorigin="anonymous"/);
    assert.match(
      html,
      /localStorage\.getItem\("topykly-theme"\) \|\| localStorage\.getItem\("chetrend-theme"\) \|\| "dark"/
    );
    assert.match(
      html,
      /localStorage\.getItem\("topykly-palette"\) \|\| localStorage\.getItem\("chetrend-palette"\) \|\| "default"/
    );
    assert.match(html, /const authState = "logged-out";/);
    assert.match(html, /window\.matchMedia\("\(max-width: 960px\)"\)\.matches/);
    assert.match(html, /document\.documentElement\.dataset\.authState = authState/);
    assert.match(
      html,
      /document\.documentElement\.classList\.toggle\("is-mobile-viewport", mobile\)/
    );
    assert.match(
      html,
      /document\.documentElement\.classList\.toggle\("is-desktop-viewport", !mobile\)/
    );
    assert.match(
      styles,
      /html\[data-auth-state="logged-out"\] \[data-auth-private\]\s*\{[\s\S]*display:\s*none !important;/
    );
    assert.match(html, /id="authGoogleButton"[\s\S]*id="authTurnstile"/);
    assert.doesNotMatch(html, /Resend|Google ya esta disponible|auth-modal__note/);
    assert.match(html, /id="authTools"[\s\S]*hidden/);
    assert.match(html, /data-auth-private/);
    assert.match(html, /id="mobileTopbarMenu"/);
    assert.match(
      html,
      /data-mobile-topbar-action="profile"[\s\S]*class="drawer-action-button__label">Perfil/
    );
    assert.match(
      html,
      /data-mobile-topbar-action="home"[\s\S]*class="drawer-action-button__label">Inicio/
    );
    assert.match(html, /class="drawer-action-button__icon"/);
    assert.match(html, /id="mobileDrawerSearch"[\s\S]*type="text"/);
    assert.match(html, /id="mobileDrawerPanels" hidden/);
    assert.match(html, /id="themeToggleDesktopSlot"/);
    assert.match(html, /id="themeToggleMobileSlot"/);
    assert.match(html, /id="themeToggleTemplate"/);
    assert.match(html, /id="paletteButton"[\s\S]*id="themeToggleDesktopSlot"/);
    assert.match(
      html,
      /data-mobile-topbar-action="palette"[\s\S]*data-mobile-topbar-action="store"[\s\S]*class="drawer-action-button__label">Tienda/
    );
    assert.match(
      html,
      /id="themeToggleMobileSlot"[\s\S]*class="drawer-theme-slot"[\s\S]*id="themeToggleDrawerSlot"/
    );
    assert.match(html, /id="profileButton"[\s\S]*class="profile-button__avatar"/);
    assert.match(html, /id="publicProfileModalBackdrop"/);
    assert.match(html, /public-profile-modal__description-label">DESCRIPCIÓN<\/p>/);
    assert.match(html, /id="publicProfileDescription"/);
    assert.match(html, /id="publicProfileJoinedAt"/);
    assert.match(html, /id="publicProfileRecentCafes"/);
    assert.match(html, /id="publicProfileActions"/);
    assert.match(html, /id="publicProfileReportButton"[\s\S]*Reportar usuario/);
    assert.match(html, /class="theme-switch"/);
    assert.match(html, /role="switch"/);
    assert.match(html, /aria-checked="true"/);
    assert.match(html, /theme-switch__icons/);
    assert.match(html, /theme-switch__icon theme-switch__icon--light/);
    assert.match(html, /theme-switch__icon theme-switch__icon--dark/);
    assert.doesNotMatch(html, /id="mobileThemeToggle"/);
    assert.match(html, /A8\.5 8\.5 0 1 1 9\.8 4a7 7 0 0 0 10\.2 10\.2Z/);
    assert.match(html, /data-mobile-topbar-action="auth"/);
    assert.match(html, /data-mobile-topbar-action="home"/);
    assert.match(html, /drawer-action-button drawer-action-button--auth/);
    assert.match(html, /data-mobile-topbar-action="palette"/);
    assert.match(html, /data-mobile-topbar-action="store"/);
    assert.doesNotMatch(html, /data-mobile-topbar-action="theme"/);
    assert.match(html, /data-mobile-drawer-panel="ranking"/);
    assert.match(html, /data-mobile-drawer-back/);
    assert.match(html, /id="drawerRankingsSection" hidden/);
    assert.doesNotMatch(html, /5 combinaciones con variante light y dark/);
    assert.doesNotMatch(html, /Personalizacion/);
    assert.match(html, /class="brand-mark__icon"[\s\S]*brand-mark__icon-base/);
    assert.match(html, /class="brand-mark__icon drawer__brand-icon"[\s\S]*brand-mark__icon-base/);
    assert.match(html, /<h3>Usuarios conectados<\/h3>/);
    assert.match(html, /<h3 id="rankingsTitle">Ranking<\/h3>/);
    assert.match(html, /<h3 id="drawerRankingsTitle">Ranking<\/h3>/);
    assert.doesNotMatch(
      html,
      /createTopicForm|mobileCreateTopicForm|Nuevo tema|Ordenados por presencia/
    );
    assert.match(data, /"Caf\u00e9 de madrugada"/);
    assert.match(data, /"Moderaci\u00f3n"/);
    assert.match(
      styles,
      /\.topic-item__title,\s*\.topic-item__meta\s*\{[\s\S]*text-overflow:\s*ellipsis;/
    );
    assert.match(styles, /\.topic-item\s*\{[\s\S]*width:\s*100%;[\s\S]*min-width:\s*0;/);
    assert.match(
      styles,
      /\.workspace\s*\{[\s\S]*grid-template-columns:\s*minmax\(275px,\s*1fr\)\s*minmax\(0,\s*1\.78fr\)\s*minmax\(275px,\s*1fr\);/
    );
    assert.match(styles, /\.topbar__auth-tools\[hidden\]\s*\{[\s\S]*display:\s*none;/);
    assert.match(
      styles,
      /html\.is-desktop-viewport \.panel--topics \.topic-item__title\s*\{[\s\S]*font-size:\s*0\.98rem;/
    );
    assert.match(styles, /\.brand-mark__icon\s*\{[\s\S]*color:\s*var\(--accent\);/);
    assert.match(styles, /\.brand-mark__icon-base\s*\{[\s\S]*fill:\s*currentColor;/);
    assert.match(
      styles,
      /\.brand-mark__icon-stroke\s*\{[\s\S]*stroke:\s*var\(--button-fill-text\);/
    );
    assert.match(
      styles,
      /:root\s*\{[\s\S]*--ranking-badge-border:\s*color-mix\(in srgb,\s*#f2b97a 62%,\s*var\(--line\)\);/
    );
    assert.match(styles, /:root\s*\{[\s\S]*--button-fill-bg:\s*var\(--accent-strong\);/);
    assert.match(styles, /html\[data-theme="light"\]\[data-palette="coast"\]\s*\{/);
    assert.match(
      styles,
      /html\[data-theme="light"\]\[data-palette="coast"\]\s*\{[\s\S]*--surface:\s*rgba\(205,\s*228,\s*232,\s*0\.86\);[\s\S]*--surface-strong:\s*rgba\(197,\s*221,\s*226,\s*0\.95\);/
    );
    assert.match(
      styles,
      /\.panel__header-title\s*\{[\s\S]*display:\s*flex;[\s\S]*align-items:\s*center;[\s\S]*gap:\s*10px;[\s\S]*min-width:\s*0;/
    );
    assert.match(styles, /\.chat-header__back\s*\{[\s\S]*display:\s*none;[\s\S]*flex:\s*none;/);
    assert.match(
      styles,
      /\.palette-modal-backdrop\s*\{[\s\S]*position:\s*fixed;[\s\S]*z-index:\s*40;/
    );
    assert.match(styles, /\.palette-modal__header\s*\{[\s\S]*justify-content:\s*flex-end;/);
    assert.match(
      styles,
      /\.palette-modal\s*\{[\s\S]*position:\s*relative;[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);[\s\S]*overflow:\s*hidden;/
    );
    assert.match(
      styles,
      /\.palette-modal__body\s*\{[\s\S]*overflow:\s*auto;[\s\S]*padding-right:\s*4px;/
    );
    assert.match(
      styles,
      /\.palette-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/
    );
    assert.match(
      styles,
      /\.palette-grid__featured\s*\{[\s\S]*grid-column:\s*1 \/ -1;[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/
    );
    assert.match(
      styles,
      /@media \(max-width:\s*720px\)\s*\{[\s\S]*\.palette-grid\s*\{[\s\S]*grid-template-columns:\s*1fr;/
    );
    assert.match(
      styles,
      /@media \(max-width:\s*720px\)\s*\{[\s\S]*\.palette-grid__featured\s*\{[\s\S]*grid-template-columns:\s*1fr;/
    );
    assert.match(
      styles,
      /@media \(min-width:\s*320px\) and \(max-width:\s*375px\)\s*\{[\s\S]*\.palette-modal\s*\{[\s\S]*max-width:\s*280px;/
    );
    assert.doesNotMatch(
      styles,
      /@media \(max-width:\s*720px\)\s*\{[\s\S]*\.palette-grid\s*\{[\s\S]*overflow-x:\s*auto;/
    );
    assert.doesNotMatch(
      styles,
      /@media \(max-width:\s*720px\)\s*\{[\s\S]*\.palette-modal__body::before,/
    );
    assert.match(
      styles,
      /\.palette-option\s*\{[\s\S]*padding:\s*12px;[\s\S]*border-radius:\s*14px;[\s\S]*transition:\s*[\s\S]*border-color 180ms ease,[\s\S]*background-color 180ms ease,[\s\S]*box-shadow 180ms ease;/
    );
    assert.match(
      styles,
      /\.palette-option:hover,\s*\.palette-option:focus-visible\s*\{[\s\S]*border-color:\s*color-mix\(in srgb,\s*var\(--accent\) 72%,\s*var\(--line\)\);[\s\S]*box-shadow:/
    );
    assert.doesNotMatch(
      styles,
      /\.palette-option:hover,\s*\.palette-option:focus-visible\s*\{[^}]*transform:/
    );
    assert.match(
      styles,
      /\.palette-option\.is-active\s*\{[\s\S]*border-color:\s*color-mix\(in srgb,\s*var\(--accent-strong\) 88%,\s*var\(--line\)\);[\s\S]*box-shadow:/
    );
    assert.match(styles, /\.palette-option--action\s*\{[\s\S]*place-content:\s*center;/);
    assert.match(
      styles,
      /\.palette-option__controls\s*\{[\s\S]*grid-template-columns:\s*44px minmax\(0,\s*1fr\);/
    );
    assert.match(
      styles,
      /\.palette-option--custom \.palette-option__modes\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/
    );
    assert.match(
      styles,
      /\.palette-option__sample-layout\s*\{[\s\S]*grid-template-columns:\s*0\.85fr 1\.2fr 0\.9fr;/
    );
    assert.match(styles, /\.palette-option__sample-bubble--accent\s*\{/);
    assert.match(styles, /\.palette-option__color-preview\s*\{/);
    assert.match(
      styles,
      /\.palette-option__color-preview:hover,\s*\.palette-option__color-preview:focus-visible,\s*\.palette-option__color-preview:focus-within\s*\{[\s\S]*box-shadow:/
    );
    assert.match(
      styles,
      /\.palette-option__color-swatch\s*\{[\s\S]*var\(--palette-custom-preview\)/
    );
    assert.match(
      styles,
      /\.palette-option__color-picker-input\s*\{[\s\S]*position:\s*absolute;[\s\S]*opacity:\s*0;/
    );
    assert.match(styles, /\.clr-clear\s*\{[\s\S]*display:\s*none !important;/);
    assert.match(
      styles,
      /\.clr-picker\.clr-open\s*\{[\s\S]*grid-template-areas:\s*[\s\S]*"actions actions";/
    );
    assert.match(
      styles,
      /\.palette-picker__actions\s*\{[\s\S]*grid-template-columns:\s*1fr;[\s\S]*align-items:\s*stretch;/
    );
    assert.match(
      styles,
      /\.palette-picker__dismiss-button,\s*\.palette-picker__actions \.clr-close\s*\{[\s\S]*min-height:\s*40px;/
    );
    assert.match(
      styles,
      /\.palette-picker__actions \.clr-close\s*\{[\s\S]*background:\s*var\(--button-fill-bg\);/
    );
    assert.match(styles, /\.palette-option__hex-label\s*\{/);
    assert.match(styles, /\.palette-option__hex-input\s*\{[\s\S]*text-transform:\s*uppercase;/);
    assert.match(styles, /\.palette-option__sample-surface\s*\{[\s\S]*min-height:\s*68px;/);
    assert.match(
      styles,
      /--palette-modal-scrollbar-thumb:\s*color-mix\(in srgb,\s*var\(--accent\) 74%,\s*var\(--bg\) 26%\);/
    );
    assert.match(
      styles,
      /\.palette-modal__body::-webkit-scrollbar-thumb\s*\{[\s\S]*background:\s*var\(--palette-modal-scrollbar-thumb\);/
    );
    assert.match(
      styles,
      /html\[data-custom-picker-open="false"\] \.clr-picker:not\(\.clr-open\),[\s\S]*\.clr-picker:not\(\.clr-open\)\s*\{[\s\S]*display:\s*none !important;/
    );
    assert.match(
      styles,
      /html\[data-theme="dark"\]\s*\{[\s\S]*--ranking-badge-border:\s*color-mix\(in srgb,\s*#f2b97a 62%,\s*var\(--line\)\);/
    );
    assert.match(
      styles,
      /html:not\(\[data-theme="dark"\]\) #profileButton,\s*[\s\S]*#themeToggle,\s*[\s\S]*#paletteButton,\s*[\s\S]*#contactAdminButton\s*\{[\s\S]*color:\s*#000;/
    );
    assert.match(
      styles,
      /#profileButton\s*\{[\s\S]*min-height:\s*44px;[\s\S]*padding:\s*0 14px 0 0;[\s\S]*gap:\s*0;[\s\S]*border-radius:\s*0;/
    );
    assert.match(
      styles,
      /html:not\(\[data-theme="dark"\]\) #profileButton \.button-label,\s*[\s\S]*#paletteButton \.theme-toggle__label,\s*[\s\S]*#contactAdminButton \.button-label\s*\{[\s\S]*color:\s*#000;/
    );
    assert.match(
      styles,
      /\.profile-button__avatar\s*\{[\s\S]*align-self:\s*stretch;[\s\S]*width:\s*42px;[\s\S]*margin:\s*0 0 0 -1px;[\s\S]*border-right:\s*1px solid[\s\S]*border-radius:\s*0;[\s\S]*background:\s*linear-gradient/
    );
    assert.match(styles, /\.profile-modal\s*\{[\s\S]*width:\s*min\(920px,\s*100%\);/);
    assert.match(
      styles,
      /\.profile-modal\s*\{[\s\S]*scrollbar-gutter:\s*stable;[\s\S]*scrollbar-color:\s*var\(--profile-modal-scrollbar-thumb\) var\(--profile-modal-scrollbar-track\);/
    );
    assert.match(
      styles,
      /\.profile-modal::-webkit-scrollbar-thumb\s*\{[\s\S]*border:\s*3px solid var\(--profile-modal-scrollbar-track\);[\s\S]*border-radius:\s*999px;[\s\S]*background:\s*var\(--profile-modal-scrollbar-thumb\);/
    );
    assert.match(styles, /\.profile-modal__header\s*\{[\s\S]*padding:\s*16px 24px 14px;/);
    assert.match(styles, /\.profile-modal__title\s*\{[\s\S]*font-size:\s*1\.45rem;/);
    assert.match(styles, /\.profile-modal__bottom-row\s*\{[\s\S]*grid-row:\s*4;[\s\S]*justify-content:\s*space-between;/);
    assert.match(
      styles,
      /\.profile-modal__actions \.primary-button,[\s\S]*\.profile-modal__actions \.text-button\s*\{[\s\S]*min-height:\s*38px;/
    );
    assert.match(
      styles,
      /\.profile-modal__body\s*\{[\s\S]*padding:\s*12px 18px 16px;/
    );
    assert.match(
      styles,
      /\.profile-modal__preview\s*\{[\s\S]*grid-row:\s*2;[\s\S]*width:\s*min\(176px, 100%\);[\s\S]*justify-self:\s*center;/
    );
    assert.match(styles, /\.profile-modal__field--name\s*\{[\s\S]*grid-row:\s*1;/);
    assert.match(
      styles,
      /\.profile-modal__avatar-meta\s*\{[\s\S]*grid-row:\s*3;[\s\S]*justify-self:\s*center;[\s\S]*width:\s*min\(232px, 100%\);[\s\S]*border-bottom:\s*1px solid/
    );
    assert.match(
      styles,
      /\.profile-modal__joined\s*\{[\s\S]*width:\s*100%;[\s\S]*min-width:\s*0;/
    );
    assert.match(
      styles,
      /\.profile-modal__visibility-button\s*\{[\s\S]*width:\s*30px;[\s\S]*height:\s*30px;/
    );
    assert.match(
      styles,
      /\.profile-modal__field--description\s*\{[\s\S]*grid-column:\s*2;[\s\S]*grid-row:\s*1 \/ span 3;/
    );
    assert.match(
      styles,
      /\.profile-modal__field input,\s*\.profile-modal__field textarea\s*\{[\s\S]*max-width:\s*100%;[\s\S]*overflow-x:\s*hidden;/
    );
    assert.match(
      styles,
      /\.profile-modal__field textarea,\s*\.public-profile-modal__description\s*\{[\s\S]*overflow-wrap:\s*anywhere;[\s\S]*word-break:\s*break-word;/
    );
    assert.match(
      styles,
      /\.profile-modal__field--description textarea\s*\{[\s\S]*height:\s*100%;[\s\S]*max-height:\s*none;/
    );
    assert.match(
      styles,
      /\.profile-modal__field-heading\s*\{[\s\S]*justify-content:\s*space-between;/
    );
    assert.match(
      styles,
      /\.profile-modal__edit-button\s*\{[\s\S]*width:\s*30px;[\s\S]*height:\s*30px;/
    );
    assert.match(
      styles,
      /\.profile-modal__edit-button:hover,[\s\S]*\.profile-modal__edit-button:focus-visible\s*\{[\s\S]*background:\s*color-mix\(in srgb, var\(--accent-soft\) 38%, var\(--surface-strong\)\);/
    );
    assert.match(
      styles,
      /\.profile-modal__field\.is-editing \.profile-modal__edit-button\s*\{[\s\S]*background:\s*color-mix\(in srgb, var\(--accent\) 34%, var\(--surface-strong\)\);[\s\S]*color:\s*var\(--accent-strong\);/
    );
    assert.match(styles, /\.profile-modal__edit-button:active\s*\{[\s\S]*transform:\s*none;/);
    assert.match(
      styles,
      /\.profile-modal__edit-button--inside:active\s*\{[\s\S]*transform:\s*translateY\(-50%\);/
    );
    assert.match(styles, /\.profile-modal__input-shell\s*\{[\s\S]*position:\s*relative;/);
    assert.match(styles, /\.profile-modal__edit-button--inside\s*\{[\s\S]*right:\s*6px;/);
    assert.match(
      styles,
      /\.profile-modal__file-button\s*\{[\s\S]*justify-content:\s*center;[\s\S]*background:\s*color-mix\(in srgb, var\(--accent-soft\) 72%, var\(--surface-strong\)\);/
    );
    assert.match(
      styles,
      /\.profile-modal__edit-button svg\s*\{[\s\S]*fill:\s*none;[\s\S]*stroke:\s*currentColor;[\s\S]*stroke-width:\s*2;/
    );
    assert.match(styles, /@media \(max-width:\s*920px\)/);
    assert.match(
      styles,
      /\.profile-avatar-crop-backdrop\s*\{[\s\S]*z-index:\s*95;[\s\S]*backdrop-filter:\s*blur\(8px\);/
    );
    assert.match(
      styles,
      /\.profile-avatar-crop__frame\s*\{[\s\S]*--profile-avatar-crop-window-size:[\s\S]*aspect-ratio:\s*1;[\s\S]*touch-action:\s*none;/
    );
    assert.match(
      styles,
      /\.profile-avatar-crop__window\s*\{[\s\S]*width:\s*var\(--profile-avatar-crop-window-size\);[\s\S]*box-shadow:/
    );
    assert.match(
      styles,
      /\.public-profile-modal-backdrop\s*\{[\s\S]*background:\s*color-mix\(in srgb, var\(--bg\) 12%, transparent\);[\s\S]*backdrop-filter:\s*blur\(5px\);/
    );
    assert.match(styles, /\.public-profile-modal\s*\{[\s\S]*background:\s*var\(--bg\);/);
    assert.match(
      styles,
      /\.public-profile-modal__social\s*\{[\s\S]*grid-column:\s*2;[\s\S]*grid-row:\s*3;[\s\S]*align-self:\s*start;[\s\S]*align-content:\s*flex-start;/
    );
    assert.match(
      styles,
      /\.public-profile-modal \.profile-modal__header,[\s\S]*\.public-profile-modal \.public-profile-modal__actions\s*\{[\s\S]*background:\s*var\(--bg\);/
    );
    assert.match(
      styles,
      /\.public-profile-modal__body\s*\{[\s\S]*grid-template-columns:\s*minmax\(220px, 260px\) minmax\(0, 1fr\);[\s\S]*padding:\s*18px 28px 28px;/
    );
    assert.match(
      styles,
      /\.public-profile-modal__avatar\s*\{[\s\S]*width:\s*min\(232px, 100%\);[\s\S]*image-rendering:\s*auto;/
    );
    assert.match(
      styles,
      /\.public-profile-modal__meta\s*\{[\s\S]*grid-column:\s*2;[\s\S]*grid-row:\s*1 \/ 3;[\s\S]*min-height:\s*0;/
    );
    assert.match(
      styles,
      /\.public-profile-modal__description-label\s*\{[\s\S]*border-bottom:\s*0;[\s\S]*font-weight:\s*950;[\s\S]*text-align:\s*center;/
    );
    assert.match(
      styles,
      /\.public-profile-modal__description\s*\{[\s\S]*min-height:\s*0;[\s\S]*overflow-y:\s*auto;[\s\S]*border:\s*1px solid var\(--line-strong\);[\s\S]*border-radius:\s*0 0 8px 8px;/
    );
    assert.match(
      styles,
      /\.public-profile-modal__joined\s*\{[\s\S]*grid-template-columns:\s*repeat\(3, 1fr\);[\s\S]*overflow:\s*hidden;[\s\S]*border:\s*1px solid/
    );
    assert.match(
      styles,
      /\.public-profile-modal__joined span \+ span\s*\{[\s\S]*border-left:\s*1px solid/
    );
    assert.match(
      styles,
      /\.public-profile-modal__joined span\s*\{[\s\S]*display:\s*flex;[\s\S]*align-items:\s*center;[\s\S]*justify-content:\s*center;/
    );
    assert.match(
      styles,
      /\.public-profile-modal__cafes\s*\{[\s\S]*grid-column:\s*1;[\s\S]*grid-row:\s*3;[\s\S]*width:\s*min\(232px, 100%\);[\s\S]*align-self:\s*stretch;/
    );
    assert.match(
      styles,
      /\.public-profile-modal__cafes ul\s*\{[\s\S]*display:\s*grid;[\s\S]*align-content:\s*start;[\s\S]*gap:\s*7px;/
    );
    assert.match(
      styles,
      /\.public-profile-modal__cafes li\s*\{[\s\S]*display:\s*flex;[\s\S]*text-overflow:\s*ellipsis;/
    );
    assert.match(
      styles,
      /\.public-profile-modal__actions\s*\{[\s\S]*margin:\s*8px -28px -28px;[\s\S]*padding:\s*11px 24px;/
    );
    assert.match(
      styles,
      /html\[data-theme\] \.topic-item:hover,[\s\S]*html\[data-theme\] #topicList \.topic-item:focus-visible\s*\{[\s\S]*background:\s*color-mix\(in srgb,\s*var\(--surface-strong\) 86%,\s*var\(--accent\) 14%\);/
    );
    assert.match(
      styles,
      /html\[data-theme\] \.topic-item\.is-active,[\s\S]*html\[data-theme\] #topicList \.topic-item\.is-active\s*\{[\s\S]*background:\s*color-mix\(in srgb,\s*var\(--surface-strong\) 76%,\s*var\(--accent\) 24%\);/
    );
    assert.match(
      styles,
      /html\[data-theme\] \.topic-item\.is-active:hover,[\s\S]*html\[data-theme\] #topicList \.topic-item\.is-active:focus-visible\s*\{[\s\S]*background:\s*color-mix\(in srgb,\s*var\(--surface-strong\) 70%,\s*var\(--accent\) 30%\);/
    );
    assert.doesNotMatch(styles, /#(?:efd8c7|e5bfa7|2a201d|252b33|1f3035|263020|342421|252d3d)/i);
    assert.match(
      styles,
      /\.topic-item__avatar\s*\{[\s\S]*width:\s*84px;[\s\S]*height:\s*84px;[\s\S]*align-self:\s*center;[\s\S]*border-top:\s*1px solid[\s\S]*border-left:\s*1px solid[\s\S]*border-bottom:\s*1px solid[\s\S]*border-right:\s*1px solid/
    );
    assert.match(
      styles,
      /html\.is-desktop-viewport \.panel--topics \.topic-item__avatar\s*\{[\s\S]*width:\s*76px;[\s\S]*height:\s*76px;/
    );
    assert.match(
      styles,
      /#authButton \.button-label\s*\{[\s\S]*font-weight:\s*950;[\s\S]*letter-spacing:\s*0\.01em;/
    );
    assert.match(
      styles,
      /\.auth-modal\s*\{[\s\S]*display:\s*grid;[\s\S]*box-sizing:\s*border-box;[\s\S]*overflow:\s*hidden;[\s\S]*height:\s*min\(560px, calc\(100vh - 40px\)\);[\s\S]*max-height:\s*min\(620px, calc\(100vh - 40px\)\);/
    );
    assert.match(
      styles,
      /\.auth-modal__body\s*\{[\s\S]*overflow-y:\s*auto;[\s\S]*scrollbar-color:\s*var\(--palette-modal-scrollbar-thumb\) var\(--palette-modal-scrollbar-track\);[\s\S]*scrollbar-width:\s*thin;/
    );
    assert.match(
      styles,
      /\.auth-modal__body::-webkit-scrollbar-track\s*\{[\s\S]*background:\s*var\(--palette-modal-scrollbar-track\);/
    );
    assert.match(
      styles,
      /\.auth-modal__body::-webkit-scrollbar-thumb\s*\{[\s\S]*border:\s*2px solid var\(--palette-modal-scrollbar-track\);[\s\S]*background:\s*var\(--palette-modal-scrollbar-thumb\);/
    );
    assert.match(
      styles,
      /\.auth-modal__body::-webkit-scrollbar-thumb:hover\s*\{[\s\S]*background:\s*var\(--palette-modal-scrollbar-thumb-hover\);/
    );
    assert.match(
      styles,
      /\.auth-email-form\s*\{[\s\S]*display:\s*flex;[\s\S]*flex:\s*1 0 auto;[\s\S]*flex-direction:\s*column;/
    );
    assert.match(
      styles,
      /\.auth-email-submit\s*\{[\s\S]*order:\s*4;[\s\S]*min-height:\s*44px;/
    );
    assert.match(styles, /\.auth-form-actions\s*\{[\s\S]*?margin-top:\s*auto;[\s\S]*?\}/);
    assert.match(
      styles,
      /\.auth-mode-tabs\s*\{[\s\S]*grid-template-columns:\s*1fr 1fr;[\s\S]*border-radius:\s*8px;/
    );
    assert.match(
      styles,
      /\.auth-mode-tabs__button\s*\{[\s\S]*min-height:\s*34px;[\s\S]*border-radius:\s*6px;/
    );
    assert.match(
      styles,
      /\.auth-field-error-marker\s*\{[\s\S]*display:\s*none;[\s\S]*color:\s*#ef4444;/
    );
    assert.match(
      styles,
      /\.auth-email-form__field\.is-invalid \.auth-field-error-marker\s*\{[\s\S]*display:\s*inline;/
    );
    assert.match(
      styles,
      /@media \(max-width:\s*319px\)\s*\{[\s\S]*\.auth-modal-backdrop\s*\{[\s\S]*padding:\s*8px;[\s\S]*\.auth-modal__body\s*\{[\s\S]*padding:\s*10px 12px;[\s\S]*\.auth-email-form__field input,\s*\.auth-email-submit\s*\{[\s\S]*min-height:\s*40px;/
    );
    assert.match(
      styles,
      /\.theme-toggle-slot\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*align-items:\s*center;[\s\S]*flex:\s*none;/
    );
    assert.match(styles, /\.theme-toggle-slot:empty\s*\{[\s\S]*display:\s*none;/);
    assert.match(
      styles,
      /\.theme-switch\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*width:\s*78px;[\s\S]*height:\s*44px;[\s\S]*min-height:\s*44px;[\s\S]*padding:\s*3px;[\s\S]*border-radius:\s*999px;/
    );
    assert.match(
      styles,
      /#themeToggleDesktopSlot \.theme-switch\s*\{[\s\S]*border:\s*1px solid var\(--button-ghost-border\);[\s\S]*background:\s*var\(--button-ghost-bg\);/
    );
    assert.match(
      styles,
      /#themeToggleDesktopSlot \.theme-switch:hover,\s*#themeToggleDesktopSlot \.theme-switch:active\s*\{[\s\S]*border-color:\s*var\(--button-ghost-border\);[\s\S]*background:\s*var\(--button-ghost-bg-hover\);/
    );
    assert.match(
      styles,
      /#themeToggleDesktopSlot \.theme-switch:focus-visible,\s*#themeToggleMobileSlot \.theme-switch:focus-visible,\s*#themeToggleDrawerSlot \.theme-switch:focus-visible\s*\{[\s\S]*outline:\s*2px solid color-mix/
    );
    assert.match(
      styles,
      /\.message\s*\{[\s\S]*position:\s*relative;[\s\S]*padding:\s*0 0 0 84px;[\s\S]*min-height:\s*84px;[\s\S]*border-radius:\s*0;/
    );
    assert.match(
      styles,
      /\.message \+ \.message::before\s*\{[\s\S]*top:\s*0;[\s\S]*left:\s*84px;[\s\S]*right:\s*0;[\s\S]*height:\s*0;[\s\S]*border-top:\s*1px solid/
    );
    assert.match(
      styles,
      /\.message \+ \.message \.message__avatar\s*\{[\s\S]*border-top:\s*1px solid/
    );
    assert.match(
      styles,
      /\.message__avatar\s*\{[\s\S]*position:\s*absolute;[\s\S]*top:\s*0;[\s\S]*left:\s*0;[\s\S]*width:\s*84px;[\s\S]*height:\s*84px;[\s\S]*min-height:\s*84px;[\s\S]*border-right:\s*1px solid/
    );
    assert.match(
      styles,
      /\.message__body\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*padding:\s*14px;/
    );
    assert.match(styles, /\.message__meta\s*\{[\s\S]*justify-content:\s*space-between;/);
    assert.match(styles, /\.message__time\s*\{[\s\S]*margin-left:\s*auto;/);
    assert.match(styles, /\.panel__title-inline--ranking\s*\{[\s\S]*justify-content:\s*center;/);
    assert.match(
      styles,
      /\.rankings-section\.is-ranking-scrollable \.ranking-list,\s*[\s\S]*overflow:\s*auto;/
    );
    assert.match(
      styles,
      /\.ranking-list\s*\{[\s\S]*opacity:\s*1;[\s\S]*transition:\s*opacity 150ms ease;/
    );
    assert.match(styles, /\.ranking-list\.is-ranking-fading\s*\{[\s\S]*opacity:\s*0;/);
    assert.match(
      styles,
      /\.rankings-section\.is-ranking-scrollable \.ranking-list,\s*[\s\S]*height:\s*100%;/
    );
    assert.match(
      styles,
      /\.rankings-section\.is-ranking-scrollable \.ranking-list,\s*[\s\S]*max-height:\s*100%;/
    );
    assert.match(
      styles,
      /\.rankings-section\.is-ranking-scrollable \.ranking-item,\s*[\s\S]*min-height:\s*var\(--ranking-skeleton-item-height,\s*34px\);/
    );
    assert.match(
      styles,
      /\.ranking-content,\s*\.drawer-ranking-content\s*\{[\s\S]*--ranking-bottom-mask:\s*0px;[\s\S]*position:\s*relative;[\s\S]*overflow:\s*hidden;/
    );
    assert.match(
      styles,
      /\.ranking-content::after,\s*\.drawer-ranking-content::after\s*\{[\s\S]*height:\s*var\(--ranking-bottom-mask\);/
    );
    assert.doesNotMatch(
      styles,
      /\.panel__body--drawer-rankings\.is-topic-selected \.ranking-item--rank-1 \.ranking-item__badge--topic/
    );
    assert.doesNotMatch(
      styles,
      /\.panel__body--drawer-rankings\.is-topic-selected \.ranking-item--rank-2 \.ranking-item__badge--topic/
    );
    assert.doesNotMatch(
      styles,
      /\.panel__body--drawer-rankings\.is-topic-selected \.ranking-item--rank-3 \.ranking-item__badge--topic/
    );
    assert.match(
      styles,
      /\.ranking-item__badge\s*\{[\s\S]*border:\s*1px solid var\(--ranking-badge-border\);/
    );
    assert.doesNotMatch(
      styles,
      /\.ranking-item--global\.ranking-item--rank-1 \.ranking-item__badge\s*\{/
    );
    assert.doesNotMatch(
      styles,
      /\.ranking-item--global\.ranking-item--rank-2 \.ranking-item__badge\s*\{/
    );
    assert.doesNotMatch(
      styles,
      /\.ranking-item--global\.ranking-item--rank-3 \.ranking-item__badge\s*\{/
    );
    assert.match(
      styles,
      /\.panel__body--drawer-rankings\s*\{[\s\S]*grid-template-rows:\s*auto auto minmax\(0,\s*1fr\);/
    );
    assert.match(
      styles,
      /\.ranking-scope-tabs\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\);[\s\S]*border-radius:\s*0;/
    );
    assert.match(
      styles,
      /\.ranking-carousel\s*\{[\s\S]*grid-template-columns:\s*44px minmax\(0,\s*1fr\) 44px;[\s\S]*gap:\s*0;[\s\S]*padding:\s*0;[\s\S]*border-radius:\s*0;/
    );
    assert.match(
      styles,
      /\.ranking-carousel__nav:hover,\s*\.ranking-carousel__nav:focus-visible\s*\{[\s\S]*background:\s*color-mix\(in srgb,\s*var\(--accent-soft\) 26%,\s*transparent\);[\s\S]*transform:\s*none;/
    );
    assert.match(
      styles,
      /\.ranking-carousel__nav:active\s*\{[\s\S]*background:\s*color-mix\(in srgb,\s*var\(--accent-soft\) 38%,\s*transparent\);/
    );
    assert.match(
      styles,
      /html:not\(\[data-theme="dark"\]\) \.ranking-carousel__nav:hover,\s*html:not\(\[data-theme="dark"\]\) \.ranking-carousel__nav:focus-visible\s*\{[\s\S]*background:\s*var\(--button-fill-bg\);/
    );
    assert.match(
      styles,
      /html:not\(\[data-theme="dark"\]\) \.ranking-carousel__nav:active\s*\{[\s\S]*background:\s*var\(--button-fill-bg-hover\);/
    );
    assert.match(
      styles,
      /html\[data-theme="dark"\] \.ranking-carousel__nav:hover,\s*html\[data-theme="dark"\] \.ranking-carousel__nav:focus-visible\s*\{[\s\S]*background:\s*var\(--button-fill-bg\);/
    );
    assert.match(
      styles,
      /html\[data-theme="dark"\] \.ranking-carousel__nav:active\s*\{[\s\S]*background:\s*var\(--button-fill-bg-hover\);/
    );
    assert.match(
      styles,
      /\.ranking-carousel__current:hover,\s*\.ranking-carousel__current:focus-visible\s*\{[\s\S]*transform:\s*none;/
    );
    assert.match(styles, /\.ranking-scope-tabs__button\s*\{[\s\S]*text-transform:\s*uppercase;/);
    assert.match(
      styles,
      /html\[data-theme="light"\]\[data-palette="default"\] \.ranking-scope-tabs\s*\{[\s\S]*border-color:\s*color-mix\(in srgb,\s*var\(--accent\) 56%,\s*var\(--line\)\);[\s\S]*background:\s*#fff;/
    );
    assert.match(
      styles,
      /html\[data-theme="light"\]\[data-palette="default"\] \.ranking-scope-tabs__button\.is-active[\s\S]*box-shadow:\s*inset 0 -2px 0 var\(--accent\);/
    );
    assert.match(
      styles,
      /html\[data-theme="light"\]:not\(\[data-palette="default"\]\) \.ranking-scope-tabs\s*\{[\s\S]*background:\s*color-mix\(in srgb,\s*var\(--surface-strong\) 92%,\s*var\(--accent-soft\) 8%\);/
    );
    assert.match(
      styles,
      /html\[data-theme="light"\]:not\(\[data-palette="default"\]\) \.ranking-scope-tabs__button\.is-active[\s\S]*background:\s*color-mix\(in srgb,\s*var\(--surface-strong\) 74%,\s*var\(--accent-soft\) 26%\);/
    );
    assert.match(
      styles,
      /html:not\(\[data-theme="dark"\]\) \.ranking-label__main\s*\{[\s\S]*color:\s*var\(--text\);/
    );
    assert.match(
      styles,
      /html\[data-theme="dark"\] #rankingCurrent,\s*[\s\S]*background:\s*var\(--button-fill-bg\);[\s\S]*color:\s*var\(--button-fill-text\);/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport #storeButton\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*gap:\s*0;[\s\S]*width:\s*44px;[\s\S]*min-width:\s*44px;[\s\S]*height:\s*44px;[\s\S]*min-height:\s*44px;[\s\S]*padding-block:\s*0;[\s\S]*padding-inline:\s*0;[\s\S]*border-radius:\s*999px;[\s\S]*flex:\s*none;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport #authButton \.button-label\s*\{[\s\S]*display:\s*inline;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport #storeButton \.button-label\s*\{[\s\S]*display:\s*none;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport #authButton\s*\{[\s\S]*align-items:\s*center;[\s\S]*flex:\s*none;[\s\S]*max-width:\s*104px;[\s\S]*min-width:\s*0;[\s\S]*height:\s*44px;[\s\S]*min-height:\s*44px;[\s\S]*padding-block:\s*0;[\s\S]*padding-inline:\s*8px;[\s\S]*font-size:\s*0\.72rem;[\s\S]*letter-spacing:\s*0;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport #authButton \.button-label\s*\{[\s\S]*overflow:\s*hidden;[\s\S]*text-overflow:\s*ellipsis;[\s\S]*white-space:\s*nowrap;[\s\S]*font-weight:\s*900;[\s\S]*letter-spacing:\s*0;/
    );
    assert.match(
      styles,
      /#themeToggleMobileSlot \.theme-switch,\s*#themeToggleDrawerSlot \.theme-switch\s*\{[\s\S]*border:\s*2px solid color-mix\(in srgb,\s*var\(--accent\) 58%,\s*var\(--line\)\);[\s\S]*background:\s*color-mix\(in srgb,\s*var\(--surface-strong\) 78%,\s*var\(--accent-soft\) 22%\);/
    );
    assert.match(
      styles,
      /#themeToggleMobileSlot \.theme-switch:hover,\s*#themeToggleMobileSlot \.theme-switch:focus-visible,\s*#themeToggleMobileSlot \.theme-switch:active,\s*#themeToggleDrawerSlot \.theme-switch:hover,\s*#themeToggleDrawerSlot \.theme-switch:focus-visible,\s*#themeToggleDrawerSlot \.theme-switch:active\s*\{[\s\S]*border-color:\s*color-mix\(in srgb,\s*var\(--accent\) 58%,\s*var\(--line\)\);[\s\S]*background:\s*color-mix\(in srgb,\s*var\(--surface-strong\) 78%,\s*var\(--accent-soft\) 22%\);/
    );
    assert.match(
      styles,
      /\.theme-switch__track\s*\{[\s\S]*position:\s*relative;[\s\S]*width:\s*100%;[\s\S]*height:\s*100%;[\s\S]*border-radius:\s*999px;[\s\S]*background:\s*color-mix\(in srgb,\s*var\(--surface-strong\) 88%,\s*var\(--accent-soft\) 12%\);[\s\S]*overflow:\s*hidden;/
    );
    assert.match(
      styles,
      /\.theme-switch__icons\s*\{[\s\S]*display:\s*block;[\s\S]*pointer-events:\s*none;/
    );
    assert.match(
      styles,
      /\.theme-switch__icon\s*\{[\s\S]*position:\s*absolute;[\s\S]*top:\s*50%;[\s\S]*z-index:\s*2;[\s\S]*width:\s*14px;[\s\S]*height:\s*14px;[\s\S]*opacity:\s*0\.96;[\s\S]*transform:\s*translateY\(-50%\);/
    );
    assert.match(styles, /\.theme-switch__icon--light\s*\{[\s\S]*left:\s*10px;/);
    assert.match(styles, /\.theme-switch__icon--dark\s*\{[\s\S]*right:\s*10px;/);
    assert.doesNotMatch(styles, /\.theme-switch__icon--dark svg\s*\{/);
    assert.match(
      styles,
      /\.theme-switch__thumb\s*\{[\s\S]*left:\s*0;[\s\S]*width:\s*34px;[\s\S]*height:\s*34px;[\s\S]*background:\s*var\(--surface-strong\);[\s\S]*transform:\s*translateY\(-50%\);[\s\S]*transition:[\s\S]*left 180ms ease,[\s\S]*z-index:\s*1;/
    );
    assert.match(
      styles,
      /html\[data-theme="dark"\] \.theme-switch__thumb\s*\{[\s\S]*left:\s*calc\(100% - 34px\);/
    );
    assert.match(styles, /html\[data-theme="light"\] \.theme-switch__thumb\s*\{[\s\S]*left:\s*0;/);
    assert.match(
      styles,
      /html\.is-mobile-viewport \.topbar\s*\{[\s\S]*grid-template-columns:\s*44px minmax\(0,\s*1fr\) auto;[\s\S]*gap:\s*8px;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.topbar__group--right\s*\{[\s\S]*grid-column:\s*3;[\s\S]*justify-content:\s*flex-end;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.topbar__title\s*\{[\s\S]*position:\s*static;[\s\S]*grid-column:\s*2;[\s\S]*display:\s*inline-flex;[\s\S]*width:\s*100%;[\s\S]*max-width:\s*100%;[\s\S]*overflow:\s*hidden;[\s\S]*white-space:\s*nowrap;[\s\S]*transform:\s*none;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport\[data-auth-state="logged-in"\] #authButton\s*\{[\s\S]*display:\s*none;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.topbar__auth-tools\s*\{[\s\S]*display:\s*none;/
    );
    assert.match(styles, /html\.is-mobile-viewport \.panel__header--chat\s*\{[\s\S]*gap:\s*10px;/);
    assert.match(
      styles,
      /html\.is-mobile-viewport \.panel__header--chat \.chat-header__back\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*width:\s*40px;[\s\S]*min-width:\s*40px;[\s\S]*height:\s*40px;[\s\S]*min-height:\s*40px;/
    );
    assert.match(
      styles,
      /@media \(orientation:\s*landscape\) and \(pointer:\s*coarse\)\s*\{[\s\S]*html\.is-mobile-viewport \.panel--chat\s*\{[\s\S]*max-height:\s*70vh;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.brand-mark\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*font-size:\s*1rem;[\s\S]*white-space:\s*nowrap;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.brand-mark__che,\s*html\.is-mobile-viewport \.brand-mark__trend\s*\{[\s\S]*display:\s*inline;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.brand-mark__icon\s*\{[\s\S]*width:\s*2\.25rem;[\s\S]*height:\s*2\.25rem;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer-action-stack\s*\{[\s\S]*flex-direction:\s*column;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer__header\s*\{[\s\S]*position:\s*relative;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer__header \[data-close-drawer="right"\]\s*\{[\s\S]*border-color:\s*var\(--button-fill-border\);[\s\S]*color:\s*var\(--button-fill-text\);[\s\S]*background:\s*var\(--button-fill-bg\);/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer__header \[data-close-drawer="right"\] > span\s*\{[\s\S]*display:\s*grid;[\s\S]*place-items:\s*center;[\s\S]*transform:\s*translateY\(-0\.5px\);/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer__header \.drawer-close-icon svg\s*\{[\s\S]*display:\s*block;[\s\S]*width:\s*1\.18rem;[\s\S]*height:\s*1\.18rem;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer__header \[data-close-drawer="right"\]:hover,\s*html\.is-mobile-viewport \.drawer__header \[data-close-drawer="right"\]:focus-visible\s*\{[\s\S]*background:\s*color-mix\(in srgb,\s*#c63834 62%,\s*var\(--accent-strong\) 38%\);[\s\S]*transform:\s*none;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer-action-button\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*20px minmax\(0,\s*1fr\) 20px;[\s\S]*justify-content:\s*flex-start;[\s\S]*gap:\s*12px;[\s\S]*min-width:\s*0;[\s\S]*overflow:\s*hidden;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer-action-button__icon\s*\{[\s\S]*width:\s*20px;[\s\S]*height:\s*20px;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer-action-button__label\s*\{[\s\S]*display:\s*block;[\s\S]*justify-self:\s*center;[\s\S]*width:\s*min\(112px,\s*100%\);[\s\S]*max-width:\s*100%;[\s\S]*overflow:\s*hidden;[\s\S]*text-align:\s*center;[\s\S]*text-overflow:\s*ellipsis;[\s\S]*white-space:\s*nowrap;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer-action-button--auth \.drawer-action-button__label\s*\{[\s\S]*justify-self:\s*center;[\s\S]*text-align:\s*center;[\s\S]*animation:\s*none;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer-search__field\s*\{[\s\S]*position:\s*relative;[\s\S]*display:\s*block;[\s\S]*min-height:\s*52px;[\s\S]*overflow:\s*hidden;[\s\S]*border-radius:\s*0;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer-search__input\s*\{[\s\S]*display:\s*block;[\s\S]*width:\s*100%;[\s\S]*min-width:\s*0;[\s\S]*height:\s*100%;[\s\S]*min-height:\s*52px;[\s\S]*padding:\s*0 14px 0 46px;[\s\S]*border:\s*0 !important;[\s\S]*border-radius:\s*0 !important;[\s\S]*box-shadow:\s*none !important;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer-action-button\.is-search-hidden\s*\{[\s\S]*display:\s*none;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer-action-button--store\s*\{[\s\S]*border-color:\s*color-mix\(in srgb,\s*var\(--accent-strong\) 76%,\s*var\(--line\)\);[\s\S]*background:\s*color-mix\(in srgb,\s*var\(--accent\) 72%,\s*var\(--surface-strong\) 28%\);[\s\S]*color:\s*var\(--button-fill-text\);/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer-action-button--store \.drawer-action-button__icon\s*\{[\s\S]*color:\s*var\(--button-fill-text\);/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer-action-button--store:hover,\s*html\.is-mobile-viewport \.drawer-action-button--store:focus-visible\s*\{[\s\S]*background:\s*color-mix\(in srgb,\s*var\(--accent-strong\) 78%,\s*var\(--surface-strong\) 22%\);/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer-theme-slot\s*\{[\s\S]*justify-content:\s*flex-end;[\s\S]*margin-top:\s*14px;/
    );
    assert.match(
      styles,
      /@media \(max-width:\s*380px\)\s*\{[\s\S]*html\.is-mobile-viewport \.topbar__title\s*\{[\s\S]*gap:\s*6px;/
    );
    assert.match(
      styles,
      /@media \(max-width:\s*300px\)\s*\{[\s\S]*html\.is-mobile-viewport \.topbar__title\s*\{[\s\S]*display:\s*none;/
    );
    assert.match(
      styles,
      /@media \(max-width:\s*430px\)\s*\{[\s\S]*html\.is-mobile-viewport #storeButton\s*\{[\s\S]*display:\s*none;/
    );
    assert.match(styles, /html\.is-mobile-viewport \.drawer-mobile-panel__back\s*\{/);
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer-action-button--auth\s*\{[\s\S]*margin-top:\s*10px;[\s\S]*color:\s*var\(--button-fill-text\);/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer-action-button--auth \.drawer-action-button__icon\s*\{[\s\S]*color:\s*var\(--button-fill-text\);/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer-action-button--auth:hover,\s*html\.is-mobile-viewport \.drawer-action-button--auth:focus-visible\s*\{/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.mobile-right-drawer\s*\{[\s\S]*position:\s*absolute;[\s\S]*top:\s*50%;[\s\S]*left:\s*12px;[\s\S]*z-index:\s*1;[\s\S]*align-items:\s*center;[\s\S]*justify-content:\s*center;[\s\S]*border:\s*0;[\s\S]*box-shadow:\s*none;[\s\S]*color:\s*var\(--text\);[\s\S]*background:\s*transparent;[\s\S]*transform:\s*translateY\(-50%\);/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.mobile-right-drawer:hover,\s*html\.is-mobile-viewport \.mobile-right-drawer:focus-visible,\s*html\.is-mobile-viewport \.mobile-right-drawer:active\s*\{[\s\S]*background:\s*transparent;[\s\S]*transform:\s*translateY\(-50%\);/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.mobile-right-drawer \.icon-button__icon\s*\{[\s\S]*width:\s*2\.1rem;[\s\S]*height:\s*2\.1rem;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.mobile-right-drawer \.icon-button__icon svg\s*\{[\s\S]*width:\s*2\.1rem;[\s\S]*height:\s*2\.1rem;[\s\S]*stroke-width:\s*2\.6;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer-mobile-panels\[hidden\],\s*[\s\S]*display:\s*none;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer\s*\{[\s\S]*width:\s*100%;[\s\S]*max-width:\s*none;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer--right\s*\{[\s\S]*grid-template-rows:\s*auto auto minmax\(0,\s*1fr\);/
    );
    assert.match(styles, /html\.is-mobile-viewport \.drawer__brand\s*\{[\s\S]*gap:\s*12px;/);
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer__brand-icon\s*\{[\s\S]*width:\s*2rem;[\s\S]*height:\s*2rem;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer__brand \.brand-mark\s*\{[\s\S]*font-size:\s*1\.05rem;[\s\S]*white-space:\s*nowrap;/
    );
    assert.match(
      styles,
      /@media \(max-width:\s*300px\)\s*\{[\s\S]*html\.is-mobile-viewport \.drawer__header \.drawer__brand\s*\{[\s\S]*inset:\s*0 50px 0 42px;[\s\S]*gap:\s*5px;/
    );
    assert.match(
      styles,
      /@media \(max-width:\s*300px\)\s*\{[\s\S]*html\.is-mobile-viewport \.drawer__header \.drawer__brand-icon\s*\{[\s\S]*width:\s*1\.45rem;[\s\S]*height:\s*1\.45rem;/
    );
    assert.match(
      styles,
      /@media \(max-width:\s*300px\)\s*\{[\s\S]*html\.is-mobile-viewport \.drawer__header \.drawer__brand \.brand-mark\s*\{[\s\S]*display:\s*grid;[\s\S]*font-size:\s*0\.7rem;[\s\S]*white-space:\s*normal;/
    );
    assert.match(
      styles,
      /@media \(max-width:\s*300px\)\s*\{[\s\S]*html\.is-mobile-viewport \.drawer__header \.drawer__brand \.brand-mark__che,\s*html\.is-mobile-viewport \.drawer__header \.drawer__brand \.brand-mark__trend\s*\{[\s\S]*display:\s*block;/
    );
    assert.match(
      styles,
      /@media \(max-width:\s*216px\)\s*\{[\s\S]*html\.is-mobile-viewport \.drawer__header \.drawer__brand\s*\{[\s\S]*display:\s*none;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer-mobile-panel__header,\s*html\.is-mobile-viewport \.drawer-ranking__header\s*\{[\s\S]*grid-template-columns:\s*40px minmax\(0,\s*1fr\) 40px;[\s\S]*gap:\s*12px;[\s\S]*margin-bottom:\s*12px;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer-mobile-panel__header::after,\s*html\.is-mobile-viewport \.drawer-ranking__header::after\s*\{[\s\S]*grid-column:\s*3;[\s\S]*width:\s*40px;[\s\S]*height:\s*40px;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer-mobile-panel__header h3,\s*html\.is-mobile-viewport \.drawer-ranking__header h3\s*\{[\s\S]*justify-content:\s*center;[\s\S]*text-align:\s*center;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport #drawerUsersSection \.drawer-mobile-panel__header\s*\{[\s\S]*padding-inline:\s*14px;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport #drawerRankingsSection \.drawer-ranking__header\s*\{[\s\S]*padding-inline:\s*16px;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport #drawerUsersSection \.drawer-mobile-panel__header h3::before,\s*html\.is-mobile-viewport #drawerUsersSection \.drawer-mobile-panel__header h3::after,\s*html\.is-mobile-viewport \.drawer--right \.drawer-ranking__header h3::before,\s*html\.is-mobile-viewport \.drawer--right \.drawer-ranking__header h3::after\s*\{[\s\S]*content:\s*none;[\s\S]*display:\s*none;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer-ranking__header \.panel__title-inline\s*\{[\s\S]*position:\s*static;[\s\S]*width:\s*100% !important;[\s\S]*justify-content:\s*center;[\s\S]*padding-inline:\s*0;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer--right\s*\{[\s\S]*right:\s*auto;[\s\S]*left:\s*0;[\s\S]*transform:\s*translateX\(-100%\);/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer-backdrop\s*\{[\s\S]*background:\s*rgba\(6,\s*10,\s*16,\s*0\.46\);[\s\S]*backdrop-filter:\s*blur\(3px\);/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer__section--half\s*\{[\s\S]*padding:\s*12px 10px 18px;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer__section--mobile-panel\s*\{[\s\S]*gap:\s*0;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.drawer__section--mobile-panel \+ \.drawer__section--mobile-panel\s*\{[\s\S]*padding-top:\s*12px;[\s\S]*border-top:\s*0;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.panel__body--drawer-rankings\s*\{[\s\S]*gap:\s*0;[\s\S]*padding-top:\s*0;/
    );
    assert.match(styles, /html\.is-mobile-viewport #drawerUserList\s*\{[\s\S]*padding-top:\s*0;/);
    assert.match(
      styles,
      /html\.is-mobile-viewport \.panel__body--drawer-rankings \.drawer-ranking-content,\s*[\s\S]*margin-top:\s*12px;/
    );
    assert.match(
      styles,
      /@media \(max-height:\s*720px\)\s*\{[\s\S]*html\.is-desktop-viewport\s*\{[\s\S]*--ranking-row-height:\s*29px;[\s\S]*--ranking-list-gap:\s*7px;[\s\S]*--ranking-list-padding-y:\s*8px;/
    );
    assert.match(
      styles,
      /\.ranking-mode-list__option\s*\{[\s\S]*grid-template-columns:\s*2rem minmax\(0,\s*1fr\);/
    );
    assert.match(
      styles,
      /\.ranking-mode-list__option\.is-active::before\s*\{[\s\S]*width:\s*12px;/
    );
    assert.match(
      styles,
      /\.user-item\[data-connected-user-id\]:hover,\s*\.user-item\[data-connected-user-id\]:focus-within\s*\{/
    );
    assert.match(styles, /\.user-item\[data-connected-user-id\]:active\s*\{/);
    assert.match(styles, /\.user-item\.is-active\s*\{/);
    assert.match(styles, /\.topic-list\s*\{[\s\S]*grid-auto-rows:\s*84px;/);
    assert.match(
      styles,
      /html\.is-mobile-viewport \.mobile-topic-stage__view--list \.topic-list\s*\{[\s\S]*gap:\s*12px;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.mobile-topic-stage__view--list \.scroll-list\s*\{[^}]*padding:\s*10px 4px 40px 0;[^}]*scrollbar-gutter:\s*stable;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.mobile-topic-stage__view--list \.topic-item__avatar\s*\{[^}]*margin-left:\s*-1px;[^}]*border-left:\s*0;/
    );
    assert.doesNotMatch(
      styles,
      /html\.is-mobile-viewport \.mobile-topic-stage__view--list \.scroll-list\s*\{[^}]*scrollbar-gutter:\s*stable both-edges;/
    );
    assert.match(
      styles,
      /html\.is-mobile-viewport \.mobile-topic-stage__view--list \.topic-item \+ \.topic-item::after\s*\{[\s\S]*border-top:\s*1px solid color-mix\(in srgb,\s*var\(--accent\) 62%,\s*var\(--line-strong\)\);/
    );
    assert.doesNotMatch(
      styles,
      /html\.is-mobile-viewport \.mobile-topic-stage__view--list \.topic-item \+ \.topic-item\s*\{\s*border-top:\s*0;/
    );
    assert.doesNotMatch(
      styles,
      /html\.is-mobile-viewport \.mobile-topic-stage__view--list \.topic-item \+ \.topic-item::after\s*\{\s*border-top:\s*0;/
    );
    assert.match(
      styles,
      /html\.is-desktop-viewport \.panel--topics \.topic-list\s*\{[\s\S]*grid-auto-rows:\s*76px;/
    );
    assert.match(
      styles,
      /\.topic-item\.is-active \.topic-item__avatar\s*\{[\s\S]*border-color:\s*inherit;/
    );
    assert.match(styles, /\.user-item__trigger\s*\{/);
    assert.match(
      styles,
      /\.user-item__trigger:focus-visible,\s*\.user-item__action:focus-visible,\s*\.user-item__menu-button:focus-visible\s*\{/
    );
    assert.match(
      styles,
      /html\[data-theme="light"\]\.is-desktop-viewport \.panel--topics \.topics-panel__list-frame\s*\{[\s\S]*border:\s*1px solid/
    );
    assert.match(
      styles,
      /html\[data-theme="light"\] \.panel--chat,\s*html\[data-theme="light"\] \.panel--users-rankings\s*\{[\s\S]*border:\s*1px solid[\s\S]*box-shadow:\s*none;[\s\S]*backdrop-filter:\s*none;/
    );
    assert.match(
      styles,
      /html\[data-theme="light"\] \.panel--chat\s*\{[\s\S]*border-top:\s*1px solid[\s\S]*border-top-left-radius:\s*0;[\s\S]*border-top-right-radius:\s*0;[\s\S]*background:\s*var\(--surface-strong\);/
    );
    assert.match(
      styles,
      /html\[data-theme="light"\] \.panel--chat\.panel--topic-create\s*\{[\s\S]*border-top:\s*0;/
    );
    assert.match(
      styles,
      /html\[data-theme="light"\] \.panel--chat \.panel__header\s*\{[\s\S]*border-bottom:\s*1px solid/
    );
    assert.match(
      styles,
      /html\[data-theme="light"\] \.topic-item,\s*html\[data-theme="light"\] \.user-item,\s*html\[data-theme="light"\] \.ranking-item\s*\{[\s\S]*border-color:\s*color-mix/
    );
    assert.match(
      styles,
      /html\[data-theme="light"\] \.ranking-carousel,\s*html\[data-theme="light"\] \.drawer-ranking__switch\s*\{[\s\S]*border-color:\s*color-mix/
    );
    assert.match(
      styles,
      /html\[data-theme="light"\] \.composer\s*\{[\s\S]*border-top:\s*1px solid/
    );
    assert.match(
      styles,
      /input,\s*textarea\s*\{[\s\S]*box-sizing:\s*border-box;[\s\S]*padding:\s*0\.92rem 1rem;/
    );
    assert.match(
      styles,
      /textarea\s*\{[\s\S]*overflow-x:\s*hidden;[\s\S]*overflow-y:\s*hidden;[\s\S]*overflow-wrap:\s*anywhere;[\s\S]*max-height:\s*10rem;[\s\S]*scrollbar-color:\s*var\(--scrollbar-thumb\) transparent;[\s\S]*scrollbar-gutter:\s*stable;/
    );
    assert.match(
      styles,
      /textarea::-webkit-scrollbar-thumb\s*\{[\s\S]*background:\s*var\(--scrollbar-thumb\);[\s\S]*border-radius:\s*999px;[\s\S]*background-clip:\s*content-box;/
    );
    assert.match(html, /<label class="composer__field composer__field--message">/);
    assert.match(styles, /\.composer__field--message\s*\{[\s\S]*overflow:\s*hidden;[\s\S]*border-radius:\s*16px;/);
    assert.match(styles, /#messageInput\s*\{[\s\S]*height:\s*74px;[\s\S]*min-height:\s*74px;[\s\S]*max-height:\s*74px;/);
    assert.match(styles, /#messageInput\.is-scrollable\s*\{[\s\S]*clip-path:\s*inset\(0 round 16px\);/);
    assert.match(styles, /\.composer--topic-create #messageInput\s*\{[\s\S]*height:\s*130px;[\s\S]*min-height:\s*130px;[\s\S]*max-height:\s*130px;/);
    assert.match(styles, /textarea\.is-scrollable\s*\{[\s\S]*overflow-y:\s*auto;[\s\S]*background-clip:\s*padding-box;/);
    assert.match(
      styles,
      /#messageInput:not\(\.is-scrollable\)::-webkit-scrollbar\s*\{[\s\S]*width:\s*0;[\s\S]*height:\s*0;/
    );
    assert.match(
      styles,
      /input::placeholder,\s*textarea::placeholder\s*\{[\s\S]*color:\s*color-mix\(in srgb,\s*var\(--accent\) 28%,\s*var\(--text-soft\)\);[\s\S]*opacity:\s*1;/
    );
    assert.match(
      styles,
      /html\[data-theme="light"\] \.composer input,\s*html\[data-theme="light"\] \.composer textarea\s*\{[\s\S]*border:\s*1px solid color-mix/
    );
    assert.match(
      styles,
      /html\[data-theme="light"\] \.composer--topic-create input,\s*html\[data-theme="light"\] \.composer--topic-create textarea\s*\{[\s\S]*border-radius:\s*0;/
    );
    assert.match(
      styles,
      /html\[data-theme="light"\] \.message \+ \.message::before\s*\{[\s\S]*height:\s*1px;/
    );
    assert.match(
      styles,
      /html\[data-theme="light"\] \.rankings-section\s*\{[\s\S]*border-left:\s*0;[\s\S]*border-top:\s*1px solid/
    );
    assert.match(app, /from "\.\/controller\.js\?v=20260709-topicrace1"/);
    assert.match(components, /createProfileAvatar/);
    assert.match(components, /message__avatar/);
    assert.match(components, /Abrir opciones de reaccion del mensaje de/);
    assert.match(components, /Marcar me gusta en el mensaje de/);
    assert.doesNotMatch(components, /disabled = hasViewerReaction/);
    assert.match(components, /Marcar no me gusta en el mensaje de/);
    assert.match(components, /Reportar mensaje de/);
    assert.match(components, /Abrir perfil de/);
    assert.match(components, /message__body/);
    assert.match(components, /message__time/);
    assert.match(components, /message__like-button/);
    assert.match(components, /message__like-button--positive/);
    assert.match(components, /message__like-button--negative/);
    assert.match(
      components,
      /const likeScore = \(message\.likes \?\? 0\) - \(message\.dislikes \?\? 0\);/
    );
    assert.match(
      components,
      /const likeLabel = likeScore > 0 \? `\+\$\{likeScore\}` : String\(likeScore\);/
    );
    assert.doesNotMatch(components, /`Like/);
    assert.doesNotMatch(components, /Te gusta/);
    assert.match(components, /message__action-menu/);
    assert.match(components, /dataset\.messageMenuTrigger/);
    assert.match(components, /dataset\.messageProfileAuthorId/);
    assert.match(components, /dataset\.likeMessageId/);
    assert.match(components, /dataset\.dislikeMessageId/);
    assert.match(components, /message__report-button/);
    assert.match(components, /dataset\.reportEntityType = "message"/);
    assert.match(components, /dataset\.connectedUserId/);
    assert.match(components, /dataset\.userAction/);
    assert.match(components, /dataset\.userMenuTrigger/);
    assert.match(components, /user-item__menu/);
    assert.match(components, /createUserMenuButton\("Perfil", "profile"\)/);
    assert.match(components, /createUserMenuButton\("Agregar amigo", "friend"\)/);
    assert.match(components, /createUserMenuButton\("Reportar", "report"\)/);
    assert.match(components, /user-item__trigger/);
    assert.match(components, /aria-pressed/);
    assert.doesNotMatch(components, /getUserRole|Aviso|Invitado/);
    assert.match(
      controller,
      /export \{ bootstrap \} from "\.\/controller-app\.js\?v=20260709-topicrace1";/
    );
    assert.match(controllerApp, /from "\.\/ui\/transition-utils\.js"/);
    assert.match(controllerTheme, /export function applyStoredTheme/);
    assert.match(controllerTheme, /topykly-palette/);
    assert.match(controllerTheme, /applyPaletteToDocument/);
    assert.match(controllerTheme, /topykly-custom-palette-hex/);
    assert.match(controllerViewport, /export function createBackToTopicsHandler/);
    assert.match(controllerViewport, /export function createResizeHandler/);
    assert.match(controllerViewport, /syncRankingListHeights/);
    assert.match(controllerApp, /from "\.\/app-store\.js"/);
    assert.match(controllerApp, /from "\.\/ui\/dom\.js"/);
    assert.match(controllerApp, /quoteMessage: actions\.quoteMessage/);
    assert.match(controllerApp, /from "\.\/ui\/events\.js\?v=20260709-topicrace1"/);
    assert.match(controllerApp, /from "\.\/controller-actions\.js\?v=20260709-topicrace1"/);
    assert.match(controllerApp, /from "\.\/controller-responsive\.js"/);
    assert.match(controllerApp, /from "\.\/controller-render\.js\?v=20260709-topicrace1"/);
    assert.match(controllerApp, /from "\.\/controller-runtime\.js"/);
    assert.match(controllerApp, /const LIVE_TOPIC_REFRESH_INTERVAL_MS = 1000;/);
    assert.match(
      controllerApp,
      /renderRef\.current = renderers\.render;[\s\S]*responsive\.syncResponsiveView\(\);[\s\S]*responsive\.updateLayoutMetrics\(\);[\s\S]*renderers\.render\(\);/
    );
    assert.match(
      controllerApp,
      /bindPageEvents\(dom, \{[\s\S]*state: actions\.state,[\s\S]*setAuthUiSync: actions\.setAuthUiSync,/
    );
    assert.match(controllerApp, /toggleMessageLike:\s*actions\.toggleMessageLike/);
    assert.match(controllerApp, /toggleMessageDislike:\s*actions\.toggleMessageDislike/);
    assert.match(
      controllerApp,
      /openAdminPanel: actions\.openAdminPanel,[\s\S]*closeAdminPanel: actions\.closeAdminPanel,[\s\S]*applyAdminAction: actions\.applyAdminAction,/
    );
    assert.match(controllerApp, /closePublicProfileModal: actions\.closePublicProfileModal/);
    assert.doesNotMatch(
      controllerApp,
      /function cacheDom|function bindEvents|function renderIntoTargets|function getTransitionDurationMs|function bindTopbarEvents|function toggleTheme|function submitMessage/
    );
    assert.match(actions, /from "\.\/services\/api\.js\?v=20260709-topicrace1"/);
    assert.match(actions, /export function createActionHandlers/);
    assert.match(actions, /createNewTopic/);
    assert.match(actions, /openPaletteModal/);
    assert.match(
      actions,
      /function resetPaletteModalScroll\(dom\)\s*\{[\s\S]*body\.scrollTop = 0;[\s\S]*body\.scrollLeft = 0;/
    );
    assert.match(
      actions,
      /function focusPaletteModalStart\(dom\)\s*\{[\s\S]*preventScroll:\s*true[\s\S]*resetPaletteModalScroll\(dom\);[\s\S]*requestAnimationFrame/
    );
    assert.match(
      actions,
      /function openPaletteModal\(\)\s*\{[\s\S]*state\.isPaletteModalOpen = true;[\s\S]*render\(\);[\s\S]*focusPaletteModalStart\(dom\);[\s\S]*\}/
    );
    assert.match(actions, /closePaletteModal/);
    assert.match(actions, /selectPalette/);
    assert.match(actions, /ensureCustomPaletteActive/);
    assert.match(actions, /updateCustomPaletteHex/);
    assert.match(actions, /randomizeCustomPalette/);
    assert.match(actions, /activateConnectedUser/);
    assert.match(actions, /reportEntity/);
    assert.match(actions, /toggleMessageLike:\s*chatActions\.toggleMessageLike/);
    assert.match(actions, /toggleMessageDislike:\s*chatActions\.toggleMessageDislike/);
    assert.match(rankingActions, /from "\.\/ranking-state\.js"/);
    assert.match(rankingState, /export function getActiveRankingStep/);
    assert.match(rankingState, /export function setStoredRankingIndex/);
    assert.match(palettes, /export const PALETTE_OPTIONS/);
    assert.match(palettes, /export const DEFAULT_PALETTE_ID/);
    assert.match(palettes, /export const CUSTOM_PALETTE_ID/);
    assert.match(palettes, /export function buildCustomPaletteOption/);
    assert.match(palettes, /export function applyPaletteToDocument/);
    assert.match(palettes, /export function parseHexColor/);
    assert.match(responsiveController, /export function createResponsiveHelpers/);
    assert.match(renderController, /export function createRenderers/);
    assert.match(renderController, /from "\.\/ui\/palette-modal\.js\?v=20260709-topicrace1"/);
    assert.match(renderController, /renderPaletteModal/);
    assert.match(renderController, /renderPublicProfileModal/);
    assert.match(chat, /renderChat/);
    assert.match(chat, /panel--topic-create/);
    assert.match(chat, /Primer mensaje/);
    assert.match(chat, /Crear tema/);
    assert.match(chat, /Primer mensaje del nuevo tema/);
    assert.match(chat, /Enviar comentario al tema seleccionado/);
    assert.match(chat, /No se pueden enviar mensajes en este tema cerrado/);
    assert.match(chatActions, /Inicia sesion o crea una cuenta para participar/);
    assert.match(chatActions, /function openReportModal\(entityType, entityId/);
    assert.match(chatActions, /function closeReportModal\(\)/);
    assert.match(chatActions, /function submitReportModal\(reasonValue, customText/);
    assert.doesNotMatch(chatActions, /window\.prompt/);
    assert.match(chatActions, /function getReactionScrollState\(trigger\)/);
    assert.match(chatActions, /restoreReactionScroll\(reactionScrollState\);/);
    assert.match(rankings, /renderRankings/);
    assert.match(rankings, /Selecciona un tema para ver su actividad real/);
    assert.match(rankings, /getActiveRankingStep/);
    assert.match(rankings, /syncRankingListHeights/);
    assert.match(rankings, /syncRankingSkeletonHeights/);
    assert.match(rankings, /const GLOBAL_RANKING_FADE_MS = 150;/);
    assert.match(rankings, /function renderRankingTarget/);
    assert.match(rankings, /onRendered\?\.\(\{ keyChanged, target \}\)/);
    assert.match(rankings, /if \(keyChanged\) \{[\s\S]*scrollTop = 0;/);
    assert.doesNotMatch(rankings, /syncRankingListHeights\(dom\);\s*resetRankingScroll\(dom\);/);
    assert.match(rankings, /setTimeout\(\(\) => \{[\s\S]*renderIntoTargets\(\[target\]/);
    assert.match(rankings, /is-ranking-fading/);
    assert.match(rankingPanelState, /export function syncRankingListHeights/);
    assert.match(rankingPanelState, /export function syncRankingSkeletonHeights/);
    assert.match(rankingPanelState, /export function clearRankingListHeights/);
    assert.match(rankingPanelState, /ranking-skeleton-item-height/);
    assert.match(rankingPanelState, /getBoundingClientRect/);
    assert.match(rankingLabels, /getActiveRankingStep/);
    assert.match(rankingLabels, /getRankingOptions/);
    assert.match(rankingIcons, /getActiveRankingStep/);
    assert.match(paletteModal, /renderPaletteModal/);
    assert.match(paletteModal, /palette-grid__featured/);
    assert.match(paletteModal, /data-randomize-custom-palette/);
    assert.match(paletteModal, /palette-option__sample-layout/);
    assert.match(paletteModal, /palette-option__sample-bubble--accent/);
    assert.match(paletteModal, /data-custom-palette-hex/);
    assert.match(paletteModal, /palette-option__color-preview/);
    assert.match(paletteModal, /data-open-custom-palette-picker/);
    assert.match(paletteModal, /data-custom-palette-picker/);
    assert.match(paletteModal, /data-custom-palette-card/);
    assert.doesNotMatch(paletteModal, /data-accept-custom-palette/);
    assert.match(paletteModal, /closeButton:\s*true/);
    assert.match(paletteModal, /closeLabel:\s*"Aceptar"/);
    assert.match(paletteModal, /syncCustomPalettePicker/);
    assert.match(paletteModal, /colorisSignature/);
    assert.match(paletteModal, /document\.querySelector\("\.clr-picker\.clr-open"\)/);
    assert.match(paletteModal, /getPaletteGridSignature/);
    assert.match(paletteModal, /paletteRenderSignature/);
    assert.match(paletteModal, /paletteRenderPendingSignature/);
    assert.match(paletteModal, /isCustomPaletteEditing/);
    assert.doesNotMatch(paletteModal, /palette-option__description/);
    assert.match(icons, /image\.width = 84;[\s\S]*image\.height = 84;/);
    assert.match(icons, /size: AVATAR_INTRINSIC_SIZE/);
    assert.match(icons, /17\.472 14\.382/);
    assert.match(icons, /9\.101 23\.691/);
    assert.match(icons, /20\.317 4\.3698/);
    assert.match(styles, /--social-color/);
    assert.match(profileModal, /ensureSocialIcons/);
    assert.match(profileModal, /export function setSocialFieldEditing/);
    assert.match(profileModal, /input\.readOnly = !isEditing/);
    assert.match(profileModal, /if \(justOpened \|\| input\.dataset\.renderedValue !== value\)/);
    assert.match(topbarActionEvents, /setSocialFieldEditing\(field, !isEditing\)/);
    assert.match(topbarActionEvents, /resetSocialEditing\(dom\);[\s\S]*handlers\.saveProfile\(event\)/);
    assert.match(actions, /dispatch\(state, reducers\.mergeLiveTopics, payload\);[\s\S]*dispatch\(state, reducers\.setProfileModalOpen, false\);/);
    assert.doesNotMatch(html, /profile-modal__social-prefix" aria-hidden="true">\+<\/span>/);
    assert.match(
      sharedBaseComponents,
      /svg\.setAttribute\("width", "84"\);[\s\S]*svg\.setAttribute\("height", "84"\);/
    );
    assert.match(
      topbarActionEvents,
      /image\.width = 42;[\s\S]*image\.height = 42;[\s\S]*image\.loading = "lazy";/
    );
    assert.match(
      topbarActionEvents,
      /image\.width = 232;[\s\S]*image\.height = 232;[\s\S]*dom\.profileAvatarPreview\.append\(image\)/
    );
    assert.match(
      profileModal,
      /image\.width = 232;[\s\S]*image\.height = 232;[\s\S]*image\.loading = "lazy";/
    );
    assert.match(
      publicProfileModal,
      /image\.width = 232;[\s\S]*image\.height = 232;[\s\S]*image\.loading = "eager";/
    );
    assert.match(
      adminPanel,
      /image\.width = 64;[\s\S]*image\.height = 64;[\s\S]*image\.loading = "lazy";/
    );
    assert.match(publicProfileModal, /export function renderPublicProfileModal/);
    assert.match(publicProfileModal, /createdAt/);
    assert.match(publicProfileModal, /formatJoinedDateParts/);
    assert.match(dateUtils, /export function formatMessageTime/);
    assert.match(dateUtils, /export function formatProfileJoinedDate/);
    assert.match(dateUtils, /export function formatJoinedDateParts/);
    assert.match(publicProfileModal, /document\.createElement\("span"\)/);
    assert.match(publicProfileModal, /profileShowDescription/);
    assert.match(publicProfileModal, /profileShowJoinedAt/);
    assert.match(publicProfileModal, /const publicAvatarUrl = isCurrentUser \? user\.avatarPendingUrl \|\| user\.avatarUrl \|\| "" : user\.avatarUrl \|\| "";/);
    assert.match(publicProfileModal, /getRecentUserCafes/);
    assert.match(publicProfileModal, /isTopicAvailable/);
    assert.match(publicProfileModal, /dataset.publicProfileTopicId/);
    assert.match(publicProfileModal, /Ir al tema/);
    assert.match(publicProfileModal, /\u00daltimos temas/);
    assert.match(publicProfileModal, /publicProfileRecentCafes/);
    assert.match(publicProfileModal, /publicProfileDescription/);
    assert.match(publicProfileModal, /publicProfileJoinedAt/);
    assert.match(publicProfileModal, /joinedAtContainer.hidden = !joinedDate.length/);
    assert.match(publicProfileModal, /publicProfileActions\.hidden = isCurrentUser/);
    assert.match(publicProfileModal, /publicProfileReportButton\.hidden = isCurrentUser/);
    assert.match(publicProfileModal, /profileShowSocial/);
    assert.match(publicProfileModal, /publicProfileSocial/);
    assert.match(publicProfileModal, /createSocialLinkButton/);
    assert.match(publicProfileModal, /Redes sociales/);
    assert.match(publicProfileModal, /public-profile-modal__social-empty/);
    assert.match(html, /public-profile-modal__joined-label">Miembro desde/);
    assert.ok(eventsModule.includes('dom.publicProfileRecentCafes.addEventListener("click",'));
    assert.ok(eventsModule.includes("handlers.focusTopic?.(topicId)"));
    assert.match(controllerApp, /focusTopic: actions.focusTopic/);
    assert.doesNotMatch(
      publicProfileModal,
      /comment|comentario|likes received|likesRecibidos|online|estado/i
    );
    assert.match(titles, /renderTitles/);
    assert.match(topics, /renderTopics/);
    assert.match(topics, /const isLoading = !state\.viewer/);
    assert.match(topics, /if \(!topics\.length\) \{\s*return \[\];\s*\}/);
    assert.match(users, /renderUsers/);
    assert.match(users, /const isLoading = !state\.viewer/);
    assert.match(users, /if \(!ordered\.length\) \{\s*return \[\];\s*\}/);
    assert.match(users, /user-item--leaving/);
    assert.match(users, /buildMergedUserItemsForTarget/);
    assert.match(users, /scheduleLeaveCleanup/);
    assert.match(styles, /\.user-item--leaving/);
    assert.match(chat, /const isLoading = !state\.viewer/);
    assert.match(components, /export function createMessageSkeleton/);
    assert.match(chat, /createMessageSkeleton/);
    assert.match(chat, /message-stream message-stream--loading/);
    assert.match(chat, /messageStream\.setAttribute\("aria-busy", String\(isLoading\)\)/);
    assert.match(chat, /messageStream\.setAttribute\("role", "status"\)/);
    assert.match(chat, /messageStream\.removeAttribute\("role"\)/);
    assert.match(styles, /\.message--skeleton/);
    assert.match(styles, /@keyframes chat-skeleton-settle/);
    assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(domModule, /export function cacheDom/);
    assert.match(domModule, /chatTitle/);
    assert.match(domModule, /topicTitleInput/);
    assert.match(domModule, /rankingScopeTabs/);
    assert.doesNotMatch(domModule, /drawerRankingModeList/);
    assert.match(domModule, /themeToggleDesktopSlot/);
    assert.match(domModule, /themeToggleMobileSlot/);
    assert.match(domModule, /themeToggleDrawerSlot/);
    assert.match(domModule, /mobileTopbarMenu/);
    assert.match(domModule, /mobileDrawerPanels/);
    assert.match(domModule, /drawerUsersSection/);
    assert.match(domModule, /paletteModalBackdrop/);
    assert.match(domModule, /publicProfileModalBackdrop/);
    assert.match(domModule, /paletteOptionGrid/);
    assert.match(domModule, /assertRequiredDom/);
    assert.match(domModule, /Missing required DOM nodes/);
    assert.match(eventsModule, /from "\.\/topbar\.js\?v=20260709-topicrace1"/);
    assert.match(eventsModule, /syncComposerTextareaHeight/);
    assert.match(eventsModule, /function shouldBlockTextareaInput\(textarea, event\)/);
    assert.match(eventsModule, /messageInput\.addEventListener\("beforeinput", \(event\) => \{[\s\S]*event\.preventDefault\(\);/);
    assert.match(eventsModule, /function positionFloatingMessageActionMenu\(menu\)/);
    assert.match(eventsModule, /menu\.style\.position = "fixed"/);
    assert.match(eventsModule, /document\.querySelector\(\`\[data-message-menu=/);
    assert.match(eventsModule, /bodyRect\.bottom - menu\.offsetHeight - 8/);
    assert.match(eventsModule, /document\.body\.append\(menu\)/);
    assert.match(eventsModule, /function restoreMessageActionMenu\(menu\)/);
    assert.match(eventsModule, /body\.insertBefore\(menu, body\.firstChild\)/);
    assert.match(eventsModule, /if \(insideMessageActionMenu instanceof HTMLElement && dispatchMessageActionClick\(event\.target\)\) \{/);
    assert.match(eventsModule, /export function bindPageEvents/);
    assert.match(eventsModule, /Coloris\.close/);
    assert.match(
      eventsModule,
      /messageForm\.addEventListener\("submit", handlers\.submitMessage\)/
    );
    assert.match(
      eventsModule,
      /messageInput\.addEventListener\("input", \(\) => \{[\s\S]*syncComposerTextareaHeight\(dom\.messageInput\);/
    );
    assert.match(chat, /export function syncComposerTextareaHeight/);
    assert.match(chat, /textarea\.style\.height = ""/);
    assert.doesNotMatch(chat, /textarea\.style\.height = `\$\{nextHeight\}px`/);
    assert.match(chat, /classList\.toggle\(\s*"is-scrollable"/);
    assert.match(previewServer, /const topicId = segments\[2\] \|\| "";/);
    assert.match(chat, /syncMessageCardHeights\(dom\.messageStream\);/);
    assert.match(styles, /\.message-stream\s*\{[\s\S]*padding:\s*0 16px 0 0;[\s\S]*scroll-padding-bottom:\s*0;/);
    assert.match(chat, /function getMessageBodyMeasuredScrollHeight\(body\)/);
    assert.match(chat, /const MESSAGE_CARD_MIN_HEIGHT_PX = 112;/);
    assert.match(chat, /Math\.max\(MESSAGE_CARD_MIN_HEIGHT_PX, getMessageBodyMeasuredScrollHeight\(body\)\)/);
    assert.doesNotMatch(chat, /MESSAGE_LAST_CARD_MIN_HEIGHT_PX|lastElementChild/);
    assert.match(chat, /if \(card\.style\.minHeight !== nextMinHeight\)/);
    assert.match(chat, /\.message__action-menu:not\(\[hidden\]\), \.message__reaction-menu:not\(\[hidden\]\)/);
    assert.match(styles, /\.message__action-menu\s*\{[\s\S]*top:\s*auto;[\s\S]*bottom:\s*8px;/);
    assert.match(
      styles,
      /\.message__reaction-menu\s*\{[\s\S]*display:\s*grid;[\s\S]*min-width:\s*112px;/
    );
    assert.match(
      styles,
      /\.message__reaction-menu \.message__action-menu-button\s*\{[\s\S]*min-width:\s*0;[\s\S]*border-bottom:\s*1px solid/
    );
    assert.match(chat, /syncTopicReportButton/);
    assert.match(chat, /chatHero\.hidden = true;/);
    assert.doesNotMatch(
      chat,
      /if \(shouldSyncChatLayout\(previousRenderState,\s*nextRenderState\)\)\s*\{[\s\S]*syncMessageCardHeights\(dom\.messageStream\);/
    );
    assert.match(eventsModule, /activateConnectedUser/);
    assert.match(eventsModule, /profileAvatarCropModal/);
    assert.match(eventsModule, /closePublicProfileModal/);
    assert.match(eventsModule, /reportEntity/);
    assert.match(eventsModule, /data-report-entity-type/);
    assert.match(eventsModule, /data-connected-user-id/);
    assert.match(eventsModule, /data-user-action/);
    assert.match(renderUtils, /renderIntoTargets/);
    assert.match(renderUtils, /function shouldPreserveMessageLayoutStyle/);
    assert.match(renderUtils, /existing\.classList\?\.contains\?\.\("message"\)/);
    assert.match(drawers, /getTransitionDurationMs/);
    assert.match(topbar, /from "\.\/topbar-action-events\.js\?v=20260709-topicrace1"/);
    assert.match(topbar, /bindTopbarEvents/);
    assert.match(topbarActionEvents, /openPaletteModal/);
    assert.match(topbarActionEvents, /closePaletteModal/);
    assert.match(topbarActionEvents, /updateCustomPaletteHex/);
    assert.match(topbarActionEvents, /randomizeCustomPalette/);
    assert.match(topbarActionEvents, /data-open-custom-palette-picker/);
    assert.match(topbarActionEvents, /data-custom-palette-picker/);
    assert.match(topbarActionEvents, /data-custom-palette-card/);
    assert.match(topbarActionEvents, /CUSTOM_PALETTE_ID/);
    assert.match(topbarActionEvents, /const PROFILE_AVATAR_SOURCE_MAX_BYTES = 8 \* 1024 \* 1024;/);
    assert.match(topbarActionEvents, /const PROFILE_AVATAR_CROP_SIZE = 1024;/);
    assert.match(topbarActionEvents, /const PROFILE_AVATAR_CROP_PREVIEW_SIZE = 256;/);
    assert.match(
      topbarActionEvents,
      /addListener\(dom\.profileAvatarPreview, "click", openProfileAvatarPicker\)/
    );
    assert.match(topbarActionEvents, /setProfileSectionEditing\(dom, section, !isEditing\)/);
    assert.match(
      topbarActionEvents,
      /addListener\(dom\.profileNameEditButton, "click", \(\) => toggleProfileSection\("name"\)\)/
    );
    assert.match(topbarActionEvents, /let profileAvatarCropState = null;/);
    assert.match(topbarActionEvents, /getProfileAvatarCropPreviewSize/);
    assert.match(topbarActionEvents, /state\.offsetX \* outputRatio/);
    assert.match(topbarActionEvents, /canvas\.toDataURL\("image\/jpeg", 0\.88\)/);
    assert.match(topbarActionEvents, /bindPickerLifecycle/);
    assert.match(topbarActionEvents, /bindPickerActionButtons/);
    assert.match(topbarActionEvents, /requestPickerClose/);
    assert.match(topbarActionEvents, /applyPickerClose/);
    assert.match(topbarActionEvents, /dismissPaletteModal/);
    assert.match(topbarActionEvents, /data-dismiss-custom-palette-picker/);
    assert.match(topbarActionEvents, /sanitizeHexDraft/);
    assert.match(topbarActionEvents, /syncAuthUi/);
    assert.match(topbarActionEvents, /handlers\.setAuthUiSync\?\.\(syncAuthUi\)/);
    assert.match(topbarActionEvents, /window\.matchMedia\("\(max-width: 960px\)"\)\.matches/);
    assert.match(
      topbarActionEvents,
      /document\.documentElement\.dataset\.authState = isLoggedIn\(\) \? "logged-in" : "logged-out"/
    );
    assert.match(
      topbarActionEvents,
      /await handlers\.login\?\.\(\{ turnstileToken, selectedTopicId: getPendingAuthTopicId\(\) \}\)/
    );
    assert.match(topbarActionEvents, /await handlers\.logout\?\.\(\)/);
    assert.match(topbarActionEvents, /dom\.authTools\.hidden = !loggedIn/);
    assert.match(topbarActionEvents, /setLoggedIn/);
    assert.match(topbarActionEvents, /addListener\(dom\.authButton,\s*"click"/);
    assert.match(topbarActionEvents, /dom\.authButton\.hidden = isMobile && loggedIn/);
    assert.match(
      topbarActionEvents,
      /authLabel = loggedIn[\s\S]*"Cerrar sesión"[\s\S]*"Iniciar sesión"/
    );
    assert.match(topbarActionEvents, /target\.dataset\.mobileTopbarAction === "auth"/);
    assert.match(topbarActionEvents, /Toca de nuevo para cerrar sesión/);
    assert.match(topbarActionEvents, /function validateAuthEmailFields/);
    assert.match(topbarActionEvents, /dom\.authPasswordForm\.dataset\.authMode = isAccountLink \? "link" : isRecovery \? "recovery" : authPasswordMode/);
    assert.match(topbarActionEvents, /dom\.authPasswordForm\.dataset\.authStep =/);
    assert.match(topbarActionEvents, /handlers\.requestEmailAuthCode/);
    assert.match(topbarActionEvents, /handlers\.verifyEmailAuthCode/);
    assert.match(topbarActionEvents, /handlers\.requestPasswordResetCode/);
    assert.match(topbarActionEvents, /handlers\.confirmPasswordReset/);
    assert.match(topbarActionEvents, /handlers\.startAccountLink/);
    assert.match(topbarActionEvents, /addListener\(dom\.authRecoveryButton,\s*"click"/);
    assert.match(topbarActionEvents, /addListener\(dom\.profileLinkGoogleButton,\s*"click"/);
    assert.match(topbarActionEvents, /setAuthFieldInvalid\(dom\.authNicknameInput, true\)/);
    assert.match(topbarActionEvents, /const message = authValidationMessage \|\| "Revisa los campos marcados\."/);
    assert.match(topbarActionEvents, /flashAuthButtonError\(dom\.authPasswordButton, message\)/);
    assert.match(topbarActionEvents, /Ingresa un email válido/);
    assert.match(topbarActionEvents, /La contraseña debe tener al menos 8 caracteres/);
    assert.match(topbarActionEvents, /Completa tu fecha de nacimiento/);
    assert.match(topbarActionEvents, /Debes tener al menos \$\{AUTH_MINIMUM_AGE\} años para registrarte/);
    assert.match(topbarActionEvents, /Acepta los Términos y Condiciones para continuar/);
    assert.match(topbarActionEvents, /Ingresa el código de 6 dígitos que te enviamos por email/);
    assert.match(topbarActionEvents, /const authModalTitle = authOidcCompletion[\s\S]*?"Completa tu registro"[\s\S]*?"Recuperar contraseña"[\s\S]*?"Vincular con Google"[\s\S]*?"Regístrate" : "Iniciar Sesión"/);
    assert.match(topbarActionEvents, /requestLogoutConfirmation\(\)/);
    assert.match(topbarActionEvents, /data-mobile-topbar-action/);
    assert.match(topbarActionEvents, /setMobileDrawerPanel/);
    assert.match(topbarActionEvents, /data-mobile-drawer-panel/);
    assert.match(topbarActionEvents, /data-mobile-drawer-back/);
    assert.match(store, /export \{ state \} from "\.\/state-store\.js";/);
    assert.match(store, /export \{ dom \} from "\.\/dom-store\.js";/);
    assert.match(store, /export \{ closeTimerRef \} from "\.\/timer-store\.js";/);
    assert.match(stateStore, /export const state/);
    assert.match(stateStore, /theme:\s*"dark"/);
    assert.match(stateStore, /paletteId:\s*"default"/);
    assert.match(stateStore, /customPaletteHex:\s*"#B25B33"/);
    assert.match(stateStore, /isPaletteModalOpen:\s*false/);
    assert.match(stateStore, /activeConnectedUserId:\s*null/);
    assert.match(stateStore, /publicProfileUserId:\s*null/);
    assert.doesNotMatch(stateStore, /\brankingType\b|\brankingMetric\b|\brankingIndex\b/);
    assert.match(domStore, /export const dom/);
    assert.match(timerStore, /export const closeTimerRef/);
    assert.doesNotMatch(app, /createTopicForm|mobileCreateTopicForm/);
  });

  await test("settings modal ids are registered in DOM_IDS so bootstrap can wire them", async () => {
    // Object.assign(dom, cacheDom()) copia un snapshot plano del Proxy, asi que
    // cualquier id que no este en DOM_IDS queda undefined tras el bootstrap.
    const domSource = await read("ui/dom.js");
    const indexSource = await read("index.html");
    const settingsIds = [
      "settingsButton",
      "settingsModalBackdrop",
      "settingsModal",
      "closeSettingsModalButton",
      "settingsLikesAnonymousToggle",
      "settingsFilterProfanityToggle",
      "settingsFriendsOnlyToggle",
      "settingsDeleteAccountButton",
      "settingsDeleteConfirmRow",
      "settingsDeleteCancelButton",
      "settingsDeleteConfirmButton"
    ];
    const domIdsSection = domSource.slice(domSource.indexOf("const DOM_IDS"));
    for (const id of settingsIds) {
      assert.equal(domIdsSection.includes(`"${id}"`), true, `DOM_IDS debe incluir ${id}`);
      assert.equal(indexSource.includes(`id="${id}"`), true, `index.html debe incluir #${id}`);
    }
    // El engranaje vive a la derecha del boton Perfil, no en el grupo derecho.
    const profileIndex = indexSource.indexOf('id="profileButton"');
    const settingsIndex = indexSource.indexOf('id="settingsButton"');
    const paletteIndex = indexSource.indexOf('id="paletteButton"');
    assert.equal(profileIndex < settingsIndex && settingsIndex < paletteIndex, true);
  });

  await test("settings button click opens the modal through the page event wiring", async () => {
    // Regresion: bindPageEvents reenvia una lista explicita de handlers; si los
    // de configuracion faltan ahi, el click no hace nada aunque el listener exista.
    const controllerAppSource = await read("controller-app.js");
    for (const handlerName of [
      "openSettingsModal",
      "closeSettingsModal",
      "toggleSetting",
      "requestAccountDeletion",
      "cancelAccountDeletion",
      "confirmAccountDeletion"
    ]) {
      assert.match(
        controllerAppSource,
        new RegExp(`${handlerName}: actions\\.${handlerName}`),
        `bindPageEvents debe reenviar ${handlerName}`
      );
    }

    const previousDocument = globalThis.document;
    const previousElement = globalThis.Element;
    const previousHTMLElement = globalThis.HTMLElement;
    const previousHTMLInputElement = globalThis.HTMLInputElement;
    const previousHTMLButtonElement = globalThis.HTMLButtonElement;

    class FakeElement {
      constructor() {
        this.dataset = {};
        this.listeners = new Map();
      }

      addEventListener(type, listener) {
        this.listeners.set(type, listener);
      }

      dispatch(type, event = {}) {
        this.listeners.get(type)?.({
          preventDefault() {},
          stopImmediatePropagation() {},
          ...event,
          target: event.target || this
        });
      }

      closest() {
        return null;
      }
    }

    class FakeInput extends FakeElement {}
    class FakeButton extends FakeElement {}

    const settingsButton = new FakeButton();
    const dom = {
      themeToggle: new FakeElement(),
      refreshButton: new FakeElement(),
      messageForm: new FakeElement(),
      profileButton: new FakeElement(),
      backToTopics: new FakeElement(),
      storeButton: new FakeElement(),
      paletteButton: new FakeElement(),
      settingsButton,
      createTopicButton: new FakeElement()
    };

    let openCalls = 0;

    try {
      globalThis.Element = FakeElement;
      globalThis.HTMLElement = FakeElement;
      globalThis.HTMLInputElement = FakeInput;
      globalThis.HTMLButtonElement = FakeButton;
      globalThis.document = {
        documentElement: { dataset: {} },
        addEventListener() {},
        querySelector() {
          return null;
        }
      };

      bindTopbarActionEvents(dom, {
        toggleTheme() {},
        refreshCurrentTopic() {},
        submitMessage() {},
        flashTitle() {},
        backToTopics() {},
        openPaletteModal() {},
        closePaletteModal() {},
        openSettingsModal() {
          openCalls += 1;
        },
        createNewTopic() {}
      });

      settingsButton.dispatch("click");
      assert.equal(openCalls, 1);
    } finally {
      globalThis.document = previousDocument;
      globalThis.Element = previousElement;
      globalThis.HTMLElement = previousHTMLElement;
      globalThis.HTMLInputElement = previousHTMLInputElement;
      globalThis.HTMLButtonElement = previousHTMLButtonElement;
    }
  });

  await test("profanity filter censors spanish and english words with leet variants", () => {
    assert.equal(censorProfanity("sos un pene"), "sos un ****");
    assert.equal(censorProfanity("sos un p3ne"), "sos un ****");
    assert.equal(censorProfanity("PUT4 madre"), "**** madre");
    assert.equal(censorProfanity("what the fvck"), "what the ****");
    assert.equal(censorProfanity("boluuuudo total"), "********* total");
    assert.equal(censorProfanity("texto normal sin nada"), "texto normal sin nada");
    // Palabras inocentes que casi colisionan no se censuran.
    assert.equal(censorProfanity("este año fui al cono sur"), "este año fui al cono sur");
    assert.equal(hasProfanity("una mierda"), true);
    assert.equal(hasProfanity("una merienda"), false);

    setProfanityFilterEnabled(false);
    assert.equal(filterDisplayText("una mierda"), "una mierda");
    setProfanityFilterEnabled(true);
    assert.equal(filterDisplayText("una mierda"), "una ******");
    setProfanityFilterEnabled(false);
  });

  await test("like notifications name the liker when known and friends-only filter applies", () => {
    const rootMessage = {
      ...createMessage("u1", "Post original", 0, "user", 1_700_000_000_000, true),
      id: "root-1",
      likes: 4
    };
    const nextRootMessage = { ...rootMessage, likes: 5, lastLikeById: "u2", lastLikeByName: "Mora" };
    const previousTopic = {
      id: "topic-1",
      title: "Tema",
      authorId: "u1",
      messages: [rootMessage]
    };
    const nextTopic = { ...previousTopic, messages: [nextRootMessage] };
    const users = [{ id: "u1", name: "Cami" }, { id: "u2", name: "Mora" }];

    const notifications = collectTopicNotifications(
      {
        viewer: { id: "u1", name: "Cami" },
        currentUserId: "u1",
        followedTopicIds: [],
        notifiedMessageIds: [],
        users,
        topics: [previousTopic]
      },
      {
        viewer: { id: "u1", name: "Cami" },
        users,
        topics: [nextTopic],
        selectedTopicId: "topic-1"
      },
      1_700_000_002_000
    );

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].kind, "post-like");
    assert.equal(notifications[0].actors[0].name, "Mora");
    assert.match(notifications[0].body, /^Mora le dio like/);

    // Sin datos del liker (anonimo) vuelve a "Alguien".
    const anonymousNotifications = collectTopicNotifications(
      {
        viewer: { id: "u1", name: "Cami" },
        currentUserId: "u1",
        followedTopicIds: [],
        notifiedMessageIds: [],
        users,
        topics: [previousTopic]
      },
      {
        viewer: { id: "u1", name: "Cami" },
        users,
        topics: [{ ...previousTopic, messages: [{ ...rootMessage, likes: 5 }] }],
        selectedTopicId: "topic-1"
      },
      1_700_000_003_000
    );
    assert.equal(anonymousNotifications[0].actors[0].name, "Alguien");

    const friendships = { incoming: [], outgoing: [], friends: [{ id: "u2", name: "Mora" }] };
    assert.equal(filterNotificationsForFriends(notifications, friendships).length, 1);
    assert.equal(
      filterNotificationsForFriends(notifications, { incoming: [], outgoing: [], friends: [] }).length,
      0
    );
    assert.equal(filterNotificationsForFriends(anonymousNotifications, friendships).length, 0);
  });

  await test("backend persists viewer settings and exposes last liker respecting anonymity", async () => {
    await withTempStore((store) => {
      store.registerWithPassword({
        sessionId: "session-settings-author",
        email: "settings-author@example.com",
        password: "password-segura",
        nickname: "settings_author"
      });
      const voterPayload = store.registerWithPassword({
        sessionId: "session-settings-voter",
        email: "settings-voter@example.com",
        password: "password-segura",
        nickname: "settings_voter"
      });
      const voterName = voterPayload.viewer.displayName;

      const updated = store.updateSettings({
        sessionId: "session-settings-voter",
        filterProfanity: true,
        notificationsFriendsOnly: true
      });
      assert.equal(updated.viewer.filterProfanity, true);
      assert.equal(updated.viewer.notificationsFriendsOnly, true);
      assert.equal(updated.viewer.likesAnonymous, false);

      const created = store.createTopic({
        sessionId: "session-settings-author",
        title: "Tema para likes con nombre",
        text: "Mensaje raiz"
      });
      const topic = created.topics.find((entry) => entry.title === "Tema para likes con nombre");
      const rootMessage = topic.messages[0];

      const liked = store.toggleMessageLike(rootMessage.id, {
        sessionId: "session-settings-voter",
        selectedTopicId: topic.id
      });
      const likedMessage = liked.topics
        .find((entry) => entry.id === topic.id)
        .messages.find((entry) => entry.id === rootMessage.id);
      assert.equal(likedMessage.lastLikeByName, voterName);

      // Con likes anonimos el nombre deja de exponerse.
      store.updateSettings({
        sessionId: "session-settings-voter",
        likesAnonymous: true
      });
      const refreshed = store.openTopic(topic.id, { sessionId: "session-settings-author" });
      const refreshedMessage = refreshed.topics
        .find((entry) => entry.id === topic.id)
        .messages.find((entry) => entry.id === rootMessage.id);
      assert.equal(refreshedMessage.lastLikeByName, null);
      assert.equal(refreshedMessage.lastLikeById, null);
      assert.equal(refreshedMessage.likes, 1);

      // Los invitados no pueden guardar configuracion.
      assert.throws(
        () => store.updateSettings({ sessionId: "session-settings-guest", filterProfanity: true }),
        (error) => error?.code === "LOGIN_REQUIRED"
      );
    });
  });

  await test("backend deletes account anonymizing the user and downgrading to guest", async () => {
    await withTempStore((store) => {
      store.registerWithPassword({
        sessionId: "session-delete-me",
        email: "delete-me@example.com",
        password: "password-segura",
        nickname: "delete_me"
      });
      const created = store.createTopic({
        sessionId: "session-delete-me",
        title: "Tema que sobrevive",
        text: "Mensaje que sobrevive"
      });
      const topic = created.topics.find((entry) => entry.title === "Tema que sobrevive");
      const deletedUserId = created.viewer.id;

      const payload = store.deleteAccount({ sessionId: "session-delete-me" });
      assert.equal(payload.viewer.type, "guest");
      assert.equal(payload.users.some((user) => user.id === deletedUserId), false);
      assert.equal(payload.topics.some((entry) => entry.id === topic.id), true);

      assert.throws(
        () =>
          store.loginWithPassword({
            sessionId: "session-delete-me-2",
            email: "delete-me@example.com",
            password: "password-segura"
          }),
        (error) => Boolean(error)
      );

      // Los invitados no pueden eliminar cuentas.
      assert.throws(
        () => store.deleteAccount({ sessionId: "session-guest-delete" }),
        (error) => error?.code === "LOGIN_REQUIRED"
      );
    });
  });

  console.log("all tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
