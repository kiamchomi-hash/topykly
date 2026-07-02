import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createAuthService } from "./auth-service.js";
import { ApiError, createBackendStore } from "./backend-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, "..");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, "utf8");
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) {
      return;
    }

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  });
}

function sendJson(res, statusCode, payload, { headers = {}, cookies = [] } = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    ...headers,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...(cookies.length ? { "Set-Cookie": cookies } : {})
  });
  res.end(body);
}

function sendRedirect(res, statusCode, location, { cookies = [] } = {}) {
  res.writeHead(statusCode, {
    "Location": location,
    ...(cookies.length ? { "Set-Cookie": cookies } : {})
  });
  res.end();
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new ApiError(400, "INVALID_JSON", "El cuerpo JSON es invalido."));
      }
    });
    req.on("error", reject);
  });
}

function readCookies(req) {
  return String(req.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex === -1) {
        return cookies;
      }

      const name = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      cookies[name] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function getRequestContext(req) {
  const cookies = readCookies(req);
  const forwardedFor = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();

  return {
    sessionId: cookies.topykly_sid
      || cookies.chetrend_sid
      || req.headers["x-topykly-session-id"]
      || req.headers["x-chetrend-session-id"]
      || "",
    ipAddress: forwardedFor || req.socket.remoteAddress || "",
    cookies
  };
}

function normalizeSelectedTopicId(url) {
  return url.searchParams.get("selectedTopicId") || null;
}

function safeFilePathFromUrl(urlPathname) {
  const decoded = decodeURIComponent(urlPathname);
  const requestedPath = decoded === "/" ? "/index.html" : decoded;
  const normalized = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.join(root, normalized);

  if (!absolutePath.startsWith(root)) {
    return null;
  }

  return absolutePath;
}

function sendBackendPayload(res, req, authService, statusCode, payload) {
  sendJson(res, statusCode, payload, {
    cookies: payload?.sessionId
      ? [authService.createSessionCookie(req, payload.sessionId)]
      : []
  });
}

async function handleApiRequest(store, authService, req, res, url) {
  const context = getRequestContext(req);

  try {
    if (req.method === "GET" && url.pathname === "/api/bootstrap") {
      sendBackendPayload(res, req, authService, 200, store.bootstrap({
        ...context,
        selectedTopicId: normalizeSelectedTopicId(url)
      }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/topics") {
      sendBackendPayload(res, req, authService, 200, store.refresh({
        ...context,
        selectedTopicId: normalizeSelectedTopicId(url)
      }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/auth/status") {
      sendJson(res, 200, authService.getStatus(req));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      const body = await readJsonBody(req);
      const authLoginResponse = await authService.createLoginResponse({
        req,
        sessionId: context.sessionId,
        selectedTopicId: body.selectedTopicId ?? null
      });
      if (authLoginResponse) {
        sendJson(res, 200, authLoginResponse.payload, {
          cookies: authLoginResponse.cookies
        });
        return;
      }

      sendBackendPayload(res, req, authService, 200, store.login({
        ...context,
        selectedTopicId: body.selectedTopicId ?? null
      }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      const body = await readJsonBody(req);
      sendBackendPayload(res, req, authService, 200, store.logout({
        ...context,
        selectedTopicId: body.selectedTopicId ?? null
      }));
      return;
    }

    if (req.method === "PATCH" && url.pathname === "/api/profile") {
      const body = await readJsonBody(req);
      sendBackendPayload(res, req, authService, 200, store.updateProfile({
        ...context,
        displayName: body.displayName,
        avatarDataUrl: body.avatarDataUrl,
        selectedTopicId: body.selectedTopicId ?? null
      }));
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/topics/")) {
      const topicId = url.pathname.split("/").pop() || "";
      sendBackendPayload(res, req, authService, 200, store.openTopic(topicId, context));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/topics") {
      const body = await readJsonBody(req);
      sendBackendPayload(res, req, authService, 201, store.createTopic({
        ...context,
        title: body.title,
        text: body.text
      }));
      return;
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/topics/") && url.pathname.endsWith("/messages")) {
      const segments = url.pathname.split("/").filter(Boolean);
      const topicId = segments[2] || "";
      const body = await readJsonBody(req);
      sendBackendPayload(res, req, authService, 200, store.addMessage(topicId, {
        ...context,
        text: body.text
      }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/reports") {
      const body = await readJsonBody(req);
      sendBackendPayload(res, req, authService, 200, store.reportEntity(body.entityType, body.entityId, {
        ...context,
        reason: body.reason,
        selectedTopicId: body.selectedTopicId ?? null
      }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/moderation/reports") {
      sendJson(res, 200, store.listReports(context));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/moderation/actions") {
      const body = await readJsonBody(req);
      sendBackendPayload(res, req, authService, 200, store.applyModerationAction(body.actionType, {
        ...context,
        targetType: body.targetType,
        targetId: body.targetId,
        reason: body.reason,
        selectedTopicId: body.selectedTopicId ?? null
      }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/diagnostics") {
      sendJson(res, 200, store.getDiagnostics());
      return;
    }

    throw new ApiError(404, "NOT_FOUND", "Ruta API no encontrada.");
  } catch (error) {
    if (error instanceof ApiError) {
      sendJson(res, error.status, {
        error: {
          code: error.code,
          message: error.message,
          ...error.details
        }
      });
      return;
    }

    sendJson(res, 500, {
      error: {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Error interno del servidor."
      }
    });
  }
}

async function handleAuthCallback(store, authService, req, res, url) {
  const query = Object.fromEntries(url.searchParams.entries());

  try {
    const callback = await authService.handleCallback({
      req,
      cookies: readCookies(req),
      query
    });

    if (callback.identity) {
      store.loginWithIdentity({
        sessionId: callback.sessionId,
        sourceSessionId: callback.sourceSessionId,
        selectedTopicId: callback.selectedTopicId,
        ipAddress: getRequestContext(req).ipAddress,
        ...callback.identity
      });
    }

    sendRedirect(res, 302, callback.redirectUrl, {
      cookies: callback.cookies
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const redirectUrl = new URL("/", url);
      redirectUrl.searchParams.set("authError", error.code || "AUTH_FAILED");
      sendRedirect(res, 302, redirectUrl.toString());
      return;
    }

    throw error;
  }
}

function handleStaticRequest(req, res, url) {
  const filePath = safeFilePathFromUrl(url.pathname);
  if (!filePath) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Invalid path");
    return;
  }

  const resolvedFilePath = url.pathname === "/favicon.ico"
    ? path.join(root, "favicon.svg")
    : filePath;

  fs.readFile(resolvedFilePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const contentType = mime[path.extname(resolvedFilePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

export function startPreviewServer({
  port,
  host = "127.0.0.1",
  log = console.log,
  dbPath
}) {
  loadEnvFile(path.join(root, ".env"));
  const store = createBackendStore({ dbPath });
  const authService = createAuthService();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);

      if (url.pathname === "/auth/oidc/callback") {
        await handleAuthCallback(store, authService, req, res, url);
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        await handleApiRequest(store, authService, req, res, url);
        return;
      }

      handleStaticRequest(req, res, url);
    } catch (error) {
      sendJson(res, 500, {
        error: {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Error interno del servidor."
        }
      });
    }
  });

  server.listen(port, host, () => {
    log(`preview listening on http://${host}:${port}`);
  });

  return {
    server,
    store,
    close() {
      server.close();
      store.close();
    }
  };
}
