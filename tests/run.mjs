import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createBackendStore } from "../services/backend-store.js";
import { createChatActions } from "../controller-chat-actions.js";
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
import { createResponsiveHelpers } from "../controller-responsive.js";
import { createResizeHandler } from "../controller-runtime.js";
import { applyStoredTheme } from "../controller-theme.js";
import { createActionHandlers } from "../controller-actions.js";
import { reducers } from "../store-logic.js";
import { api } from "../services/api.js";
import {
  buildCustomPaletteOption,
  CUSTOM_PALETTE_ID,
  DEFAULT_CUSTOM_PALETTE_HEX,
  DEFAULT_PALETTE_ID,
  getFaviconDataUrl,
  getCustomPaletteVars,
  normalizeHexColor,
  parseHexColor,
  PALETTE_OPTIONS,
  isPaletteId
} from "../palettes.js";
import { buildPostRankingEntries, buildUserRankingEntries } from "../ui/ranking-data.js";
import { bindTopbarActionEvents } from "../ui/topbar-action-events.js";
import { bindPageEvents } from "../ui/events.js";
import { shouldScrollChatToBottom, shouldSyncChatLayout } from "../ui/chat.js";
import { renderTitles } from "../ui/titles.js";

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
  const faviconLink = { rel: "icon", href: "./favicon.svg" };

  return {
    head: {
      appendChild(node) {
        return node;
      }
    },
    createElement(tagName) {
      return { tagName, rel: "", href: "" };
    },
    querySelector(selector) {
      if (selector === "link[rel*='icon']") {
        return faviconLink;
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

async function withTempStore(fn) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "topykly-store-"));
  const dbPath = path.join(tempDir, "topykly.sqlite");
  const store = createBackendStore({ dbPath });

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
    const messages = Array.from({ length: 35 }, (_, index) => createMessage("u1", `m${index}`, index, "user", Date.now(), index === 0));
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
      messages: Array.from({ length: 30 }, (_, index) => createMessage("u1", `m${index}`, index, "user", Date.now(), index === 0))
    };
    const nextMessage = createMessage("u2", "Este es el nuevo mensaje que debe quedar visible en el preview.", 0);

    const updatedTopic = appendMessageToTopic(baseTopic, nextMessage);

    assert.equal(updatedTopic.messages.length, 30);
    assert.equal(updatedTopic.messages[0].text, "m0");
    assert.equal(updatedTopic.messages[1].text, "m2");
    assert.equal(updatedTopic.messages[29].id, nextMessage.id);
    assert.equal(updatedTopic.subtitle, "Este es el nuevo mensaje que debe quedar visible en el preview.");
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
    assert.equal(nextTopics.some((topic) => topic.id === "topic-40"), false);
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
          messages: Array.from(
            { length: index === 24 ? 30 : 1 },
            (_, messageIndex) => createMessage("u1", `m${index + 1}-${messageIndex}`, messageIndex, "user", Date.now(), messageIndex === 0)
          )
        }))
      )
    };
    const nextMessage = createMessage("u2", "Mensaje nuevo para sincronizar reducer y revivir el tema.", 0);

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
    assert.equal(nextState.topics[0].subtitle, "Mensaje nuevo para sincronizar reducer y revivir el tema.");
    assert.equal(getVisibleTopics(nextState.topics).length, TOPIC_VISIBLE_LIMIT);
  });

  await test("createTopic builds a new topic from title and first message", () => {
    const topic = createTopic("u1", "  Nuevo tema  ", "  Primer mensaje para abrir el hilo.  ", 1_700_000_000_000);

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
      assert.equal(payload.users.some((user) => user.id === payload.viewer.id), true);
    });
  });

  await test("backend login and logout persist the viewer mode for the same session", async () => {
    await withTempStore((store) => {
      const initialPayload = store.bootstrap({
        sessionId: "session-auth-flow"
      });
      const selectedTopicId = initialPayload.topics[0].id;

      assert.equal(initialPayload.viewer.type, "guest");

      const loggedIn = store.login({
        sessionId: "session-auth-flow",
        selectedTopicId
      });

      assert.equal(loggedIn.viewer.type, "registered");
      assert.equal(loggedIn.viewer.id, "u1");
      assert.equal(loggedIn.selectedTopicId, selectedTopicId);

      const refreshedRegistered = store.refresh({
        sessionId: "session-auth-flow"
      });

      assert.equal(refreshedRegistered.viewer.type, "registered");
      assert.equal(refreshedRegistered.viewer.id, "u1");

      const loggedOut = store.logout({
        sessionId: "session-auth-flow",
        selectedTopicId
      });

      assert.equal(loggedOut.viewer.type, "guest");
      assert.notEqual(loggedOut.viewer.id, "u1");
      assert.equal(loggedOut.selectedTopicId, selectedTopicId);

      const refreshedGuest = store.refresh({
        sessionId: "session-auth-flow"
      });

      assert.equal(refreshedGuest.viewer.type, "guest");
      assert.equal(refreshedGuest.viewer.id, loggedOut.viewer.id);
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
        displayName: "Test User",
        avatarUrl: "https://cdn.example.com/avatar.png"
      });

      assert.equal(initialPayload.viewer.type, "registered");
      assert.notEqual(initialPayload.viewer.id, "u1");
      assert.equal(initialPayload.viewer.email, "test@example.com");
      assert.equal(initialPayload.viewer.authProvider, "https://accounts.example.com");
      assert.equal(initialPayload.viewer.avatarUrl, "https://cdn.example.com/avatar.png");

      const secondPayload = store.loginWithIdentity({
        sessionId: "session-oidc-2",
        sourceSessionId: "session-oidc-source-2",
        authProvider: "https://accounts.example.com",
        authSubject: "subject-123",
        email: "test@example.com",
        displayName: "Test User Renamed"
      });

      assert.equal(secondPayload.viewer.id, initialPayload.viewer.id);
      assert.equal(secondPayload.viewer.displayName, "Test User Renamed");
    });
  });

  await test("backend updateProfile lets registered users change or clear avatar only", async () => {
    await withTempStore((store) => {
      store.login({
        sessionId: "session-profile",
        selectedTopicId: null
      });

      const updated = store.updateProfile({
        sessionId: "session-profile",
        avatarUrl: "https://cdn.example.com/new-avatar.jpg"
      });

      assert.equal(updated.viewer.type, "registered");
      assert.equal(updated.viewer.avatarUrl, "https://cdn.example.com/new-avatar.jpg");
      assert.equal(updated.users.find((user) => user.id === updated.viewer.id)?.avatarUrl, "https://cdn.example.com/new-avatar.jpg");

      const cleared = store.updateProfile({
        sessionId: "session-profile",
        avatarUrl: ""
      });
      assert.equal(cleared.viewer.avatarUrl, null);

      assert.throws(() => store.updateProfile({
        sessionId: "session-profile-guest",
        avatarUrl: "https://cdn.example.com/guest.jpg"
      }), /Hace falta iniciar sesion/);

      assert.throws(() => store.updateProfile({
        sessionId: "session-profile",
        avatarUrl: "javascript:alert(1)"
      }), /http o https/);
    });
  });

  await test("backend reports persist per session and moderation can resolve topic and message reports", async () => {
    await withTempStore((store) => {
      const bootstrapPayload = store.bootstrap({
        sessionId: "session-report-viewer",
        authMode: "guest"
      });
      const topicId = bootstrapPayload.topics[0].id;
      const reportableMessageId = bootstrapPayload.topics[0].messages.find((message) => !message.isRoot)?.id;

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

      const blockedPayload = store.applyModerationAction("block_topic", {
        sessionId: "session-moderator",
        targetType: "topic",
        targetId: topicId,
        selectedTopicId: topicId
      });
      const blockedTopic = blockedPayload.topics.find((topic) => topic.id === topicId);

      assert.ok(blockedTopic);
      assert.equal(blockedTopic.status, "blocked");
      assert.equal(store.listReports({ sessionId: "session-moderator" }).reports.some((report) => (
        report.entityType === "topic" && report.entityId === topicId
      )), false);

      const afterDeletePayload = store.applyModerationAction("delete_message", {
        sessionId: "session-moderator",
        targetType: "message",
        targetId: reportableMessageId,
        selectedTopicId: topicId
      });
      const moderatedTopic = afterDeletePayload.topics.find((topic) => topic.id === topicId);

      assert.ok(moderatedTopic);
      assert.equal(moderatedTopic.messages.some((message) => message.id === reportableMessageId), false);
      assert.equal(store.listReports({ sessionId: "session-moderator" }).reports.length, 0);
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

      assert.equal(openReports.reports.some((report) => (
        report.entityType === "user" && report.entityId === "u3"
      )), true);

      store.applyModerationAction("expel_user", {
        sessionId: "session-moderator",
        targetType: "user",
        targetId: "u3"
      });

      openReports = store.listReports({
        sessionId: "session-moderator"
      });
      assert.equal(openReports.reports.some((report) => (
        report.entityType === "user" && report.entityId === "u3"
      )), false);

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
      assert.equal(openReports.reports.some((report) => (
        report.entityType === "message" && report.entityId === messageId.slice("message-".length)
      )), true);
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

      assert.throws(() => {
        store.createTopic({
          sessionId: "session-expelled-user",
          authMode: "registered",
          title: "No entra",
          text: "No entra"
        });
      }, (error) => error.code === "USER_EXPELLED");

      assert.throws(() => {
        store.addMessage(topicId, {
          sessionId: "session-expelled-user",
          authMode: "registered",
          text: "No comenta"
        });
      }, (error) => error.code === "USER_EXPELLED");

      assert.throws(() => {
        store.reportEntity("topic", topicId, {
          sessionId: "session-expelled-user",
          authMode: "registered",
          reason: "No reporta"
        });
      }, (error) => error.code === "USER_EXPELLED");
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

  await test("backend createTopic inserts the new topic at rank 0 and keeps the active window capped at 40", async () => {
    await withTempStore((store) => {
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
        store.addMessage(topicId, {
          sessionId: `session-root-reply-${index}`,
          authMode: "guest",
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

      assert.throws(() => {
        store.addMessage(expelledCandidateId, {
          sessionId: "session-expel-comment",
          authMode: "guest",
          text: "No deberia entrar"
        });
      }, (error) => error.code === "TOPIC_EXPELLED_OR_BLOCKED" && error.topicStatus === "expelled");

      const activeTopicId = store.bootstrap({
        sessionId: "session-rate-bootstrap",
        authMode: "registered"
      }).topics[0].id;

      store.addMessage(activeTopicId, {
        sessionId: "session-rate-a",
        authMode: "registered",
        text: "Primer comentario"
      });

      assert.throws(() => {
        store.addMessage(activeTopicId, {
          sessionId: "session-rate-b",
          authMode: "registered",
          text: "Segundo comentario demasiado rapido"
        });
      }, (error) => error.code === "RATE_LIMITED" && Number.isInteger(error.retryAfterSeconds));
    });
  });

  await test("backend session and ip blocks deny participation without breaking read access", async () => {
    await withTempStore((store) => {
      const blockedSessionPayload = store.bootstrap({
        sessionId: "session-blocked-guest",
        authMode: "guest",
        ipAddress: "203.0.113.10"
      });
      const topicId = blockedSessionPayload.topics[0].id;

      store.login({
        sessionId: "session-moderator",
        userId: "u2",
        ipAddress: "198.51.100.20"
      });

      store.applyModerationAction("block_session", {
        sessionId: "session-moderator",
        targetType: "session",
        targetId: "session-blocked-guest",
        reason: "Spam reiterado"
      });

      assert.throws(() => {
        store.addMessage(topicId, {
          sessionId: "session-blocked-guest",
          authMode: "guest",
          text: "No deberia publicar",
          ipAddress: "203.0.113.10"
        });
      }, (error) => error.code === "SESSION_BLOCKED");

      const readOnlyPayload = store.openTopic(topicId, {
        sessionId: "session-blocked-guest",
        authMode: "guest",
        ipAddress: "203.0.113.10"
      });

      assert.equal(readOnlyPayload.selectedTopicId, topicId);

      store.applyModerationAction("block_ip", {
        sessionId: "session-moderator",
        targetType: "ip",
        targetId: "203.0.113.99",
        reason: "Reincidencia"
      });

      assert.throws(() => {
        store.createTopic({
          sessionId: "session-ip-blocked",
          authMode: "guest",
          title: "No entra",
          text: "No entra",
          ipAddress: "203.0.113.99"
        });
      }, (error) => error.code === "IP_BLOCKED");

      assert.throws(() => {
        store.login({
          sessionId: "session-ip-login",
          ipAddress: "203.0.113.99"
        });
      }, (error) => error.code === "IP_BLOCKED");

      const diagnostics = store.getDiagnostics();

      assert.deepEqual(diagnostics, {
        dbPath: diagnostics.dbPath,
        topics: diagnostics.topics,
        messages: diagnostics.messages,
        users: diagnostics.users,
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
    assert.equal(
      shouldScrollChatToBottom(previousState, { ...previousState }, true),
      false
    );
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
    assert.equal(shouldSyncChatLayout(previousState, { ...previousState, lastMessageId: "m31" }), true);
    assert.equal(shouldSyncChatLayout(previousState, { ...previousState, topicId: "topic-2" }), true);
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
    assert.equal(normalizeHexColor("invalid", DEFAULT_CUSTOM_PALETTE_HEX), DEFAULT_CUSTOM_PALETTE_HEX);
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
      assert.match(document.querySelector("link[rel*='icon']").href, /^data:image\/svg\+xml/);
      assert.equal(appliedStyle.get("--accent").startsWith("#"), true);
      assert.equal(appliedStyle.has("--bg"), true);
    } finally {
      globalThis.localStorage = previousLocalStorage;
      globalThis.document = previousDocument;
    }
  });

  await test("custom palette live updates can skip modal rerender while dragging picker", () => {
    const previousDocument = globalThis.document;
    const previousLocalStorage = globalThis.localStorage;
    const appliedStyle = new Map();
    const previewStyle = new Map();
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
    const preview = {
      style: {
        setProperty(name, value) {
          previewStyle.set(name, value);
        }
      }
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
          if (selector === ".palette-option__color-preview") {
            return [preview];
          }
          return [];
        }
      }
    };

    try {
      globalThis.localStorage = {
        setItem() {}
      };
      globalThis.document = {
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
      assert.equal(previewStyle.get("--palette-custom-preview"), "#4A90E2");
      assert.equal(appliedStyle.has("--accent"), true);
    } finally {
      globalThis.document = previousDocument;
      globalThis.localStorage = previousLocalStorage;
    }
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
      users: [
        { id: "u1", name: "Coco Mora", online: true }
      ]
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
    assert.equal(state.feedback.message, "Coco Mora seleccionado");
    assert.equal(renderCount, 2);
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
    paletteOptionGrid.querySelector = (selector) => (
      selector === "[data-custom-palette-picker]" ? pickerInput : null
    );

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
    const customIcon = decodeURIComponent(getFaviconDataUrl("light", CUSTOM_PALETTE_ID, "#4A90E2").split(",")[1]);
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
      assert.match(storage.get("topykly-session-id"), /^session-/);
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
      closePaletteModalButton: new FakeElement(),
      paletteModalBackdrop: new FakeElement(),
      paletteOptionGrid: new FakeElement(),
      createTopicButton: new FakeElement(),
      friendRequestsButton: new FakeElement(),
      notificationsButton: new FakeElement(),
      messagesButton: new FakeElement(),
      authButton,
      authTools
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

      assert.equal(authTools.hidden, false);
      assert.equal(dom.profileButton.hidden, false);
      assert.equal(dom.storeButton.hidden, false);
      assert.equal(dom.openRightDrawer.hidden, false);
      assert.equal(authButton.label.textContent, "Cerrar sesión");
      assert.equal(loginCalls, 1);
      assert.equal(state.viewer.type, "registered");
      assert.equal(globalThis.document.documentElement.dataset.authState, "logged-in");
      assert.equal(flashCalls.at(-1), "Sesion iniciada");

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
      assert.equal(flashCalls.at(-1), "Sesion cerrada");
    } finally {
      globalThis.localStorage = previousLocalStorage;
      globalThis.document = previousDocument;
      globalThis.Element = previousElement;
      globalThis.HTMLElement = previousHTMLElement;
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
    const menuButtons = [menuProfileButton, homeButton, paletteTarget, usersPanelButton, rankingPanelButton, menuAuthButton];
    mobileTopbarMenu.querySelector = (selector) => (
      selector === "#mobileDrawerSearch" ? searchInput : null
    );
    mobileTopbarMenu.querySelectorAll = (selector) => (
      selector === "[data-mobile-drawer-panel]" ? [usersPanelButton, rankingPanelButton]
        : selector === "[data-auth-private]" ? [menuProfileButton, menuAuthButton]
          : selector === ".drawer-action-button" ? menuButtons
            : []
    );
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
      messagesButton: new FakeElement(),
      authButton,
      authTools
    };

    try {
      globalThis.Element = FakeElement;
      globalThis.HTMLElement = FakeElement;
      globalThis.window = {
        addEventListener() {},
        matchMedia() {
          return { matches: true };
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

      assert.equal(authTools.hidden, false);
      assert.equal(dom.profileButton.hidden, false);
      assert.equal(dom.storeButton.hidden, false);
      assert.equal(dom.openRightDrawer.hidden, false);
      assert.equal(menuProfileButton.hidden, false);
      assert.equal(menuAuthButton.hidden, false);
      assert.equal(loginCalls, 1);
      assert.equal(globalThis.document.documentElement.dataset.authState, "logged-in");
      assert.equal(flashCalls.at(-1), "Sesion iniciada");
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
    const flashCalls = [];
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

      bindTopbarActionEvents({
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
        messagesButton: new FakeElement(),
        authButton,
        authTools: new FakeElement()
      }, {
        toggleTheme() {},
        refreshCurrentTopic() {},
        submitMessage() {},
        flashTitle(message) {
          flashCalls.push(message);
        },
        state,
        async login() {
          return { redirected: true };
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
      });

      authButton.dispatch("click");
      await flushAsyncEvents();

      assert.deepEqual(flashCalls, []);
      assert.equal(state.viewer.type, "guest");
      assert.equal(globalThis.document.documentElement.dataset.authState, "logged-out");
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
    const titles = await read("ui/titles.js");
    const topics = await read("ui/topics.js");
    const users = await read("ui/users.js");
    const renderUtils = await read("ui/render-utils.js");
    const previewServer = await read("services/preview-server.js");
    const drawers = await read("ui/drawers.js");
    const topbar = await read("ui/topbar.js");
    const topbarActionEvents = await read("ui/topbar-action-events.js");

    assert.match(html, /<title>TOPYKLY<\/title>/);
    assert.match(html, /class="topbar__title" aria-label="TOPYKLY"/);
    assert.match(html, /class="brand-mark__che">TOPY<\/span>/);
    assert.match(html, /class="brand-mark__trend">KLY<\/span>/);
    assert.match(html, /id="topicList"/);
    assert.match(html, /id="createTopicButton"/);
    assert.match(html, /id="topicTitleInput"/);
    assert.match(html, /id="chatTitle"/);
    assert.match(html, /class="panel__header-title"[\s\S]*id="backToTopics"[\s\S]*aria-label="Volver a temas"[\s\S]*id="chatTitle"/);
    assert.match(html, /id="reportTopicButton"/);
    assert.match(html, /icon-button--refresh/);
    assert.match(html, /id="leftDrawerTopics"/);
    assert.match(html, /refresh-button__wheel/);
    assert.match(html, /id="backToTopics"/);
    assert.match(html, /placeholder="Escribe aquí\.\.\."/);
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
    assert.doesNotMatch(html, /[ÚU]ltimos usuarios activos/);
    assert.match(html, /id="paletteModalBackdrop"/);
    assert.match(html, /id="paletteModal"/);
    assert.match(html, /id="paletteModal"[\s\S]*aria-label="Selector de paletas"/);
    assert.match(html, /class="palette-modal__body"/);
    assert.match(html, /id="paletteOptionGrid"/);
    assert.doesNotMatch(html, /id="paletteModalTitle"/);
    assert.match(html, /cdn\.jsdelivr\.net\/gh\/mdbassit\/Coloris@latest\/dist\/coloris\.min\.css/);
    assert.match(html, /cdn\.jsdelivr\.net\/gh\/mdbassit\/Coloris@latest\/dist\/coloris\.min\.js/);
    assert.match(html, /localStorage\.getItem\("topykly-theme"\) \|\| localStorage\.getItem\("chetrend-theme"\) \|\| "dark"/);
    assert.match(html, /localStorage\.getItem\("topykly-palette"\) \|\| localStorage\.getItem\("chetrend-palette"\) \|\| "default"/);
    assert.match(html, /const authState = "logged-out";/);
    assert.match(html, /window\.matchMedia\("\(max-width: 960px\)"\)\.matches/);
    assert.match(html, /document\.documentElement\.dataset\.authState = authState/);
    assert.match(html, /document\.documentElement\.classList\.toggle\("is-mobile-viewport", mobile\)/);
    assert.match(html, /document\.documentElement\.classList\.toggle\("is-desktop-viewport", !mobile\)/);
    assert.match(styles, /html\[data-auth-state="logged-out"\] \[data-auth-private\]\s*\{[\s\S]*display:\s*none !important;/);
    assert.match(html, /id="authTools"[\s\S]*hidden/);
    assert.match(html, /data-auth-private/);
    assert.match(html, /id="mobileTopbarMenu"/);
    assert.match(html, /data-mobile-topbar-action="profile"[\s\S]*class="drawer-action-button__label">Perfil/);
    assert.match(html, /data-mobile-topbar-action="home"[\s\S]*class="drawer-action-button__label">Inicio/);
    assert.match(html, /class="drawer-action-button__icon"/);
    assert.match(html, /id="mobileDrawerSearch"[\s\S]*type="text"/);
    assert.match(html, /id="mobileDrawerPanels" hidden/);
    assert.match(html, /id="themeToggleDesktopSlot"/);
    assert.match(html, /id="themeToggleMobileSlot"/);
    assert.match(html, /id="themeToggleTemplate"/);
    assert.match(html, /id="paletteButton"[\s\S]*id="themeToggleDesktopSlot"/);
    assert.match(html, /id="storeButton"[\s\S]*id="themeToggleMobileSlot"/);
    assert.match(html, /id="profileButton"[\s\S]*class="profile-button__avatar"/);
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
    assert.doesNotMatch(html, /data-mobile-topbar-action="store"/);
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
    assert.doesNotMatch(html, /createTopicForm|mobileCreateTopicForm|Nuevo tema|Ordenados por presencia/);
    assert.match(data, /"Café de madrugada"/);
    assert.match(data, /"Moderación"/);
    assert.match(styles, /\.topic-item__title,\s*\.topic-item__meta\s*\{[\s\S]*text-overflow:\s*ellipsis;/);
    assert.match(styles, /\.topic-item\s*\{[\s\S]*width:\s*100%;[\s\S]*min-width:\s*0;/);
    assert.match(styles, /\.workspace\s*\{[\s\S]*grid-template-columns:\s*minmax\(275px,\s*1fr\)\s*minmax\(0,\s*1\.78fr\)\s*minmax\(275px,\s*1fr\);/);
    assert.match(styles, /\.topbar__auth-tools\[hidden\]\s*\{[\s\S]*display:\s*none;/);
    assert.match(styles, /html\.is-desktop-viewport \.panel--topics \.topic-item__title\s*\{[\s\S]*font-size:\s*0\.98rem;/);
    assert.match(styles, /\.brand-mark__icon\s*\{[\s\S]*color:\s*var\(--accent\);/);
    assert.match(styles, /\.brand-mark__icon-base\s*\{[\s\S]*fill:\s*currentColor;/);
    assert.match(styles, /\.brand-mark__icon-stroke\s*\{[\s\S]*stroke:\s*var\(--button-fill-text\);/);
    assert.match(styles, /:root\s*\{[\s\S]*--ranking-badge-border:\s*color-mix\(in srgb,\s*#f2b97a 62%,\s*var\(--line\)\);/);
    assert.match(styles, /:root\s*\{[\s\S]*--button-fill-bg:\s*var\(--accent-strong\);/);
    assert.match(styles, /html\[data-theme="light"\]\[data-palette="coast"\]\s*\{/);
    assert.match(styles, /html\[data-theme="light"\]\[data-palette="coast"\]\s*\{[\s\S]*--surface:\s*rgba\(205,\s*228,\s*232,\s*0\.86\);[\s\S]*--surface-strong:\s*rgba\(197,\s*221,\s*226,\s*0\.95\);/);
    assert.match(styles, /\.panel__header-title\s*\{[\s\S]*display:\s*flex;[\s\S]*align-items:\s*center;[\s\S]*gap:\s*10px;[\s\S]*min-width:\s*0;/);
    assert.match(styles, /\.chat-header__back\s*\{[\s\S]*display:\s*none;[\s\S]*flex:\s*none;/);
    assert.match(styles, /\.palette-modal-backdrop\s*\{[\s\S]*position:\s*fixed;[\s\S]*z-index:\s*40;/);
    assert.match(styles, /\.palette-modal__header\s*\{[\s\S]*justify-content:\s*flex-end;/);
    assert.match(styles, /\.palette-modal\s*\{[\s\S]*position:\s*relative;[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);[\s\S]*overflow:\s*hidden;/);
    assert.match(styles, /\.palette-modal__body\s*\{[\s\S]*overflow:\s*auto;[\s\S]*padding-right:\s*4px;/);
    assert.match(styles, /\.palette-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
    assert.match(styles, /\.palette-grid__featured\s*\{[\s\S]*grid-column:\s*1 \/ -1;[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
    assert.match(styles, /\.palette-option\s*\{[\s\S]*padding:\s*12px;[\s\S]*border-radius:\s*14px;[\s\S]*transition:\s*[\s\S]*border-color 180ms ease,[\s\S]*background-color 180ms ease,[\s\S]*box-shadow 180ms ease;/);
    assert.match(styles, /\.palette-option:hover,\s*\.palette-option:focus-visible\s*\{[\s\S]*border-color:\s*color-mix\(in srgb,\s*var\(--accent\) 72%,\s*var\(--line\)\);[\s\S]*box-shadow:/);
    assert.doesNotMatch(styles, /\.palette-option:hover,\s*\.palette-option:focus-visible\s*\{[^}]*transform:/);
    assert.match(styles, /\.palette-option\.is-active\s*\{[\s\S]*border-color:\s*color-mix\(in srgb,\s*var\(--accent-strong\) 88%,\s*var\(--line\)\);[\s\S]*box-shadow:/);
    assert.match(styles, /\.palette-option--action\s*\{[\s\S]*place-content:\s*center;/);
    assert.match(styles, /\.palette-option__controls\s*\{[\s\S]*grid-template-columns:\s*44px minmax\(0,\s*1fr\);/);
    assert.match(styles, /\.palette-option--custom \.palette-option__modes\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
    assert.match(styles, /\.palette-option__sample-layout\s*\{[\s\S]*grid-template-columns:\s*0\.85fr 1\.2fr 0\.9fr;/);
    assert.match(styles, /\.palette-option__sample-bubble--accent\s*\{/);
    assert.match(styles, /\.palette-option__color-preview\s*\{/);
    assert.match(styles, /\.palette-option__color-preview:hover,\s*\.palette-option__color-preview:focus-visible,\s*\.palette-option__color-preview:focus-within\s*\{[\s\S]*box-shadow:/);
    assert.match(styles, /\.palette-option__color-swatch\s*\{[\s\S]*var\(--palette-custom-preview\)/);
    assert.match(styles, /\.palette-option__color-picker-input\s*\{[\s\S]*position:\s*absolute;[\s\S]*opacity:\s*0;/);
    assert.match(styles, /\.clr-clear\s*\{[\s\S]*display:\s*none !important;/);
    assert.match(styles, /\.clr-picker\s*\{[\s\S]*grid-template-areas:\s*[\s\S]*"actions actions";/);
    assert.match(styles, /\.palette-picker__actions\s*\{[\s\S]*grid-template-columns:\s*1fr;[\s\S]*align-items:\s*stretch;/);
    assert.match(styles, /\.palette-picker__dismiss-button,\s*\.palette-picker__actions \.clr-close\s*\{[\s\S]*min-height:\s*40px;/);
    assert.match(styles, /\.palette-picker__actions \.clr-close\s*\{[\s\S]*background:\s*var\(--button-fill-bg\);/);
    assert.match(styles, /\.palette-option__hex-label\s*\{/);
    assert.match(styles, /\.palette-option__hex-input\s*\{[\s\S]*text-transform:\s*uppercase;/);
    assert.match(styles, /\.palette-option__sample-surface\s*\{[\s\S]*min-height:\s*68px;/);
    assert.match(styles, /--palette-modal-scrollbar-thumb:\s*color-mix\(in srgb,\s*var\(--accent\) 74%,\s*var\(--bg\) 26%\);/);
    assert.match(styles, /\.palette-modal__body::-webkit-scrollbar-thumb\s*\{[\s\S]*background:\s*var\(--palette-modal-scrollbar-thumb\);/);
    assert.match(styles, /html\[data-custom-picker-open="false"\] \.clr-picker\s*\{[\s\S]*display:\s*none !important;/);
    assert.match(styles, /html\[data-theme="dark"\]\s*\{[\s\S]*--ranking-badge-border:\s*color-mix\(in srgb,\s*#f2b97a 62%,\s*var\(--line\)\);/);
    assert.match(styles, /html:not\(\[data-theme="dark"\]\) #profileButton,\s*[\s\S]*#themeToggle,\s*[\s\S]*#paletteButton,\s*[\s\S]*#contactAdminButton\s*\{[\s\S]*color:\s*#000;/);
    assert.match(styles, /#profileButton\s*\{[\s\S]*min-height:\s*44px;[\s\S]*padding:\s*0 14px 0 0;[\s\S]*gap:\s*0;[\s\S]*border-radius:\s*0;/);
    assert.match(styles, /html:not\(\[data-theme="dark"\]\) #profileButton \.button-label,\s*[\s\S]*#paletteButton \.theme-toggle__label,\s*[\s\S]*#contactAdminButton \.button-label\s*\{[\s\S]*color:\s*#000;/);
    assert.match(styles, /\.profile-button__avatar\s*\{[\s\S]*width:\s*42px;[\s\S]*height:\s*42px;[\s\S]*margin:\s*0 0 0 -1px;[\s\S]*border-right:\s*1px solid[\s\S]*border-radius:\s*0;[\s\S]*background:\s*linear-gradient/);
    assert.match(styles, /\.topic-item__avatar\s*\{[\s\S]*width:\s*84px;[\s\S]*height:\s*84px;[\s\S]*align-self:\s*center;[\s\S]*border-top:\s*1px solid[\s\S]*border-left:\s*1px solid[\s\S]*border-bottom:\s*1px solid[\s\S]*border-right:\s*1px solid/);
    assert.match(styles, /html\.is-desktop-viewport \.panel--topics \.topic-item__avatar\s*\{[\s\S]*width:\s*76px;[\s\S]*height:\s*76px;/);
    assert.match(styles, /#authButton \.button-label\s*\{[\s\S]*font-weight:\s*950;[\s\S]*letter-spacing:\s*0\.01em;/);
    assert.match(styles, /\.theme-toggle-slot\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*align-items:\s*center;[\s\S]*flex:\s*none;/);
    assert.match(styles, /\.theme-toggle-slot:empty\s*\{[\s\S]*display:\s*none;/);
    assert.match(styles, /\.theme-switch\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*width:\s*78px;[\s\S]*height:\s*44px;[\s\S]*min-height:\s*44px;[\s\S]*padding:\s*3px;[\s\S]*border-radius:\s*999px;/);
    assert.match(styles, /#themeToggleDesktopSlot \.theme-switch\s*\{[\s\S]*border:\s*1px solid var\(--button-ghost-border\);[\s\S]*background:\s*var\(--button-ghost-bg\);/);
    assert.match(styles, /#themeToggleDesktopSlot \.theme-switch:hover,\s*#themeToggleDesktopSlot \.theme-switch:active\s*\{[\s\S]*background:\s*var\(--button-ghost-bg-hover\);[\s\S]*border-color:\s*var\(--button-ghost-border\);/);
    assert.match(styles, /#themeToggleDesktopSlot \.theme-switch:focus-visible,\s*#themeToggleMobileSlot \.theme-switch:focus-visible\s*\{[\s\S]*outline:\s*2px solid color-mix/);
    assert.match(styles, /\.message\s*\{[\s\S]*position:\s*relative;[\s\S]*padding:\s*0 0 0 84px;[\s\S]*min-height:\s*84px;[\s\S]*border-radius:\s*0;/);
    assert.match(styles, /\.message \+ \.message::before\s*\{[\s\S]*top:\s*0;[\s\S]*left:\s*0;[\s\S]*right:\s*0;[\s\S]*height:\s*1px;/);
    assert.match(styles, /\.message \+ \.message \.message__avatar\s*\{[\s\S]*border-top:\s*1px solid/);
    assert.match(styles, /\.message__avatar\s*\{[\s\S]*position:\s*absolute;[\s\S]*top:\s*0;[\s\S]*left:\s*0;[\s\S]*width:\s*84px;[\s\S]*height:\s*84px;[\s\S]*border-right:\s*1px solid/);
    assert.match(styles, /\.message__body\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*padding:\s*14px;/);
    assert.match(styles, /\.message__meta\s*\{[\s\S]*justify-content:\s*space-between;/);
    assert.match(styles, /\.message__time\s*\{[\s\S]*margin-left:\s*auto;/);
    assert.match(styles, /\.panel__title-inline--ranking\s*\{[\s\S]*justify-content:\s*center;/);
    assert.match(styles, /\.rankings-section\.is-ranking-scrollable \.ranking-list,\s*[\s\S]*overflow:\s*auto;/);
    assert.match(styles, /\.rankings-section\.is-ranking-scrollable \.ranking-list,\s*[\s\S]*height:\s*100%;/);
    assert.match(styles, /\.rankings-section\.is-ranking-scrollable \.ranking-list,\s*[\s\S]*max-height:\s*100%;/);
    assert.match(styles, /\.rankings-section\.is-ranking-scrollable \.ranking-item,\s*[\s\S]*min-height:\s*var\(--ranking-skeleton-item-height,\s*34px\);/);
    assert.match(styles, /\.ranking-content,\s*\.drawer-ranking-content\s*\{[\s\S]*position:\s*relative;[\s\S]*overflow:\s*hidden;[\s\S]*--ranking-bottom-mask:\s*0px;/);
    assert.match(styles, /\.ranking-content::after,\s*\.drawer-ranking-content::after\s*\{[\s\S]*height:\s*var\(--ranking-bottom-mask\);/);
    assert.doesNotMatch(styles, /\.panel__body--drawer-rankings\.is-topic-selected \.ranking-item--rank-1 \.ranking-item__badge--topic/);
    assert.doesNotMatch(styles, /\.panel__body--drawer-rankings\.is-topic-selected \.ranking-item--rank-2 \.ranking-item__badge--topic/);
    assert.doesNotMatch(styles, /\.panel__body--drawer-rankings\.is-topic-selected \.ranking-item--rank-3 \.ranking-item__badge--topic/);
    assert.match(styles, /\.ranking-item__badge\s*\{[\s\S]*border:\s*1px solid var\(--ranking-badge-border\);/);
    assert.doesNotMatch(styles, /\.ranking-item--global\.ranking-item--rank-1 \.ranking-item__badge\s*\{/);
    assert.doesNotMatch(styles, /\.ranking-item--global\.ranking-item--rank-2 \.ranking-item__badge\s*\{/);
    assert.doesNotMatch(styles, /\.ranking-item--global\.ranking-item--rank-3 \.ranking-item__badge\s*\{/);
    assert.match(styles, /\.panel__body--drawer-rankings\s*\{[\s\S]*grid-template-rows:\s*auto auto minmax\(0,\s*1fr\);/);
    assert.match(styles, /\.ranking-scope-tabs\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\);[\s\S]*border-radius:\s*0;/);
    assert.match(styles, /\.ranking-carousel\s*\{[\s\S]*grid-template-columns:\s*44px minmax\(0,\s*1fr\) 44px;[\s\S]*gap:\s*0;[\s\S]*padding:\s*0;[\s\S]*border-radius:\s*0;/);
    assert.match(styles, /\.ranking-carousel__nav:hover,\s*\.ranking-carousel__nav:focus-visible\s*\{[\s\S]*background:\s*color-mix\(in srgb,\s*var\(--accent-soft\) 26%,\s*transparent\);[\s\S]*transform:\s*none;/);
    assert.match(styles, /\.ranking-carousel__nav:active\s*\{[\s\S]*background:\s*color-mix\(in srgb,\s*var\(--accent-soft\) 38%,\s*transparent\);/);
    assert.match(styles, /html:not\(\[data-theme="dark"\]\) \.ranking-carousel__nav:hover,\s*html:not\(\[data-theme="dark"\]\) \.ranking-carousel__nav:focus-visible\s*\{[\s\S]*background:\s*var\(--button-fill-bg\);/);
    assert.match(styles, /html:not\(\[data-theme="dark"\]\) \.ranking-carousel__nav:active\s*\{[\s\S]*background:\s*var\(--button-fill-bg-hover\);/);
    assert.match(styles, /html\[data-theme="dark"\] \.ranking-carousel__nav:hover,\s*html\[data-theme="dark"\] \.ranking-carousel__nav:focus-visible\s*\{[\s\S]*background:\s*var\(--button-fill-bg\);/);
    assert.match(styles, /html\[data-theme="dark"\] \.ranking-carousel__nav:active\s*\{[\s\S]*background:\s*var\(--button-fill-bg-hover\);/);
    assert.match(styles, /\.ranking-carousel__current:hover,\s*\.ranking-carousel__current:focus-visible\s*\{[\s\S]*transform:\s*none;/);
    assert.match(styles, /\.ranking-scope-tabs__button\s*\{[\s\S]*text-transform:\s*uppercase;/);
    assert.match(styles, /html\[data-theme="light"\]\[data-palette="default"\] \.ranking-scope-tabs\s*\{[\s\S]*background:\s*#fff;[\s\S]*border-color:\s*color-mix\(in srgb,\s*var\(--accent\) 56%,\s*var\(--line\)\);/);
    assert.match(styles, /html\[data-theme="light"\]\[data-palette="default"\] \.ranking-scope-tabs__button\.is-active[\s\S]*box-shadow:\s*inset 0 -2px 0 var\(--accent\);/);
    assert.match(styles, /html\[data-theme="light"\]:not\(\[data-palette="default"\]\) \.ranking-scope-tabs\s*\{[\s\S]*background:\s*color-mix\(in srgb,\s*var\(--surface-strong\) 92%,\s*var\(--accent-soft\) 8%\);/);
    assert.match(styles, /html\[data-theme="light"\]:not\(\[data-palette="default"\]\) \.ranking-scope-tabs__button\.is-active[\s\S]*background:\s*color-mix\(in srgb,\s*var\(--surface-strong\) 74%,\s*var\(--accent-soft\) 26%\);/);
    assert.match(styles, /html:not\(\[data-theme="dark"\]\) \.ranking-label__main\s*\{[\s\S]*color:\s*var\(--text\);/);
    assert.match(styles, /html\[data-theme="dark"\] #rankingCurrent,\s*[\s\S]*background:\s*var\(--button-fill-bg\);[\s\S]*color:\s*var\(--button-fill-text\);/);
    assert.match(styles, /html\.is-mobile-viewport #storeButton\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*gap:\s*0;[\s\S]*width:\s*44px;[\s\S]*min-width:\s*44px;[\s\S]*height:\s*44px;[\s\S]*min-height:\s*44px;[\s\S]*padding-block:\s*0;[\s\S]*padding-inline:\s*0;[\s\S]*border-radius:\s*999px;[\s\S]*flex:\s*none;/);
    assert.match(styles, /html\.is-mobile-viewport #authButton \.button-label\s*\{[\s\S]*display:\s*inline;/);
    assert.match(styles, /html\.is-mobile-viewport #storeButton \.button-label\s*\{[\s\S]*display:\s*none;/);
    assert.match(styles, /html\.is-mobile-viewport #authButton\s*\{[\s\S]*min-width:\s*0;[\s\S]*height:\s*44px;[\s\S]*min-height:\s*44px;[\s\S]*padding-block:\s*0;[\s\S]*padding-inline:\s*10px;[\s\S]*align-items:\s*center;[\s\S]*font-size:\s*0\.78rem;[\s\S]*letter-spacing:\s*0;/);
    assert.match(styles, /html\.is-mobile-viewport #authButton \.button-label\s*\{[\s\S]*font-weight:\s*900;[\s\S]*letter-spacing:\s*0;[\s\S]*-webkit-text-stroke:\s*0\.2px currentColor;/);
    assert.match(styles, /#themeToggleMobileSlot \.theme-switch\s*\{[\s\S]*border:\s*2px solid color-mix\(in srgb,\s*var\(--accent\) 58%,\s*var\(--line\)\);[\s\S]*background:\s*color-mix\(in srgb,\s*var\(--surface-strong\) 78%,\s*var\(--accent-soft\) 22%\);/);
    assert.match(styles, /#themeToggleMobileSlot \.theme-switch:hover,\s*#themeToggleMobileSlot \.theme-switch:focus-visible,\s*#themeToggleMobileSlot \.theme-switch:active\s*\{[\s\S]*background:\s*color-mix\(in srgb,\s*var\(--surface-strong\) 78%,\s*var\(--accent-soft\) 22%\);[\s\S]*border-color:\s*color-mix\(in srgb,\s*var\(--accent\) 58%,\s*var\(--line\)\);/);
    assert.match(styles, /\.theme-switch__track\s*\{[\s\S]*position:\s*relative;[\s\S]*width:\s*100%;[\s\S]*height:\s*100%;[\s\S]*border-radius:\s*999px;[\s\S]*background:\s*color-mix\(in srgb,\s*var\(--surface-strong\) 88%,\s*var\(--accent-soft\) 12%\);[\s\S]*overflow:\s*hidden;/);
    assert.match(styles, /\.theme-switch__icons\s*\{[\s\S]*display:\s*block;[\s\S]*pointer-events:\s*none;/);
    assert.match(styles, /\.theme-switch__icon\s*\{[\s\S]*position:\s*absolute;[\s\S]*top:\s*50%;[\s\S]*width:\s*14px;[\s\S]*height:\s*14px;[\s\S]*opacity:\s*0\.96;[\s\S]*transform:\s*translateY\(-50%\);[\s\S]*z-index:\s*2;/);
    assert.match(styles, /\.theme-switch__icon--light\s*\{[\s\S]*left:\s*10px;/);
    assert.match(styles, /\.theme-switch__icon--dark\s*\{[\s\S]*right:\s*10\.6px;/);
    assert.match(styles, /\.theme-switch__icon--dark svg\s*\{[\s\S]*transform:\s*translateY\(-0\.35px\);/);
    assert.match(styles, /\.theme-switch__thumb\s*\{[\s\S]*left:\s*0;[\s\S]*width:\s*34px;[\s\S]*height:\s*34px;[\s\S]*background:\s*var\(--surface-strong\);[\s\S]*transform:\s*translate\(34px,\s*-50%\);[\s\S]*z-index:\s*1;/);
    assert.match(styles, /html\[data-theme="light"\] \.theme-switch__thumb\s*\{[\s\S]*transform:\s*translate\(0,\s*-50%\);/);
    assert.match(styles, /html\.is-mobile-viewport \.topbar\s*\{[\s\S]*grid-template-columns:\s*38px minmax\(0,\s*1fr\) auto;/);
    assert.match(styles, /html\.is-mobile-viewport \.topbar__group--right\s*\{[\s\S]*grid-column:\s*3;[\s\S]*justify-content:\s*flex-end;/);
    assert.match(styles, /html\.is-mobile-viewport \.topbar__title\s*\{[\s\S]*grid-column:\s*2;[\s\S]*display:\s*inline-flex;[\s\S]*max-width:\s*100%;/);
    assert.match(styles, /html\.is-mobile-viewport \.panel__header--chat\s*\{[\s\S]*gap:\s*10px;/);
    assert.match(styles, /html\.is-mobile-viewport \.panel__header--chat \.chat-header__back\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*width:\s*40px;[\s\S]*height:\s*40px;[\s\S]*min-width:\s*40px;[\s\S]*min-height:\s*40px;/);
    assert.match(styles, /html\.is-mobile-viewport \.brand-mark\s*\{[\s\S]*justify-items:\s*start;[\s\S]*text-align:\s*left;/);
    assert.match(styles, /html\.is-mobile-viewport \.drawer-action-stack\s*\{[\s\S]*flex-direction:\s*column;/);
    assert.match(styles, /html\.is-mobile-viewport \.drawer__header\s*\{[\s\S]*position:\s*relative;/);
    assert.match(styles, /html\.is-mobile-viewport \.drawer__header \[data-close-drawer="right"\]\s*\{[\s\S]*background:\s*var\(--button-fill-bg\);[\s\S]*border-color:\s*var\(--button-fill-border\);[\s\S]*color:\s*var\(--button-fill-text\);/);
    assert.match(styles, /html\.is-mobile-viewport \.drawer__header \[data-close-drawer="right"\] > span\s*\{[\s\S]*display:\s*grid;[\s\S]*place-items:\s*center;[\s\S]*transform:\s*translateY\(-0\.5px\);/);
    assert.match(styles, /html\.is-mobile-viewport \.drawer__header \[data-close-drawer="right"\]:hover,\s*html\.is-mobile-viewport \.drawer__header \[data-close-drawer="right"\]:focus-visible\s*\{[\s\S]*background:\s*color-mix\(in srgb,\s*#c63834 62%,\s*var\(--accent-strong\) 38%\);[\s\S]*transform:\s*none;/);
    assert.match(styles, /html\.is-mobile-viewport \.drawer-action-button\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*20px minmax\(0,\s*1fr\) 20px;[\s\S]*gap:\s*12px;/);
    assert.match(styles, /html\.is-mobile-viewport \.drawer-action-button__icon\s*\{[\s\S]*width:\s*20px;[\s\S]*height:\s*20px;/);
    assert.match(styles, /html\.is-mobile-viewport \.drawer-action-button__label\s*\{[\s\S]*text-align:\s*center;/);
    assert.match(styles, /html\.is-mobile-viewport \.drawer-search__field\s*\{[\s\S]*position:\s*relative;[\s\S]*display:\s*block;[\s\S]*min-height:\s*52px;[\s\S]*overflow:\s*hidden;[\s\S]*border-radius:\s*0;/);
    assert.match(styles, /html\.is-mobile-viewport \.drawer-search__input\s*\{[\s\S]*display:\s*block;[\s\S]*width:\s*100%;[\s\S]*height:\s*100%;[\s\S]*min-height:\s*52px;[\s\S]*border:\s*0 !important;[\s\S]*border-radius:\s*0 !important;[\s\S]*padding:\s*0 14px 0 46px;[\s\S]*box-shadow:\s*none !important;/);
    assert.match(styles, /html\.is-mobile-viewport \.drawer-action-button\.is-search-hidden\s*\{[\s\S]*display:\s*none;/);
    assert.match(styles, /html\.is-mobile-viewport \.drawer-mobile-panel__back\s*\{/);
    assert.match(styles, /html\.is-mobile-viewport \.drawer-action-button--auth\s*\{[\s\S]*margin-top:\s*10px;[\s\S]*color:\s*var\(--button-fill-text\);/);
    assert.match(styles, /html\.is-mobile-viewport \.drawer-action-button--auth \.drawer-action-button__icon\s*\{[\s\S]*color:\s*var\(--button-fill-text\);/);
    assert.match(styles, /html\.is-mobile-viewport \.drawer-action-button--auth:hover,\s*html\.is-mobile-viewport \.drawer-action-button--auth:focus-visible\s*\{/);
    assert.match(styles, /html\.is-mobile-viewport \.mobile-right-drawer\s*\{[\s\S]*align-items:\s*center;[\s\S]*justify-content:\s*center;[\s\S]*border:\s*0;[\s\S]*background:\s*transparent;[\s\S]*box-shadow:\s*none;[\s\S]*position:\s*absolute;[\s\S]*left:\s*12px;[\s\S]*top:\s*50%;[\s\S]*transform:\s*translateY\(-50%\);/);
    assert.match(styles, /html\.is-mobile-viewport \.mobile-right-drawer:hover,\s*html\.is-mobile-viewport \.mobile-right-drawer:focus-visible,\s*html\.is-mobile-viewport \.mobile-right-drawer:active\s*\{[\s\S]*background:\s*transparent;[\s\S]*transform:\s*translateY\(-50%\);/);
    assert.match(styles, /html\.is-mobile-viewport \.mobile-right-drawer \.icon-button__icon\s*\{[\s\S]*width:\s*2\.1rem;[\s\S]*height:\s*2\.1rem;/);
    assert.match(styles, /html\.is-mobile-viewport \.mobile-right-drawer \.icon-button__icon svg\s*\{[\s\S]*width:\s*2\.1rem;[\s\S]*height:\s*2\.1rem;[\s\S]*stroke-width:\s*2\.6;/);
    assert.match(styles, /html\.is-mobile-viewport \.drawer-mobile-panels\[hidden\],\s*[\s\S]*display:\s*none;/);
    assert.match(styles, /html\.is-mobile-viewport \.drawer\s*\{[\s\S]*width:\s*min\(84vw,\s*360px\);[\s\S]*max-width:\s*calc\(100vw - 52px\);/);
    assert.match(styles, /html\.is-mobile-viewport \.drawer--right\s*\{[\s\S]*grid-template-rows:\s*auto auto minmax\(0,\s*1fr\);/);
    assert.match(styles, /html\.is-mobile-viewport \.drawer-mobile-panel__header,\s*html\.is-mobile-viewport \.drawer-ranking__header\s*\{[\s\S]*grid-template-columns:\s*40px minmax\(0,\s*1fr\) 40px;[\s\S]*gap:\s*12px;[\s\S]*margin-bottom:\s*12px;/);
    assert.match(styles, /html\.is-mobile-viewport \.drawer-mobile-panel__header::after,\s*html\.is-mobile-viewport \.drawer-ranking__header::after\s*\{[\s\S]*grid-column:\s*3;[\s\S]*width:\s*40px;[\s\S]*height:\s*40px;/);
    assert.match(styles, /html\.is-mobile-viewport \.drawer-mobile-panel__header h3,\s*html\.is-mobile-viewport \.drawer-ranking__header h3\s*\{[\s\S]*justify-content:\s*center;[\s\S]*text-align:\s*center;/);
    assert.match(styles, /html\.is-mobile-viewport #drawerUsersSection \.drawer-mobile-panel__header\s*\{[\s\S]*padding-inline:\s*14px;/);
    assert.match(styles, /html\.is-mobile-viewport #drawerRankingsSection \.drawer-ranking__header\s*\{[\s\S]*padding-inline:\s*16px;/);
    assert.match(styles, /html\.is-mobile-viewport #drawerUsersSection \.drawer-mobile-panel__header h3::before,\s*html\.is-mobile-viewport #drawerUsersSection \.drawer-mobile-panel__header h3::after,\s*html\.is-mobile-viewport \.drawer--right \.drawer-ranking__header h3::before,\s*html\.is-mobile-viewport \.drawer--right \.drawer-ranking__header h3::after\s*\{[\s\S]*content:\s*none;[\s\S]*display:\s*none;/);
    assert.match(styles, /html\.is-mobile-viewport \.drawer-ranking__header \.panel__title-inline\s*\{[\s\S]*position:\s*static;[\s\S]*width:\s*100% !important;[\s\S]*justify-content:\s*center;[\s\S]*padding-inline:\s*0;/);
    assert.match(styles, /html\.is-mobile-viewport \.drawer--right\s*\{[\s\S]*left:\s*0;[\s\S]*right:\s*auto;[\s\S]*transform:\s*translateX\(-100%\);/);
    assert.match(styles, /html\.is-mobile-viewport \.drawer-backdrop\s*\{[\s\S]*background:\s*rgba\(6,\s*10,\s*16,\s*0\.46\);[\s\S]*backdrop-filter:\s*blur\(3px\);/);
    assert.match(styles, /html\.is-mobile-viewport \.drawer__section--half\s*\{[\s\S]*padding:\s*12px 10px 18px;/);
    assert.match(styles, /html\.is-mobile-viewport \.drawer__section--mobile-panel\s*\{[\s\S]*gap:\s*0;/);
    assert.match(styles, /html\.is-mobile-viewport \.drawer__section--mobile-panel \+ \.drawer__section--mobile-panel\s*\{[\s\S]*padding-top:\s*12px;[\s\S]*border-top:\s*0;/);
    assert.match(styles, /html\.is-mobile-viewport \.panel__body--drawer-rankings\s*\{[\s\S]*gap:\s*0;[\s\S]*padding-top:\s*0;/);
    assert.match(styles, /html\.is-mobile-viewport #drawerUserList\s*\{[\s\S]*padding-top:\s*0;/);
    assert.match(styles, /html\.is-mobile-viewport \.panel__body--drawer-rankings \.drawer-ranking-content,\s*[\s\S]*margin-top:\s*12px;/);
    assert.match(styles, /@media \(max-height:\s*720px\)\s*\{[\s\S]*html\.is-desktop-viewport\s*\{[\s\S]*--ranking-row-height:\s*29px;[\s\S]*--ranking-list-gap:\s*7px;[\s\S]*--ranking-list-padding-y:\s*8px;/);
    assert.match(styles, /\.ranking-mode-list__option\s*\{[\s\S]*grid-template-columns:\s*2rem minmax\(0,\s*1fr\);/);
    assert.match(styles, /\.ranking-mode-list__option\.is-active::before\s*\{[\s\S]*width:\s*12px;/);
    assert.match(styles, /\.user-item\[data-connected-user-id\]:hover,\s*\.user-item\[data-connected-user-id\]:focus-within\s*\{/);
    assert.match(styles, /\.user-item\[data-connected-user-id\]:active\s*\{/);
    assert.match(styles, /\.user-item\.is-active\s*\{/);
    assert.match(styles, /\.topic-item\.is-active \.topic-item__avatar\s*\{[\s\S]*border-color:\s*inherit;/);
    assert.match(styles, /\.user-item__trigger\s*\{/);
    assert.match(styles, /\.user-item__trigger:focus-visible,\s*\.user-item__action:focus-visible\s*\{/);
    assert.match(styles, /html\[data-theme="light"\]\.is-desktop-viewport \.panel--topics \.topics-panel__list-frame\s*\{[\s\S]*border:\s*1px solid/);
    assert.match(styles, /html\[data-theme="light"\] \.panel--chat,\s*html\[data-theme="light"\] \.panel--users-rankings\s*\{[\s\S]*border:\s*1px solid[\s\S]*box-shadow:\s*none;[\s\S]*backdrop-filter:\s*none;/);
    assert.match(styles, /html\[data-theme="light"\] \.panel--chat\s*\{[\s\S]*border-top:\s*1px solid[\s\S]*border-top-left-radius:\s*0;[\s\S]*border-top-right-radius:\s*0;[\s\S]*background:\s*var\(--surface-strong\);/);
    assert.match(styles, /html\[data-theme="light"\] \.panel--chat\.panel--topic-create\s*\{[\s\S]*border-top:\s*0;/);
    assert.match(styles, /html\[data-theme="light"\] \.panel--chat \.panel__header\s*\{[\s\S]*border-bottom:\s*1px solid/);
    assert.match(styles, /html\[data-theme="light"\] \.topic-item,\s*html\[data-theme="light"\] \.user-item,\s*html\[data-theme="light"\] \.ranking-item\s*\{[\s\S]*border-color:\s*color-mix/);
    assert.match(styles, /html\[data-theme="light"\] \.ranking-carousel,\s*html\[data-theme="light"\] \.drawer-ranking__switch\s*\{[\s\S]*border-color:\s*color-mix/);
    assert.match(styles, /html\[data-theme="light"\] \.composer\s*\{[\s\S]*border-top:\s*1px solid/);
    assert.match(styles, /input::placeholder,\s*textarea::placeholder\s*\{[\s\S]*color:\s*color-mix\(in srgb,\s*var\(--accent\) 28%,\s*var\(--text-soft\)\);[\s\S]*opacity:\s*1;/);
    assert.match(styles, /html\[data-theme="light"\] \.composer input,\s*html\[data-theme="light"\] \.composer textarea\s*\{[\s\S]*border:\s*1px solid color-mix/);
    assert.match(styles, /html\[data-theme="light"\] \.composer--topic-create input,\s*html\[data-theme="light"\] \.composer--topic-create textarea\s*\{[\s\S]*border-radius:\s*0;/);
    assert.match(styles, /html\[data-theme="light"\] \.message \+ \.message::before\s*\{[\s\S]*height:\s*1px;/);
    assert.match(styles, /html\[data-theme="light"\] \.rankings-section\s*\{[\s\S]*border-left:\s*0;[\s\S]*border-top:\s*1px solid/);
    assert.match(app, /from "\.\/controller\.js"/);
    assert.match(components, /createProfileAvatar/);
    assert.match(components, /message__avatar/);
    assert.match(components, /message__body/);
    assert.match(components, /message__time/);
    assert.match(components, /message__report-button/);
    assert.match(components, /dataset\.reportEntityType = "message"/);
    assert.match(components, /dataset\.connectedUserId/);
    assert.match(components, /dataset\.userAction/);
    assert.match(components, /user-item__trigger/);
    assert.match(components, /aria-pressed/);
    assert.doesNotMatch(components, /getUserRole|Aviso|Invitado/);
    assert.match(controller, /export \{ bootstrap \} from "\.\/controller-app\.js";/);
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
    assert.match(controllerApp, /from "\.\/ui\/events\.js"/);
    assert.match(controllerApp, /from "\.\/controller-actions\.js"/);
    assert.match(controllerApp, /from "\.\/controller-responsive\.js"/);
    assert.match(controllerApp, /from "\.\/controller-render\.js"/);
    assert.match(controllerApp, /from "\.\/controller-runtime\.js"/);
    assert.match(controllerApp, /renderRef\.current = renderers\.render;[\s\S]*responsive\.syncResponsiveView\(\);[\s\S]*responsive\.updateLayoutMetrics\(\);[\s\S]*renderers\.render\(\);/);
    assert.doesNotMatch(controllerApp, /function cacheDom|function bindEvents|function renderIntoTargets|function getTransitionDurationMs|function bindTopbarEvents|function toggleTheme|function submitMessage/);
    assert.match(actions, /export function createActionHandlers/);
    assert.match(actions, /createNewTopic/);
    assert.match(actions, /openPaletteModal/);
    assert.match(actions, /closePaletteModal/);
    assert.match(actions, /selectPalette/);
    assert.match(actions, /ensureCustomPaletteActive/);
    assert.match(actions, /updateCustomPaletteHex/);
    assert.match(actions, /randomizeCustomPalette/);
    assert.match(actions, /activateConnectedUser/);
    assert.match(actions, /reportEntity/);
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
    assert.match(renderController, /renderPaletteModal/);
    assert.match(chat, /renderChat/);
    assert.match(chat, /panel--topic-create/);
    assert.match(rankings, /renderRankings/);
    assert.match(rankings, /getActiveRankingStep/);
    assert.match(rankings, /syncRankingListHeights/);
    assert.match(rankings, /syncRankingSkeletonHeights/);
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
    assert.doesNotMatch(paletteModal, /palette-option__description/);
    assert.match(titles, /renderTitles/);
    assert.match(topics, /renderTopics/);
    assert.match(users, /renderUsers/);
    assert.match(domModule, /export function cacheDom/);
    assert.match(domModule, /chatTitle/);
    assert.match(domModule, /topicTitleInput/);
    assert.match(domModule, /rankingScopeTabs/);
    assert.doesNotMatch(domModule, /drawerRankingModeList/);
    assert.match(domModule, /themeToggleDesktopSlot/);
    assert.match(domModule, /themeToggleMobileSlot/);
    assert.match(domModule, /mobileTopbarMenu/);
    assert.match(domModule, /mobileDrawerPanels/);
    assert.match(domModule, /drawerUsersSection/);
    assert.match(domModule, /paletteModalBackdrop/);
    assert.match(domModule, /paletteOptionGrid/);
    assert.match(domModule, /assertRequiredDom/);
    assert.match(domModule, /Missing required DOM nodes/);
    assert.match(eventsModule, /export function bindPageEvents/);
    assert.match(eventsModule, /Coloris\.close/);
    assert.match(eventsModule, /messageForm\.addEventListener\("submit", handlers\.submitMessage\)/);
    assert.match(previewServer, /const topicId = segments\[2\] \|\| "";/);
    assert.match(chat, /syncMessageCardHeights\(dom\.messageStream\);/);
    assert.match(chat, /syncTopicReportButton/);
    assert.match(chat, /chatHero\.hidden = true;/);
    assert.doesNotMatch(chat, /if \(shouldSyncChatLayout\(previousRenderState,\s*nextRenderState\)\)\s*\{[\s\S]*syncMessageCardHeights\(dom\.messageStream\);/);
    assert.match(eventsModule, /activateConnectedUser/);
    assert.match(eventsModule, /reportEntity/);
    assert.match(eventsModule, /data-report-entity-type/);
    assert.match(eventsModule, /data-connected-user-id/);
    assert.match(eventsModule, /data-user-action/);
    assert.match(renderUtils, /renderIntoTargets/);
    assert.match(drawers, /getTransitionDurationMs/);
    assert.match(topbar, /bindTopbarEvents/);
    assert.match(topbarActionEvents, /openPaletteModal/);
    assert.match(topbarActionEvents, /closePaletteModal/);
    assert.match(topbarActionEvents, /updateCustomPaletteHex/);
    assert.match(topbarActionEvents, /randomizeCustomPalette/);
    assert.match(topbarActionEvents, /data-open-custom-palette-picker/);
    assert.match(topbarActionEvents, /data-custom-palette-picker/);
    assert.match(topbarActionEvents, /data-custom-palette-card/);
    assert.match(topbarActionEvents, /CUSTOM_PALETTE_ID/);
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
    assert.match(topbarActionEvents, /document\.documentElement\.dataset\.authState = isLoggedIn\(\) \? "logged-in" : "logged-out"/);
    assert.match(topbarActionEvents, /await handlers\.login\?\.\(\)/);
    assert.match(topbarActionEvents, /await handlers\.logout\?\.\(\)/);
    assert.match(topbarActionEvents, /dom\.authTools\.hidden = !loggedIn/);
    assert.match(topbarActionEvents, /setLoggedIn/);
    assert.match(topbarActionEvents, /addListener\(dom\.authButton,\s*"click"/);
    assert.match(topbarActionEvents, /dom\.authButton\.hidden = isMobile && loggedIn/);
    assert.match(topbarActionEvents, /authLabel = loggedIn[\s\S]*"Cerrar sesión"[\s\S]*"Iniciar sesión"/);
    assert.match(topbarActionEvents, /target\.dataset\.mobileTopbarAction === "auth"/);
    assert.match(topbarActionEvents, /void setLoggedIn\(false\)/);
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
    assert.doesNotMatch(stateStore, /\brankingType\b|\brankingMetric\b|\brankingIndex\b/);
    assert.match(domStore, /export const dom/);
    assert.match(timerStore, /export const closeTimerRef/);
    assert.doesNotMatch(app, /createTopicForm|mobileCreateTopicForm/);
  });

  console.log("all tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
