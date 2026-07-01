import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { startPreviewServer } from "../services/preview-server.js";

const host = "127.0.0.1";
const port = 4300 + Math.floor(Math.random() * 1000);
const origin = `http://${host}:${port}`;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "topykly-smoke-"));
const dbPath = path.join(tempDir, "topykly.sqlite");
const app = startPreviewServer({
  port,
  host,
  dbPath,
  log() {}
});

async function request(pathname, {
  method = "GET",
  sessionId = "session-smoke-guest",
  body = undefined,
  expectedStatus = 200
} = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-topykly-session-id": sessionId
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  assert.equal(response.status, expectedStatus, `${method} ${pathname}: ${text}`);
  return payload;
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
    assert.match(html, /<title>TOPYKLY<\/title>/);
    assert.match(html, /id="messageForm"/);
  });

  await test("bootstraps guest session with active and visible topics", async () => {
    const payload = await request("/api/bootstrap", { sessionId: "session-smoke-bootstrap" });

    assert.match(payload.sessionId, /^session-smoke-bootstrap$/);
    assert.equal(payload.topics.length, 40);
    assert.equal(payload.topics.filter((topic) => topic.visible).length, 20);
    assert.equal(payload.viewer.type, "guest");
  });

  await test("opens a topic and posts a comment through the HTTP route", async () => {
    const sessionId = "session-smoke-comment";
    const initial = await request("/api/bootstrap", { sessionId });
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

  await test("reports a topic and hydrates reported ids", async () => {
    const sessionId = "session-smoke-report";
    const initial = await request("/api/bootstrap", { sessionId });
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

    assert.equal(status.configured, false);
    assert.equal(status.provider, "Google");
    assert.equal(status.redirectUri, `${origin}/auth/oidc/callback`);
    assert.equal(status.checks.clientId, false);
    assert.equal(status.checks.clientSecret, false);
    assert.equal(Object.prototype.hasOwnProperty.call(status, "clientSecret"), false);
  });

  await test("supports local login and logout fallback", async () => {
    const sessionId = "session-smoke-auth";
    const login = await request("/api/auth/login", {
      method: "POST",
      sessionId,
      body: { selectedTopicId: null }
    });

    assert.equal(login.viewer.type, "registered");

    const logout = await request("/api/auth/logout", {
      method: "POST",
      sessionId: login.sessionId,
      body: { selectedTopicId: null }
    });

    assert.equal(logout.viewer.type, "guest");
  });
} finally {
  app.close();
  await rm(tempDir, { recursive: true, force: true });
}