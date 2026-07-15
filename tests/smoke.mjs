import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MINIMUM_REGISTRATION_AGE, TERMS_VERSION } from "../services/backend-store.js";
import { startPreviewServer } from "../services/preview-server.js";

const host = "127.0.0.1";
const port = 4300 + Math.floor(Math.random() * 1000);
const origin = `http://${host}:${port}`;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "topykly-smoke-"));
const dbPath = path.join(tempDir, "topykly.sqlite");
const previousSeedDemoData = process.env.TOPYKLY_SEED_DEMO_DATA;
process.env.TOPYKLY_SEED_DEMO_DATA = "true";
const app = startPreviewServer({
  port,
  host,
  dbPath,
  log() {}
});

const cookieJars = new Map();

function readCookieHeader(response) {
  const setCookie = response.headers.get("set-cookie") || "";
  return setCookie
    .split(/,(?=\s*[^;,=]+=[^;,]+)/)
    .map((entry) => entry.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function request(
  pathname,
  { method = "GET", sessionId = "session-smoke-guest", body = undefined, expectedStatus = 200 } = {}
) {
  const headers = {
    "Content-Type": "application/json"
  };
  const cookie = cookieJars.get(sessionId);
  if (cookie) {
    headers.Cookie = cookie;
  }

  const response = await fetch(`${origin}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const nextCookie = readCookieHeader(response);
  if (nextCookie) {
    cookieJars.set(sessionId, nextCookie);
  }
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  assert.equal(response.status, expectedStatus, `${method} ${pathname}: ${text}`);
  return payload;
}

function readSessionId(cookie = "") {
  const match = String(cookie).match(/(?:^|;\s*)topykly_sid=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function registerVerifiedUserFixture({ sessionId, email, password, nickname }) {
  const challenge = app.store.createEmailAuthChallenge({
    email,
    nickname,
    age: MINIMUM_REGISTRATION_AGE,
    password,
    acceptedTerms: true,
    termsVersion: TERMS_VERSION
  });
  const registered = app.store.verifyEmailAuthChallenge({
    challengeId: challenge.challengeId,
    code: challenge.code,
    sessionId: readSessionId(cookieJars.get(sessionId)) || `fixture-${sessionId}`,
    rotateSession: true
  });

  cookieJars.set(sessionId, `topykly_sid=${encodeURIComponent(registered.sessionId)}`);
  return registered;
}

async function waitForServer() {
  const deadline = Date.now() + 5_000;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw lastError || new Error("Smoke server did not start.");
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

try {
  await waitForServer();

  await test("serves the TOPYKLY app shell", async () => {
    const response = await fetch(`${origin}/`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
    assert.match(response.headers.get("content-security-policy") || "", /base-uri 'self'/);
    assert.match(response.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
    assert.match(
      response.headers.get("content-security-policy") || "",
      /upgrade-insecure-requests/
    );
    const contentSecurityPolicy = response.headers.get("content-security-policy") || "";
    assert.match(
      contentSecurityPolicy,
      /script-src 'self' https:\/\/cdn\.jsdelivr\.net https:\/\/challenges\.cloudflare\.com/
    );
    assert.doesNotMatch(contentSecurityPolicy, /script-src[^;]*'unsafe-inline'/);
    assert.match(html, /<title>TOPYKLY — Comunidad de temas y rankings en español<\/title>/);
    assert.match(html, /id="messageForm"/);
  });

  await test("refuses direct access to hidden files and private directories", async () => {
    for (const pathname of ["/.env", "/.git/config", "/.data/topykly.sqlite"]) {
      const response = await fetch(`${origin}${pathname}`);
      const text = await response.text();

      assert.equal(response.status, 400, pathname);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(response.headers.get("x-frame-options"), "DENY");
      assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
      assert.equal(text, "Invalid path");
    }
  });

  await test("refuses direct access to server-side source files", async () => {
    for (const pathname of [
      "/services/backend-store.js",
      "/services/preview-server.js",
      "/services/auth-service.js",
      "/scripts/backup-sqlite.mjs",
      "/tests/run.mjs",
      "/package.json"
    ]) {
      const response = await fetch(`${origin}${pathname}`);
      const text = await response.text();

      assert.equal(response.status, 400, pathname);
      assert.equal(text, "Invalid path");
    }

    const publicModule = await fetch(`${origin}/services/api.js`);
    const publicModuleText = await publicModule.text();

    assert.equal(publicModule.status, 200);
    assert.match(publicModuleText, /export const api/);
  });

  await test("rejects oversized JSON request bodies", async () => {
    const body = JSON.stringify({ text: "x".repeat(4 * 1024 * 1024) });
    const response = await fetch(`${origin}/api/topics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    });
    const payload = await response.json();

    assert.equal(response.status, 413);
    assert.equal(payload.error.code, "PAYLOAD_TOO_LARGE");
  });
  await test("blocks local fallback login in production", async () => {
    const isolatedPort = port + 1000;
    const isolatedOrigin = `http://${host}:${isolatedPort}`;
    const isolatedTempDir = await mkdtemp(path.join(os.tmpdir(), "topykly-smoke-prod-auth-"));
    const previousEnv = {
      NODE_ENV: process.env.NODE_ENV,
      TOPYKLY_OIDC_ISSUER: process.env.TOPYKLY_OIDC_ISSUER,
      TOPYKLY_OIDC_CLIENT_ID: process.env.TOPYKLY_OIDC_CLIENT_ID,
      TOPYKLY_OIDC_CLIENT_SECRET: process.env.TOPYKLY_OIDC_CLIENT_SECRET,
      TOPYKLY_SESSION_SECRET: process.env.TOPYKLY_SESSION_SECRET,
      TOPYKLY_TURNSTILE_SITE_KEY: process.env.TOPYKLY_TURNSTILE_SITE_KEY,
      TOPYKLY_TURNSTILE_SECRET_KEY: process.env.TOPYKLY_TURNSTILE_SECRET_KEY
    };
    let isolatedApp = null;

    process.env.NODE_ENV = "production";
    process.env.TOPYKLY_OIDC_ISSUER = "";
    process.env.TOPYKLY_OIDC_CLIENT_ID = "";
    process.env.TOPYKLY_OIDC_CLIENT_SECRET = "";
    process.env.TOPYKLY_SESSION_SECRET = "smoke-test-session-secret";
    process.env.TOPYKLY_TURNSTILE_SITE_KEY = "";
    process.env.TOPYKLY_TURNSTILE_SECRET_KEY = "";

    try {
      isolatedApp = startPreviewServer({
        port: isolatedPort,
        host,
        dbPath: path.join(isolatedTempDir, "topykly.sqlite"),
        log() {}
      });
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        try {
          const ready = await fetch(`${isolatedOrigin}/`);
          if (ready.ok) {
            break;
          }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      const response = await fetch(`${isolatedOrigin}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedTopicId: null })
      });
      const payload = await response.json();

      assert.equal(response.status, 503);
      assert.equal(payload.error.code, "AUTH_NOT_CONFIGURED");
    } finally {
      isolatedApp?.close();
      await rm(isolatedTempDir, { recursive: true, force: true });
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  await test("bootstraps guest session with active and visible topics", async () => {
    const payload = await request("/api/bootstrap", { sessionId: "session-smoke-bootstrap" });

    assert.equal(Object.prototype.hasOwnProperty.call(payload, "sessionId"), false);
    assert.match(cookieJars.get("session-smoke-bootstrap") || "", /topykly_sid=/);
    assert.equal(payload.topics.length, 40);
    assert.equal(payload.topics.filter((topic) => topic.visible).length, 20);
    assert.equal(payload.viewer.type, "guest");
    assert.equal(
      payload.users.every((user) => !Object.hasOwn(user, "email")),
      true
    );
  });

  await test("opens a topic and posts a comment through the HTTP route", async () => {
    const sessionId = "session-smoke-comment";
    const initial = await request("/api/bootstrap", { sessionId });
    const guestCookie = cookieJars.get(sessionId);
    registerVerifiedUserFixture({
      sessionId,
      email: `smoke-comment-${Date.now()}@example.com`,
      password: "password-segura",
      nickname: `smoke_c_${Date.now() % 100000}`
    });
    const registeredCookie = cookieJars.get(sessionId);

    assert.ok(guestCookie);
    assert.ok(registeredCookie);
    assert.notEqual(registeredCookie, guestCookie);

    const topic = initial.topics.find((entry) => entry.visible);
    const messageText = `Smoke comment ${Date.now()}`;

    assert.ok(topic, "Expected at least one visible topic.");

    const opened = await request(`/api/topics/${encodeURIComponent(topic.id)}`, { sessionId });
    assert.equal(opened.selectedTopicId, topic.id);

    const updated = await request(`/api/topics/${encodeURIComponent(topic.id)}/messages`, {
      method: "POST",
      sessionId,
      body: { text: messageText }
    });
    const updatedTopic = updated.topics.find((entry) => entry.id === topic.id);
    const lastMessage = updatedTopic.messages.at(-1);

    assert.equal(updatedTopic.title, topic.title);
    assert.equal(lastMessage.text, messageText);
    assert.equal(updated.topics[0].id, topic.id);
  });

  await test("creates a topic with a fixed root message", async () => {
    const sessionId = "session-smoke-create-topic";
    const title = `Smoke topic ${Date.now()}`;
    const text = "Smoke topic root message";

    registerVerifiedUserFixture({
      sessionId,
      email: `smoke-topic-${Date.now()}@example.com`,
      password: "password-segura",
      nickname: `smoke_t_${Date.now() % 100000}`
    });
    const created = await request("/api/topics", {
      method: "POST",
      sessionId,
      expectedStatus: 201,
      body: { title, text }
    });
    const topic = created.topics[0];

    assert.equal(topic.title, title);
    assert.equal(topic.messages[0].text, text);
    assert.equal(topic.messages[0].isRoot, true);
    assert.equal(created.selectedTopicId, topic.id);
  });

  await test("likes a message and returns the updated visible counter", async () => {
    const sessionId = "session-smoke-like";
    const title = `Smoke like topic ${Date.now()}`;
    const text = "Smoke like root message";

    registerVerifiedUserFixture({
      sessionId,
      email: `smoke-like-${Date.now()}@example.com`,
      password: "password-segura",
      nickname: `smoke_l_${Date.now() % 100000}`
    });
    const created = await request("/api/topics", {
      method: "POST",
      sessionId,
      expectedStatus: 201,
      body: { title, text }
    });
    const topic = created.topics[0];
    const message = topic.messages[0];

    assert.equal(message.likes, 0);

    const liked = await request(`/api/messages/${encodeURIComponent(message.id)}/like`, {
      method: "POST",
      sessionId,
      body: { selectedTopicId: topic.id }
    });
    const likedMessage = liked.topics
      .find((entry) => entry.id === topic.id)
      .messages.find((entry) => entry.id === message.id);

    assert.equal(likedMessage.likes, 1);
    assert.equal(likedMessage.likedByViewer, true);
  });

  await test("reports a topic and hydrates reported ids", async () => {
    const sessionId = "session-smoke-report";
    const initial = await request("/api/bootstrap", { sessionId });
    registerVerifiedUserFixture({
      sessionId,
      email: `smoke-comment-${Date.now()}@example.com`,
      password: "password-segura",
      nickname: `smoke_c_${Date.now() % 100000}`
    });

    const topic = initial.topics.find((entry) => entry.visible);

    const reported = await request("/api/reports", {
      method: "POST",
      sessionId,
      body: {
        entityType: "topic",
        entityId: topic.id,
        reason: "smoke-test",
        selectedTopicId: topic.id
      }
    });

    assert.ok(reported.reportedTopicIds.includes(topic.id));
  });

  await test("exposes safe auth preflight status", async () => {
    const status = await request("/api/auth/status", { sessionId: "session-smoke-auth-status" });

    assert.equal(typeof status.configured, "boolean");
    assert.equal(status.provider, "Google");
    assert.equal(status.redirectUri, `${origin}/auth/oidc/callback`);
    assert.equal(typeof status.checks.clientId, "boolean");
    assert.equal(typeof status.checks.clientSecret, "boolean");
    assert.equal(typeof status.checks.sessionSecret, "boolean");
    assert.equal(Object.prototype.hasOwnProperty.call(status, "clientSecret"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(status, "clientId"), false);
  });

  await test("supports auth login response for local fallback or external redirect", async () => {
    const sessionId = "session-smoke-auth";
    const login = await request("/api/auth/login", {
      method: "POST",
      sessionId,
      body: { selectedTopicId: null }
    });

    if (login.mode === "redirect") {
      assert.match(login.redirectUrl, /^https:\/\/accounts\.google\.com\//);
      assert.equal(login.provider, "Google");
      return;
    }

    assert.equal(login.viewer.type, "registered");

    const logout = await request("/api/auth/logout", {
      method: "POST",
      sessionId,
      body: { selectedTopicId: null }
    });

    assert.equal(logout.viewer.type, "guest");
  });
} finally {
  app.close();
  await rm(tempDir, { recursive: true, force: true });
}
