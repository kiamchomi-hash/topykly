import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { createAuthService } from "../services/auth-service.js";
import { getRequestIp, isLocalDevLoginAllowed, shouldTrustProxy } from "../services/preview-server.js";
import { createBackendStore, resolveDbConfig, shouldSeedDemoData } from "../services/backend-store.js";
import { backupSqliteDatabase, resolveBackupConfig } from "../scripts/backup-sqlite.mjs";
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
import { getAuthErrorFeedbackMessage } from "../controller-app.js";
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

    assert.deepEqual(selectUsersViewModel(state).items.map((user) => user.id), ["u-other"]);

    state.viewer.profilePending = false;

    assert.deepEqual(selectUsersViewModel(state).items.map((user) => user.id), ["u-current", "u-other"]);
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

  await test("applyMessageReaction increments the visible message like optimistically", () => {
    const message = createMessage("u1", "Mensaje votable", 0);
    const state = {
      topics: [{
        id: "topic-like",
        title: "Tema con like",
        subtitle: "Mensaje votable",
        authorId: "u1",
        status: "active",
        visible: true,
        messages: [message]
      }]
    };

    const nextState = reducers.applyMessageReaction(state, { messageId: message.id, reactionType: "like" });
    const nextMessage = nextState.topics[0].messages[0];

    assert.equal(nextMessage.likes, 1);
    assert.equal(nextMessage.likedByViewer, true);
    assert.equal(message.likes, 0);
    assert.equal(message.likedByViewer, undefined);
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

  await test("backend can start without demo topics for real users", async () => {
    await withTempStore((store) => {
      const payload = store.bootstrap({ sessionId: "session-empty-demo" });
      assert.equal(payload.topics.length, 0);
      assert.equal(payload.users.length, 0);
      assert.equal(payload.viewer.type, "guest");
    }, { seedDemoData: false });
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

      assert.equal(payload.topics.some((topic) => topic.id === "topic-1"), false);
      assert.equal(payload.users.some((user) => user.id === "u1"), false);
      assert.equal(payload.topics.some((topic) => topic.id === realTopicId), true);
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
      assert.equal(payload.users.some((user) => user.id === payload.viewer.id), false);
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

      assert.throws(() => store.createTopic({
        sessionId: "session-guest-participates",
        authMode: "guest",
        title: "Tema invitado",
        text: "No deberia publicarse."
      }), (error) => error?.code === "LOGIN_REQUIRED");
      assert.throws(() => store.addMessage(topicId, {
        sessionId: "session-guest-participates",
        authMode: "guest",
        text: "Comentario invitado bloqueado"
      }), (error) => error?.code === "LOGIN_REQUIRED");

      const diagnostics = store.getDiagnostics();
      assert.equal(diagnostics.users, initialUsers.length);
      assert.equal(diagnostics.sessions, 0);
    });
  });

  await test("backend lets the first real user create the first topic without seeds", async () => {
    await withTempStore((store) => {
      const registered = store.registerWithPassword({
        sessionId: "session-first-real-user",
        email: "first-real@example.com",
        password: "password-segura",
        nickname: "First_real"
      });
      assert.equal(registered.topics.length, 0);
      assert.equal(registered.users.some((user) => user.nickname === "First_real"), true);

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
    }, { seedDemoData: false });
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
        nowMs: Date.now() + (8 * 24 * 60 * 60_000)
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
        "moderation_actions_target_idx"
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
      storageWarning: "TOPYKLY_DB_PATH no esta configurado; en Render usa un Persistent Disk para no perder datos."
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
        assert.equal(result.backupPath, path.join(backupDir, "topykly-2026-01-02T03-04-05-006Z.sqlite"));
        assert.equal(backupBytes.subarray(0, 15).toString("utf8"), "SQLite format 3");
        assert.equal(backupStore.getDiagnostics().users, initialUsers.length);
      } finally {
        backupStore.close();
      }
    });
  });
  await test("backend registers and logs in password users with nickname", async () => {
    await withTempStore((store) => {
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
      assert.equal(store.refresh({ sessionId: "session-password-register" }).viewer.type, "guest");
      assert.throws(() => store.registerWithPassword({
        sessionId: "session-password-register-duplicate-email",
        email: "clave@example.com",
        password: "password-segura",
        nickname: "otro_user"
      }), (error) => error.code === "EMAIL_TAKEN");
      assert.throws(() => store.registerWithPassword({
        sessionId: "session-password-register-duplicate-nickname",
        email: "otro@example.com",
        password: "password-segura",
        nickname: "CLAVE_USER"
      }), (error) => error.code === "NICKNAME_TAKEN");
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
      assert.throws(() => store.registerWithPassword({
        sessionId: "session-password-register-spaced-name",
        email: "spaced-name@example.com",
        password: "password-segura",
        nickname: "Coco Mora"
      }), (error) => error.code === "VALIDATION_ERROR");
      assert.throws(() => store.loginWithPassword({
        sessionId: "session-password-wrong",
        email: "clave@example.com",
        password: "incorrecta"
      }), (error) => error.code === "INVALID_CREDENTIALS");

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
    }, { seedDemoData: false });
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
      assert.equal(initialPayload.viewer.displayName, "Usuario");
      assert.equal(initialPayload.viewer.avatarUrl, null);
      assert.equal(initialPayload.viewer.profilePending, true);
      assert.equal(initialPayload.viewer.profileSuggestedName, "Test User");
      assert.equal(initialPayload.viewer.profileSuggestedAvatarUrl, "https://cdn.example.com/avatar.png");
      assert.throws(() => store.createTopic({
        sessionId: "session-oidc-1",
        title: "Tema OAuth",
        text: "Mensaje"
      }), /Completa tu perfil/);

      const completedPayload = store.updateProfile({
        sessionId: "session-oidc-1",
        displayName: "Alias_elegido",
        avatarDataUrl: "data:image/png;base64,aGVsbG8="
      });
      assert.equal(completedPayload.viewer.profilePending, false);
      assert.equal(completedPayload.viewer.displayName, "Alias_elegido");
      assert.equal(completedPayload.viewer.nickname, "Alias_elegido");
      assert.equal(completedPayload.viewer.avatarUrl, null);
      assert.match(completedPayload.viewer.avatarPendingUrl, /^\/avatars\/[a-f0-9-]+\.png$/);
      assert.doesNotMatch(completedPayload.viewer.avatarPendingUrl, /^data:/);
      assert.equal(completedPayload.viewer.avatarReviewStatus, "pending");

      store.loginWithIdentity({
        sessionId: "session-oidc-duplicate-name",
        sourceSessionId: "session-oidc-duplicate-name-source",
        authProvider: "https://accounts.example.com",
        authSubject: "subject-duplicate-name",
        email: "duplicate-name@example.com",
        displayName: "Alias_elegido"
      });
      assert.throws(() => store.updateProfile({
        sessionId: "session-oidc-duplicate-name",
        displayName: "alias_elegido"
      }), (error) => error.code === "NICKNAME_TAKEN");

      const secondPayload = store.loginWithIdentity({
        sessionId: "session-oidc-2",
        sourceSessionId: "session-oidc-source-2",
        authProvider: "https://accounts.example.com",
        authSubject: "subject-123",
        email: "test@example.com",
        displayName: "Test User Renamed"
      });

      assert.equal(secondPayload.viewer.id, initialPayload.viewer.id);
      assert.equal(secondPayload.viewer.displayName, "Alias_elegido");
      assert.equal(secondPayload.viewer.profilePending, false);
      assert.equal(secondPayload.viewer.profileSuggestedName, "Test User Renamed");
    });
  });

  await test("backend loginWithIdentity preserves existing account data when provider data is incomplete", async () => {
    await withTempStore((store) => {
      const initialPayload = store.loginWithIdentity({
        sessionId: "session-oidc-preserve-1",
        sourceSessionId: "session-oidc-preserve-source-1",
        authProvider: "https://accounts.example.com",
        authSubject: "subject-preserve",
        email: "preserve@example.com",
        displayName: "Provider User",
        avatarUrl: "https://cdn.example.com/provider-avatar.png"
      });

      const completedPayload = store.updateProfile({
        sessionId: "session-oidc-preserve-1",
        displayName: "Alias_protegido",
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
      const approvedUser = approvedPayload.users.find((user) => user.id === completedPayload.viewer.id);

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
        displayName: "Persist User"
      });
      const userId = firstLogin.viewer.id;

      store.updateProfile({
        sessionId: "session-persist-1",
        displayName: "Persist_alias"
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
      store.login({
        sessionId: "session-profile",
        selectedTopicId: null
      });

      const updated = store.updateProfile({
        sessionId: "session-profile",
        displayName: "Nombre_nuevo",
        description: "Descripcion breve del perfil",
        profileShowDescription: false,
        profileShowJoinedAt: false,
        avatarDataUrl: "data:image/jpeg;base64,aW1hZ2U="
      });

      assert.equal(updated.viewer.type, "registered");
      assert.equal(updated.viewer.displayName, "Nombre_nuevo");
      assert.equal(updated.viewer.nickname, "Nombre_nuevo");
      assert.equal(updated.viewer.description, "Descripcion breve del perfil");
      assert.equal(updated.viewer.profileShowDescription, false);
      assert.equal(updated.viewer.profileShowJoinedAt, false);
      assert.equal(updated.users.find((user) => user.id === updated.viewer.id)?.description, "Descripcion breve del perfil");
      assert.equal(updated.users.find((user) => user.id === updated.viewer.id)?.profileShowDescription, false);
      assert.equal(updated.users.find((user) => user.id === updated.viewer.id)?.profileShowJoinedAt, false);
      assert.equal(updated.viewer.avatarUrl, null);
      assert.match(updated.viewer.avatarPendingUrl, /^\/avatars\/[a-f0-9-]+\.jpg$/);
      assert.doesNotMatch(updated.viewer.avatarPendingUrl, /^data:/);
      assert.equal(updated.viewer.avatarReviewStatus, "pending");
      assert.equal(updated.users.find((user) => user.id === updated.viewer.id)?.avatarPendingUrl, updated.viewer.avatarPendingUrl);
      const storedAvatar = await readFile(path.join(store.avatarStorageDir, path.basename(updated.viewer.avatarPendingUrl)));
      assert.equal(storedAvatar.toString("utf8"), "image");
      assert.throws(() => store.registerWithPassword({
        sessionId: "session-profile-duplicate-register",
        email: "profile-duplicate@example.com",
        password: "password-segura",
        nickname: "nombre_nuevo"
      }), (error) => error.code === "NICKNAME_TAKEN");

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
      assert.equal(removedAvatar.users.find((user) => user.id === updated.viewer.id)?.avatarUrl, null);
      await assert.rejects(() => readFile(path.join(store.avatarStorageDir, path.basename(updated.viewer.avatarPendingUrl))), /ENOENT/);

      const firstPendingAvatar = store.updateProfile({
        sessionId: "session-profile",
        displayName: "Nombre_nuevo",
        avatarDataUrl: "data:image/png;base64,b2xk"
      });
      const firstPendingAvatarPath = path.join(store.avatarStorageDir, path.basename(firstPendingAvatar.viewer.avatarPendingUrl));
      const secondPendingAvatar = store.updateProfile({
        sessionId: "session-profile",
        displayName: "Nombre_nuevo",
        avatarDataUrl: "data:image/webp;base64,bmV3"
      });
      await assert.rejects(() => readFile(firstPendingAvatarPath), /ENOENT/);
      assert.equal(
        (await readFile(path.join(store.avatarStorageDir, path.basename(secondPendingAvatar.viewer.avatarPendingUrl)))).toString("utf8"),
        "new"
      );

      assert.throws(() => store.updateProfile({
        sessionId: "session-profile-guest",
        avatarDataUrl: "data:image/png;base64,aGVsbG8="
      }), /Hace falta iniciar sesion/);

      assert.throws(() => store.updateProfile({
        sessionId: "session-profile",
        avatarDataUrl: "data:text/html;base64,PHNjcmlwdD4="
      }), /PNG, JPG, WebP o GIF/);
      const oversizedAvatar = Buffer.alloc((2 * 1024 * 1024) + 1).toString("base64");
      assert.throws(() => store.updateProfile({
        sessionId: "session-profile",
        avatarDataUrl: `data:image/png;base64,${oversizedAvatar}`
      }), /2 MB/);
      assert.throws(() => store.updateProfile({
        sessionId: "session-profile",
        displayName: "Nombre_nuevo",
        description: "x".repeat(181)
      }), (error) => error.code === "VALIDATION_ERROR");
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
          displayName: "Review User"
        });
        const pendingPayload = store.updateProfile({
          sessionId: "session-avatar-review-user",
          displayName: "Review_user",
          avatarDataUrl: "data:image/png;base64,aGVsbG8="
        });

        assert.equal(pendingPayload.viewer.avatarReviewStatus, "pending");
        assert.match(pendingPayload.viewer.avatarPendingUrl, /^\/avatars\/[a-f0-9-]+\.png$/);

        const dashboard = store.getAdminDashboard({ sessionId: "session-admin-oauth" });
        assert.equal(dashboard.pendingAvatars.some((item) => item.userId === userPayload.viewer.id), true);

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
        assert.equal(store.getAdminDashboard({ sessionId: "session-admin-oauth" }).pendingAvatars.length, 0);
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
      return payload.topics.find((entry) => entry.id === topicId).messages.find((entry) => entry.id === messageId);
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

      assert.throws(() => store.toggleMessageLike(message.id, {
        sessionId: "session-like-user",
        selectedTopicId: topic.id
      }), (error) => error?.code === "MESSAGE_REACTION_LOCKED");
      assert.throws(() => store.toggleMessageDislike(message.id, {
        sessionId: "session-like-user",
        selectedTopicId: topic.id
      }), (error) => error?.code === "MESSAGE_REACTION_LOCKED");

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
    await withTempStore((store) => {
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
    }, { seedDemoData: false });
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
      assert.deepEqual(openReports.reportPagination, {
        page: 1,
        limit: 50,
        total: 2,
        hasMore: false
      });

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
      assert.equal(created.topics.some((topic) => topic.id === displacedTopicId), false);
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

      assert.throws(() => {
        store.addMessage(expelledCandidateId, {
          sessionId: "session-expel-comment",
          authMode: "registered",
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

  await test("backend rejects guest publishing without materializing guest state", async () => {
    await withTempStore((store) => {
      const activeTopicId = store.bootstrap({
        sessionId: "session-guest-ip-bootstrap",
        authMode: "guest",
        ipAddress: "203.0.113.50"
      }).topics[0].id;

      assert.throws(() => {
        store.addMessage(activeTopicId, {
          sessionId: "session-guest-ip-a",
          authMode: "guest",
          text: "Comentario guest bloqueado",
          ipAddress: "203.0.113.50"
        });
      }, (error) => error.code === "LOGIN_REQUIRED");
      assert.throws(() => {
        store.createTopic({
          sessionId: "session-guest-topic-ip-a",
          authMode: "guest",
          title: "Tema guest bloqueado",
          text: "No deberia publicarse",
          ipAddress: "203.0.113.52"
        });
      }, (error) => error.code === "LOGIN_REQUIRED");
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

      assert.throws(() => {
        store.addMessage(topicId, {
          sessionId: "session-blocked-registered",
        authMode: "registered",
          text: "No deberia publicar",
          ipAddress: "203.0.113.10"
        });
      }, (error) => error.code === "SESSION_BLOCKED");

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
    assert.equal(getRequestIp({ ...req, headers: { "x-forwarded-for": "198.51.100.7, 198.51.100.8" } }, { TOPYKLY_TRUST_PROXY: "yes" }), "198.51.100.7");
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
    assert.equal(getAuthErrorFeedbackMessage("AUTH_FLOW_EXPIRED"), "La solicitud de inicio de sesion expiro. Intentalo de nuevo.");
    assert.equal(getAuthErrorFeedbackMessage("invalid_auth_callback"), "No se pudo validar el inicio de sesion. Intentalo de nuevo.");
    assert.equal(getAuthErrorFeedbackMessage("unknown_error"), "No se pudo completar el inicio de sesion.");
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
      authTools,
      authModalBackdrop: new FakeElement(),
      authModal: new FakeElement(),
      authGoogleButton: new FakeElement(),
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
      assert.equal(flashCalls.at(-1), "Sesion iniciada");

      authButton.dispatch("click");
      await flushAsyncEvents();

      assert.equal(logoutCalls, 0);
      assert.equal(state.viewer.type, "registered");
      assert.equal(flashCalls.at(-1), "Toca de nuevo para cerrar sesion");

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
        authTools: new FakeElement(),
        authModalBackdrop: new FakeElement(),
        authModal: new FakeElement(),
        authGoogleButton,
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
      }, {
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
      });

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
      authTools,
      authModalBackdrop: new FakeElement(),
      authModal: new FakeElement(),
      authGoogleButton: new FakeElement(),
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

      assert.equal(logoutCalls, 0);
      assert.equal(globalThis.document.documentElement.dataset.authState, "logged-in");
      assert.equal(flashCalls.at(-1), "Toca de nuevo para cerrar sesion");

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
        authTools: new FakeElement(),
        authModalBackdrop: new FakeElement(),
        authModal: new FakeElement(),
        authGoogleButton,
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
      authGoogleButton.dispatch("click");
      await flushAsyncEvents();
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
    const titles = await read("ui/titles.js");
    const topics = await read("ui/topics.js");
    const users = await read("ui/users.js");
    const renderUtils = await read("ui/render-utils.js");
    assert.doesNotMatch(renderUtils, /outerHTML/);
    assert.match(renderUtils, /function patchElement\(existing, incoming\)/);
    assert.match(renderUtils, /function patchChildren\(existing, incoming\)/);
    const previewServer = await read("services/preview-server.js");
    const backendStore = await read("services/backend-store.js");
    assert.match(previewServer, /const authLoginResponse = await authService\.createLoginResponse[\s\S]*await authService\.validateTurnstile/);
    assert.match(previewServer, /if \(authLoginResponse\) \{[\s\S]*sendJson\(res, 200, authLoginResponse\.payload/);
    assert.match(previewServer, /segments\.some\(\(segment\) => segment\.startsWith\("\."\)\)/);
    assert.match(previewServer, /PUBLIC_SERVICE_MODULES/);
    assert.match(previewServer, /PROTECTED_STATIC_DIRECTORIES/);
    assert.match(previewServer, /PROTECTED_STATIC_ROOT_FILES/);
    assert.match(previewServer, /segments\[0\] === "services"/);
    assert.match(previewServer, /PROTECTED_STATIC_DIRECTORIES\.has\(segments\[0\] \|\| ""\)/);
    assert.match(previewServer, /path\.relative\(root, absolutePath\)/);
    assert.match(previewServer, /relativePath\.startsWith\("\.\."\) \|\| path\.isAbsolute\(relativePath\)/);
    assert.match(previewServer, /"X-Content-Type-Options": "nosniff"/);
    assert.match(previewServer, /"X-Frame-Options": "DENY"/);
    assert.match(previewServer, /"Content-Security-Policy"/);
    assert.match(previewServer, /frame-ancestors 'none'/);
    assert.match(previewServer, /getSecurityHeaders\(\{ includeCsp: false \}\)/);
    assert.match(previewServer, /getSecurityHeaders\(\{ includeCsp: extension === "\.html" \}\)/);
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
    assert.match(backendStore, /function getFrontendUsers\(db, viewerId, profileUserIds = \[\]\)/);
    assert.match(backendStore, /users: getFrontendUsers\(db, context\.viewer\.id, profileUserIds\)/);
    assert.match(previewServer, /"Retry-After": String\(result.retryAfterSeconds\)/);
    assert.match(previewServer, /if \(!enforceHttpRateLimit\(res, httpRateLimitBuckets, req, url, httpRateLimitConfig\)\)/);
    assert.match(previewServer, /setInterval\(\(\) => runGuestCleanup\(store, log\), guestCleanupIntervalMs\)/);
    assert.match(previewServer, /clearInterval\(guestCleanupTimer\)/);
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
    assert.match(html, /placeholder="Escribe aqui\.\.\."/);
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
    assert.match(html, /<h2 class="profile-modal__title">Perfil<\/h2>/);
    assert.match(html, /id="profileNameSection"[\s\S]*data-editing="false"[\s\S]*id="profileAvatarPreview"/);
    assert.match(html, /id="profileNameEditButton"[\s\S]*aria-label="Editar nombre visible"[\s\S]*data-profile-section-edit="name"/);
    assert.match(html, /id="profileNameFeedback"/);
    assert.match(html, /id="profileNameInput"[\s\S]*readonly/);
    assert.match(html, /id="profileDescriptionEditButton"[\s\S]*aria-label="Editar descripción"[\s\S]*data-profile-section-edit="description"/);
    assert.match(html, /id="profileDescriptionInput"[\s\S]*maxlength="180"[\s\S]*readonly/);
    assert.doesNotMatch(html, /id="profileDescriptionInput"[\s\S]*rows=/);
    assert.match(html, /id="profileAvatarPreview"[\s\S]*aria-label="Cambiar avatar"/);
    assert.match(html, /id="profileJoinedAtText"/);
    assert.match(html, /id="profileJoinedAtVisibilityButton"[\s\S]*data-profile-visibility="joinedAt"/);
    assert.match(html, /id="profileDescriptionVisibilityButton"[\s\S]*data-profile-visibility="description"/);
    assert.match(html, /id="profileAvatarPickButton"[\s\S]*Elegir avatar/);
    assert.doesNotMatch(html, /Foto de perfil|Elegir foto|<span>Avatar<\/span>|id="profileAvatarEditButton"/);
    assert.match(html, /id="skipProfileButton"[\s\S]*>Cancelar<\/button>/);
    assert.doesNotMatch(html, /Puedes completar esto ahora|Quitar seleccion|id="profileAvatarClearButton"/);
    assert.doesNotMatch(html, /id="paletteModalTitle"/);
    assert.match(html, /cdn\.jsdelivr\.net\/gh\/mdbassit\/Coloris@v0\.25\.0\/dist\/coloris\.min\.css/);
    assert.match(html, /cdn\.jsdelivr\.net\/gh\/mdbassit\/Coloris@v0\.25\.0\/dist\/coloris\.min\.js/);
    assert.match(html, /integrity="sha384-DY3umZptOgjUNshBFbvu1\+3RVFPoD1\/CgGcc1yyJ77\/aFOJ7jtN4BORnz\/D\/xF0n"/);
    assert.match(html, /integrity="sha384-olpkBKjEFqOOAAUzqL1y4xnKDCVmmXNaoRDWmHnRTutomMnUySX9hqDgVQVcvMdc"/);
    assert.match(html, /crossorigin="anonymous"/);
    assert.match(html, /localStorage\.getItem\("topykly-theme"\) \|\| localStorage\.getItem\("chetrend-theme"\) \|\| "dark"/);
    assert.match(html, /localStorage\.getItem\("topykly-palette"\) \|\| localStorage\.getItem\("chetrend-palette"\) \|\| "default"/);
    assert.match(html, /const authState = "logged-out";/);
    assert.match(html, /window\.matchMedia\("\(max-width: 960px\)"\)\.matches/);
    assert.match(html, /document\.documentElement\.dataset\.authState = authState/);
    assert.match(html, /document\.documentElement\.classList\.toggle\("is-mobile-viewport", mobile\)/);
    assert.match(html, /document\.documentElement\.classList\.toggle\("is-desktop-viewport", !mobile\)/);
    assert.match(styles, /html\[data-auth-state="logged-out"\] \[data-auth-private\]\s*\{[\s\S]*display:\s*none !important;/);
    assert.match(html, /id="authGoogleButton"[\s\S]*id="authTurnstile"/);
    assert.doesNotMatch(html, /Resend|Google ya esta disponible|auth-modal__note/);
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
    assert.match(data, /"Caf\u00e9 de madrugada"/);
    assert.match(data, /"Moderaci\u00f3n"/);
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
    assert.match(styles, /\.profile-modal\s*\{[\s\S]*width:\s*min\(920px,\s*100%\);/);
    assert.match(styles, /\.profile-modal__header\s*\{[\s\S]*padding:\s*16px 24px 14px;/);
    assert.match(styles, /\.profile-modal__title\s*\{[\s\S]*font-size:\s*1\.45rem;/);
    assert.match(styles, /\.profile-modal__actions\s*\{[\s\S]*padding:\s*11px 24px;/);
    assert.match(styles, /\.profile-modal__actions \.primary-button,[\s\S]*\.profile-modal__actions \.text-button\s*\{[\s\S]*min-height:\s*38px;/);
    assert.match(styles, /\.profile-modal__body\s*\{[\s\S]*min-height:\s*560px;[\s\S]*padding:\s*18px 28px 28px;/);
    assert.match(styles, /\.profile-modal__preview\s*\{[\s\S]*grid-row:\s*2;[\s\S]*width:\s*min\(232px, 100%\);[\s\S]*justify-self:\s*center;/);
    assert.match(styles, /\.profile-modal__field--name\s*\{[\s\S]*grid-row:\s*1;/);
    assert.match(styles, /\.profile-modal__field--avatar\s*\{[\s\S]*grid-row:\s*4;[\s\S]*width:\s*min\(232px, 100%\);[\s\S]*justify-self:\s*center;/);
    assert.match(styles, /\.profile-modal__joined\s*\{[\s\S]*grid-row:\s*3;[\s\S]*width:\s*min\(232px, 100%\);[\s\S]*justify-self:\s*center;/);
    assert.match(styles, /\.profile-modal__visibility-button\s*\{[\s\S]*width:\s*34px;[\s\S]*height:\s*34px;/);
    assert.match(styles, /\.profile-modal__field--description\s*\{[\s\S]*grid-column:\s*2;[\s\S]*grid-row:\s*1 \/ span 4;/);
    assert.match(styles, /\.profile-modal__field--description textarea\s*\{[\s\S]*height:\s*100%;[\s\S]*max-height:\s*none;/);
    assert.match(styles, /\.profile-modal__field-heading\s*\{[\s\S]*justify-content:\s*space-between;/);
    assert.match(styles, /\.profile-modal__edit-button\s*\{[\s\S]*width:\s*34px;[\s\S]*height:\s*34px;/);
    assert.match(styles, /\.profile-modal__edit-button:hover,[\s\S]*\.profile-modal__edit-button:focus-visible\s*\{[\s\S]*background:\s*color-mix\(in srgb, var\(--accent-soft\) 38%, var\(--surface-strong\)\);/);
    assert.match(styles, /\.profile-modal__field\.is-editing \.profile-modal__edit-button\s*\{[\s\S]*background:\s*color-mix\(in srgb, var\(--accent\) 34%, var\(--surface-strong\)\);[\s\S]*color:\s*var\(--accent-strong\);/);
    assert.match(styles, /\.profile-modal__edit-button:active\s*\{[\s\S]*transform:\s*none;/);
    assert.match(styles, /\.profile-modal__edit-button--inside:active\s*\{[\s\S]*transform:\s*translateY\(-50%\);/);
    assert.match(styles, /\.profile-modal__input-shell\s*\{[\s\S]*position:\s*relative;/);
    assert.match(styles, /\.profile-modal__edit-button--inside\s*\{[\s\S]*right:\s*6px;/);
    assert.match(styles, /\.profile-modal__file-button\s*\{[\s\S]*justify-content:\s*center;[\s\S]*background:\s*color-mix\(in srgb, var\(--accent-soft\) 72%, var\(--surface-strong\)\);/);
    assert.match(styles, /\.profile-modal__edit-button svg\s*\{[\s\S]*fill:\s*none;[\s\S]*stroke:\s*currentColor;[\s\S]*stroke-width:\s*2;/);
    assert.match(styles, /@media \(max-width:\s*920px\)/);
    assert.match(styles, /\.profile-avatar-crop-backdrop\s*\{[\s\S]*z-index:\s*95;[\s\S]*backdrop-filter:\s*blur\(8px\);/);
    assert.match(styles, /\.profile-avatar-crop__frame\s*\{[\s\S]*aspect-ratio:\s*1;[\s\S]*touch-action:\s*none;/);
    assert.match(styles, /\.public-profile-modal-backdrop\s*\{[\s\S]*background:\s*color-mix\(in srgb, var\(--bg\) 12%, transparent\);[\s\S]*backdrop-filter:\s*blur\(5px\);/);
    assert.match(styles, /\.public-profile-modal\s*\{[\s\S]*background:\s*var\(--bg\);/);
    assert.match(styles, /\.public-profile-modal \.profile-modal__header,[\s\S]*\.public-profile-modal \.public-profile-modal__actions\s*\{[\s\S]*background:\s*var\(--bg\);/);
    assert.match(styles, /\.public-profile-modal__body\s*\{[\s\S]*grid-template-columns:\s*minmax\(220px, 260px\) minmax\(0, 1fr\);[\s\S]*min-height:\s*560px;[\s\S]*padding:\s*18px 28px 28px;/);
    assert.match(styles, /\.public-profile-modal__avatar\s*\{[\s\S]*width:\s*min\(232px, 100%\);[\s\S]*image-rendering:\s*auto;/);
    assert.match(styles, /\.public-profile-modal__meta\s*\{[\s\S]*grid-column:\s*2;[\s\S]*grid-row:\s*1 \/ span 3;[\s\S]*grid-template-rows:\s*auto minmax\(0, 1fr\);/);
    assert.match(styles, /\.public-profile-modal__description-label\s*\{[\s\S]*border-bottom:\s*0;[\s\S]*font-weight:\s*950;[\s\S]*text-align:\s*center;/);
    assert.match(styles, /\.public-profile-modal__description\s*\{[\s\S]*min-height:\s*100%;[\s\S]*height:\s*100%;[\s\S]*border:\s*1px solid var\(--line-strong\);[\s\S]*border-radius:\s*0 0 8px 8px;/);
    assert.match(styles, /\.public-profile-modal__joined\s*\{[\s\S]*grid-template-columns:\s*repeat\(3, 1fr\);[\s\S]*overflow:\s*hidden;[\s\S]*border:\s*1px solid/);
    assert.match(styles, /\.public-profile-modal__joined span \+ span\s*\{[\s\S]*border-left:\s*1px solid/);
    assert.match(styles, /\.public-profile-modal__cafes\s*\{[\s\S]*grid-column:\s*1;[\s\S]*grid-row:\s*3;[\s\S]*width:\s*min\(232px, 100%\);[\s\S]*align-self:\s*stretch;/);
    assert.match(styles, /\.public-profile-modal__cafes ul\s*\{[\s\S]*grid-template-rows:\s*repeat\(3, minmax\(0, 1fr\)\);/);
    assert.match(styles, /\.public-profile-modal__cafes li\s*\{[\s\S]*display:\s*flex;[\s\S]*text-overflow:\s*ellipsis;/);
    assert.match(styles, /\.public-profile-modal__actions\s*\{[\s\S]*margin:\s*8px -28px -28px;[\s\S]*padding:\s*11px 24px;/);
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
    assert.match(styles, /html\.is-mobile-viewport \.topbar\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto;/);
    assert.match(styles, /html\.is-mobile-viewport \.topbar__group--right\s*\{[\s\S]*grid-column:\s*2;[\s\S]*justify-content:\s*flex-end;/);
    assert.match(styles, /html\.is-mobile-viewport \.topbar__title\s*\{[\s\S]*grid-column:\s*1;[\s\S]*display:\s*inline-flex;[\s\S]*max-width:\s*100%;/);
    assert.match(styles, /html\.is-mobile-viewport\[data-auth-state="logged-in"\] #authButton\s*\{[\s\S]*display:\s*none;/);
    assert.match(styles, /html\.is-mobile-viewport \.topbar__auth-tools\s*\{[\s\S]*display:\s*none;/);
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
    assert.match(styles, /\.topic-list\s*\{[\s\S]*grid-auto-rows:\s*84px;/);
    assert.match(styles, /html\.is-desktop-viewport \.panel--topics \.topic-list\s*\{[\s\S]*grid-auto-rows:\s*76px;/);
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
    assert.match(styles, /input,\s*textarea\s*\{[\s\S]*box-sizing:\s*border-box;[\s\S]*padding:\s*0\.92rem 1rem;/);
    assert.match(styles, /textarea\s*\{[\s\S]*max-height:\s*10rem;[\s\S]*overflow-x:\s*hidden;[\s\S]*overflow-y:\s*hidden;[\s\S]*overflow-wrap:\s*anywhere;[\s\S]*scrollbar-color:\s*var\(--scrollbar-thumb\) transparent;/);
    assert.match(styles, /textarea::-webkit-scrollbar-thumb\s*\{[\s\S]*background:\s*var\(--scrollbar-thumb\);[\s\S]*border-radius:\s*999px;[\s\S]*background-clip:\s*content-box;/);
    assert.match(styles, /textarea\.is-scrollable\s*\{[\s\S]*overflow-y:\s*auto;/);
    assert.match(styles, /#messageInput:not\(\.is-scrollable\)::-webkit-scrollbar\s*\{[\s\S]*width:\s*0;[\s\S]*height:\s*0;/);
    assert.match(styles, /input::placeholder,\s*textarea::placeholder\s*\{[\s\S]*color:\s*color-mix\(in srgb,\s*var\(--accent\) 28%,\s*var\(--text-soft\)\);[\s\S]*opacity:\s*1;/);
    assert.match(styles, /html\[data-theme="light"\] \.composer input,\s*html\[data-theme="light"\] \.composer textarea\s*\{[\s\S]*border:\s*1px solid color-mix/);
    assert.match(styles, /html\[data-theme="light"\] \.composer--topic-create input,\s*html\[data-theme="light"\] \.composer--topic-create textarea\s*\{[\s\S]*border-radius:\s*0;/);
    assert.match(styles, /html\[data-theme="light"\] \.message \+ \.message::before\s*\{[\s\S]*height:\s*1px;/);
    assert.match(styles, /html\[data-theme="light"\] \.rankings-section\s*\{[\s\S]*border-left:\s*0;[\s\S]*border-top:\s*1px solid/);
    assert.match(app, /from "\.\/controller\.js\?v=20260702-sessioncookie"/);
    assert.match(components, /createProfileAvatar/);
    assert.match(components, /message__avatar/);
    assert.match(components, /message__body/);
    assert.match(components, /message__time/);
    assert.match(components, /message__like-button/);
    assert.match(components, /message__like-button--positive/);
    assert.match(components, /message__like-button--negative/);
    assert.match(components, /const likeScore = \(message\.likes \?\? 0\) - \(message\.dislikes \?\? 0\);/);
    assert.match(components, /const likeLabel = likeScore > 0 \? `\+\$\{likeScore\}` : String\(likeScore\);/);
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
    assert.match(components, /user-item__trigger/);
    assert.match(components, /aria-pressed/);
    assert.doesNotMatch(components, /getUserRole|Aviso|Invitado/);
    assert.match(controller, /export \{ bootstrap \} from "\.\/controller-app\.js\?v=20260702-sessioncookie";/);
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
    assert.match(controllerApp, /from "\.\/ui\/events\.js\?v=20260702-sessioncookie"/);
    assert.match(controllerApp, /from "\.\/controller-actions\.js\?v=20260702-sessioncookie"/);
    assert.match(controllerApp, /from "\.\/controller-responsive\.js"/);
    assert.match(controllerApp, /from "\.\/controller-render\.js"/);
    assert.match(controllerApp, /from "\.\/controller-runtime\.js"/);
    assert.match(controllerApp, /renderRef\.current = renderers\.render;[\s\S]*responsive\.syncResponsiveView\(\);[\s\S]*responsive\.updateLayoutMetrics\(\);[\s\S]*renderers\.render\(\);/);
    assert.match(controllerApp, /bindPageEvents\(dom, \{[\s\S]*state: actions\.state,[\s\S]*setAuthUiSync: actions\.setAuthUiSync,/);
    assert.match(controllerApp, /toggleMessageLike:\s*actions\.toggleMessageLike/);
    assert.match(controllerApp, /toggleMessageDislike:\s*actions\.toggleMessageDislike/);
    assert.match(controllerApp, /openAdminPanel: actions\.openAdminPanel,[\s\S]*closeAdminPanel: actions\.closeAdminPanel,[\s\S]*applyAdminAction: actions\.applyAdminAction,/);
    assert.match(controllerApp, /closePublicProfileModal: actions\.closePublicProfileModal/);
    assert.doesNotMatch(controllerApp, /function cacheDom|function bindEvents|function renderIntoTargets|function getTransitionDurationMs|function bindTopbarEvents|function toggleTheme|function submitMessage/);
    assert.match(actions, /from "\.\/services\/api\.js\?v=20260702-sessioncookie"/);
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
    assert.match(renderController, /renderPaletteModal/);
    assert.match(renderController, /renderPublicProfileModal/);
    assert.match(chat, /renderChat/);
    assert.match(chat, /panel--topic-create/);
    assert.match(chat, /Primer posteo del tema/);
    assert.match(chat, /Crear tema/);
    assert.match(chatActions, /Inicia sesion o crea una cuenta para participar/);
    assert.match(chatActions, /Motivo del reporte del usuario/);
    assert.match(rankings, /renderRankings/);
    assert.match(rankings, /Selecciona un tema para ver su actividad real/);
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
    assert.match(publicProfileModal, /export function renderPublicProfileModal/);
    assert.match(publicProfileModal, /createdAt/);
    assert.match(publicProfileModal, /return \[day, month, String\(year\)\]/);
    assert.match(publicProfileModal, /document\.createElement\("span"\)/);
    assert.match(publicProfileModal, /profileShowDescription/);
    assert.match(publicProfileModal, /profileShowJoinedAt/);
    assert.match(publicProfileModal, /avatarPendingUrl \|\| user\.avatarUrl/);
    assert.match(publicProfileModal, /getRecentUserCafes/);
    assert.match(publicProfileModal, /Últimos temas/);
    assert.match(publicProfileModal, /publicProfileRecentCafes/);
    assert.match(publicProfileModal, /publicProfileDescription/);
    assert.match(publicProfileModal, /publicProfileJoinedAt/);
    assert.match(publicProfileModal, /publicProfileActions\.hidden = isCurrentUser/);
    assert.match(publicProfileModal, /publicProfileReportButton\.hidden = isCurrentUser/);
    assert.doesNotMatch(publicProfileModal, /comment|comentario|likes received|likesRecibidos|online|estado/i);
    assert.match(titles, /renderTitles/);
    assert.match(topics, /renderTopics/);
    assert.match(topics, /const isLoading = !state\.viewer/);
    assert.match(topics, /createEmptyState\("Todavia no hay temas"/);
    assert.match(users, /renderUsers/);
    assert.match(users, /const isLoading = !state\.viewer/);
    assert.match(users, /createEmptyState\("Sin usuarios todavia"/);
    assert.match(chat, /const isLoading = !state\.viewer/);
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
    assert.match(domModule, /publicProfileModalBackdrop/);
    assert.match(domModule, /paletteOptionGrid/);
    assert.match(domModule, /assertRequiredDom/);
    assert.match(domModule, /Missing required DOM nodes/);
    assert.match(eventsModule, /from "\.\/topbar\.js\?v=20260702-sessioncookie"/);
    assert.match(eventsModule, /syncComposerTextareaHeight/);
    assert.match(eventsModule, /export function bindPageEvents/);
    assert.match(eventsModule, /Coloris\.close/);
    assert.match(eventsModule, /messageForm\.addEventListener\("submit", handlers\.submitMessage\)/);
    assert.match(eventsModule, /messageInput\.addEventListener\("input", \(\) => \{[\s\S]*syncComposerTextareaHeight\(dom\.messageInput\);/);
    assert.match(chat, /export function syncComposerTextareaHeight/);
    assert.match(chat, /classList\.toggle\(\s*"is-scrollable"/);
    assert.match(previewServer, /const topicId = segments\[2\] \|\| "";/);
    assert.match(chat, /syncMessageCardHeights\(dom\.messageStream\);/);
    assert.match(chat, /syncTopicReportButton/);
    assert.match(chat, /chatHero\.hidden = true;/);
    assert.doesNotMatch(chat, /if \(shouldSyncChatLayout\(previousRenderState,\s*nextRenderState\)\)\s*\{[\s\S]*syncMessageCardHeights\(dom\.messageStream\);/);
    assert.match(eventsModule, /activateConnectedUser/);
    assert.match(eventsModule, /profileAvatarCropModal/);
    assert.match(eventsModule, /closePublicProfileModal/);
    assert.match(eventsModule, /reportEntity/);
    assert.match(eventsModule, /data-report-entity-type/);
    assert.match(eventsModule, /data-connected-user-id/);
    assert.match(eventsModule, /data-user-action/);
    assert.match(renderUtils, /renderIntoTargets/);
    assert.match(drawers, /getTransitionDurationMs/);
    assert.match(topbar, /from "\.\/topbar-action-events\.js\?v=20260702-sessioncookie"/);
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
    assert.match(topbarActionEvents, /addListener\(dom\.profileAvatarPreview, "click", openProfileAvatarPicker\)/);
    assert.match(topbarActionEvents, /setProfileSectionEditing\(dom, section, !isEditing\)/);
    assert.match(topbarActionEvents, /addListener\(dom\.profileNameEditButton, "click", \(\) => toggleProfileSection\("name"\)\)/);
    assert.match(topbarActionEvents, /let profileAvatarCropState = null;/);
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
    assert.match(topbarActionEvents, /document\.documentElement\.dataset\.authState = isLoggedIn\(\) \? "logged-in" : "logged-out"/);
    assert.match(topbarActionEvents, /await handlers\.login\?\.\(\{ turnstileToken \}\)/);
    assert.match(topbarActionEvents, /await handlers\.logout\?\.\(\)/);
    assert.match(topbarActionEvents, /dom\.authTools\.hidden = !loggedIn/);
    assert.match(topbarActionEvents, /setLoggedIn/);
    assert.match(topbarActionEvents, /addListener\(dom\.authButton,\s*"click"/);
    assert.match(topbarActionEvents, /dom\.authButton\.hidden = isMobile && loggedIn/);
    assert.match(topbarActionEvents, /authLabel = loggedIn[\s\S]*"Cerrar sesión"[\s\S]*"Iniciar sesión"/);
    assert.match(topbarActionEvents, /target\.dataset\.mobileTopbarAction === "auth"/);
    assert.match(topbarActionEvents, /Toca de nuevo para cerrar sesion/);
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

  console.log("all tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});



