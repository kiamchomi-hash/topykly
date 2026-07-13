import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createAuthService } from "./auth-service.js";
import { ApiError, createBackendStore, shouldSeedDemoData } from "./backend-store.js";
import {
  renderNotFoundPage,
  renderProfilePage,
  renderRobots,
  renderSitemap,
  renderTopicPage,
  renderTopicsIndexPage,
  resolvePublicOrigin,
  slugify,
  topicPath
} from "./seo-pages.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, "..");
const DEFAULT_GUEST_CLEANUP_INTERVAL_MS = 60 * 60_000;
const DEFAULT_REACTION_RESET_CHECK_INTERVAL_MS = 60 * 60_000;
const DEFAULT_HTTP_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_HTTP_RATE_LIMIT_MAX = 240;
const DEFAULT_HTTP_AUTH_RATE_LIMIT_MAX = 30;
const MAX_JSON_BODY_BYTES = 3 * 1024 * 1024;
const STRICT_TRANSPORT_SECURITY = "max-age=31536000; includeSubDomains";
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif"
};
const PUBLIC_SERVICE_MODULES = new Set([
  "api.js",
  "drawer-service.js",
  "palette-service.js",
  "seo-pages.js"
]);
const PROTECTED_STATIC_DIRECTORIES = new Set([
  "scripts",
  "tests",
  "node_modules",
  "output",
  "features"
]);
const PROTECTED_STATIC_ROOT_FILES = new Set([
  "package.json",
  "package-lock.json",
  "dashboard.html",
  "local-server.cjs",
  "dev-server.cjs",
  "vercel.json"
]);
const PROTECTED_STATIC_EXTENSIONS = new Set([".log", ".md", ".sqlite", ".env"]);

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

function isProductionHttpsRequest(req) {
  const runtimeEnvironment = String(process.env.VERCEL_ENV || process.env.NODE_ENV || "")
    .trim()
    .toLowerCase();
  if (runtimeEnvironment !== "production") {
    return false;
  }

  const forwardedProtocol = String(req?.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  return Boolean(req?.socket?.encrypted) || forwardedProtocol === "https";
}

function getSecurityHeaders({ includeCsp = true, req = null } = {}) {
  const headers = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin"
  };

  if (isProductionHttpsRequest(req)) {
    headers["Strict-Transport-Security"] = STRICT_TRANSPORT_SECURITY;
  }

  if (includeCsp) {
    headers["Content-Security-Policy"] = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://challenges.cloudflare.com",
      "frame-src https://challenges.cloudflare.com",
      "connect-src 'self' https://challenges.cloudflare.com https://accounts.google.com",
      "upgrade-insecure-requests"
    ].join("; ");
  }

  return headers;
}

function writePlainText(res, statusCode, text) {
  res.writeHead(statusCode, {
    ...getSecurityHeaders({ req: res.req }),
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(text)
  });
  res.end(text);
}
function sendHtml(res, req, statusCode, html, headers = {}) {
  const body = req.method === "HEAD" ? "" : html;
  res.writeHead(statusCode, {
    ...getSecurityHeaders({ includeCsp: true, req }),
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
    ...headers
  });
  res.end(body);
}

function sendJson(res, statusCode, payload, { headers = {}, cookies = [] } = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    ...getSecurityHeaders({ req: res.req }),
    "Cache-Control": "no-store",
    ...headers,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...(cookies.length ? { "Set-Cookie": cookies } : {})
  });
  res.end(body);
}

function sendRedirect(res, statusCode, location, { cookies = [] } = {}) {
  res.writeHead(statusCode, {
    ...getSecurityHeaders({ req: res.req }),
    "Location": location,
    ...(cookies.length ? { "Set-Cookie": cookies } : {})
  });
  res.end();
}

function readJsonBody(req, { maxBytes = MAX_JSON_BODY_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const contentLength = Number(req.headers["content-length"] || 0);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      req.resume();
      reject(new ApiError(413, "PAYLOAD_TOO_LARGE", "El cuerpo JSON supera el limite permitido."));
      return;
    }

    const chunks = [];
    let receivedBytes = 0;
    let settled = false;

    function cleanup() {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
    }

    function fail(error) {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    }

    function onData(chunk) {
      receivedBytes += chunk.length;
      if (receivedBytes > maxBytes) {
        fail(new ApiError(413, "PAYLOAD_TOO_LARGE", "El cuerpo JSON supera el limite permitido."));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    }

    function onEnd() {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      if (!chunks.length) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new ApiError(400, "INVALID_JSON", "El cuerpo JSON es invalido."));
      }
    }

    function onError(error) {
      fail(error);
    }

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
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

export function shouldTrustProxy(env = process.env) {
  return [env.TOPYKLY_TRUST_PROXY, env.CHETREND_TRUST_PROXY]
    .some((value) => ["1", "true", "yes"].includes(String(value || "").trim().toLowerCase()));
}

function getForwardedRequestIp(req) {
  return String(req.headers["cf-connecting-ip"] || "").trim()
    || String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
}

export function getRequestIp(req, env = process.env) {
  if (shouldTrustProxy(env)) {
    return getForwardedRequestIp(req)
      || req.socket.remoteAddress
      || "";
  }

  return req.socket.remoteAddress || "";
}

export function isRequestOriginAllowed(req, env = process.env) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method || "GET")) {
    return true;
  }

  const originHeader = String(req.headers.origin || "").trim();
  if (!originHeader) {
    return true;
  }

  let originHost;
  try {
    originHost = new URL(originHeader).host;
  } catch {
    return false;
  }

  const allowedHosts = new Set([String(req.headers.host || "").trim()]);
  const publicOrigin = String(env.TOPYKLY_PUBLIC_ORIGIN || env.CHETREND_PUBLIC_ORIGIN || "").trim();
  if (publicOrigin) {
    try {
      allowedHosts.add(new URL(publicOrigin).host);
    } catch {
      // ignore malformed configured origin
    }
  }
  allowedHosts.delete("");

  return allowedHosts.has(originHost);
}

function getRequestContext(req) {
  const cookies = readCookies(req);

  return {
    sessionId: cookies.topykly_sid
      || cookies.chetrend_sid
      || "",
    ipAddress: getRequestIp(req),
    cookies
  };
}

function normalizeSelectedTopicId(url) {
  return url.searchParams.get("selectedTopicId") || null;
}

export function isLocalDevLoginAllowed(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || "").trim().toLowerCase();
  const explicitFlag = String(env.TOPYKLY_ALLOW_LOCAL_LOGIN || env.CHETREND_ALLOW_LOCAL_LOGIN || "").trim().toLowerCase();
  if (["0", "false", "no"].includes(explicitFlag)) {
    return false;
  }

  return nodeEnv !== "production";
}

function safeFilePathFromUrl(urlPathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPathname);
  } catch {
    return null;
  }

  const requestedPath = decoded === "/" ? "/index.html" : decoded;
  const segments = requestedPath.split(/[/\\]/).filter(Boolean);
  if (segments.some((segment) => segment.startsWith("."))) {
    return null;
  }
  if (segments[0] === "services" && !PUBLIC_SERVICE_MODULES.has(segments[1] || "")) {
    return null;
  }
  if (PROTECTED_STATIC_DIRECTORIES.has(segments[0] || "")) {
    return null;
  }
  if (segments.length === 1 && PROTECTED_STATIC_ROOT_FILES.has(segments[0] || "")) {
    return null;
  }
  const lastSegment = segments[segments.length - 1] || "";
  if (PROTECTED_STATIC_EXTENSIONS.has(path.extname(lastSegment).toLowerCase())) {
    return null;
  }
  const normalized = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.join(root, normalized);
  const relativePath = path.relative(root, absolutePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  return absolutePath;
}

function stripPrivateSessionPayload(payload) {
  if (!payload || typeof payload !== "object" || !("sessionId" in payload)) {
    return payload;
  }

  const { sessionId, ...publicPayload } = payload;
  return publicPayload;
}

function sendBackendPayload(res, req, authService, statusCode, payload) {
  sendJson(res, statusCode, stripPrivateSessionPayload(payload), {
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
        selectedTopicId: normalizeSelectedTopicId(url),
        profileNickname: url.searchParams.get("perfil") || null
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
      await authService.validateTurnstile({
        req,
        token: body.turnstileToken
      });
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

      if (!isLocalDevLoginAllowed()) {
        throw new ApiError(503, "AUTH_NOT_CONFIGURED", "La autenticacion externa no esta configurada.");
      }

      sendBackendPayload(res, req, authService, 200, store.login({
        ...context,
        selectedTopicId: body.selectedTopicId ?? null,
        rotateSession: true
      }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/password/login") {
      const body = await readJsonBody(req);
      await authService.validateTurnstile({
        req,
        token: body.turnstileToken
      });
      sendBackendPayload(res, req, authService, 200, store.loginWithPassword({
        ...context,
        email: body.email,
        password: body.password,
        selectedTopicId: body.selectedTopicId ?? null,
        rotateSession: true
      }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/password/reset/request") {
      const body = await readJsonBody(req);
      await authService.validateTurnstile({
        req,
        token: body.turnstileToken
      });
      if (!authService.getStatus(req)?.emailCode?.configured) {
        throw new ApiError(503, "RESEND_NOT_CONFIGURED", "La recuperacion por email todavia no esta configurada.");
      }
      const challenge = store.createPasswordResetChallenge({
        email: body.email,
        ipAddress: context.ipAddress
      });

      if (challenge.deliveryRequired) {
        try {
          await authService.sendEmailCode({
            ...challenge,
            purpose: "password_reset"
          });
        } catch {
          store.discardPasswordResetChallenge(challenge.challengeId);
          console.error("Password reset email delivery failed.");
        }
      }

      sendJson(res, 202, {
        challengeId: challenge.challengeId,
        expiresInSeconds: challenge.expiresInSeconds,
        message: "Si existe una cuenta con ese email, enviamos un codigo de recuperacion."
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/password/reset/confirm") {
      const body = await readJsonBody(req);
      sendBackendPayload(res, req, authService, 200, store.verifyPasswordResetChallenge({
        ...context,
        challengeId: body.challengeId,
        code: body.code,
        newPassword: body.newPassword,
        selectedTopicId: body.selectedTopicId ?? null,
        rotateSession: true
      }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/account-link/start") {
      const body = await readJsonBody(req);
      await authService.validateTurnstile({
        req,
        token: body.turnstileToken
      });
      const target = store.prepareIdentityLink({
        ...context,
        password: body.password
      });
      const linkResponse = await authService.createLoginResponse({
        req,
        sessionId: target.sessionId,
        selectedTopicId: body.selectedTopicId ?? null,
        purpose: "link",
        targetUserId: target.userId,
        expectedEmail: target.email
      });
      if (!linkResponse) {
        throw new ApiError(503, "AUTH_NOT_CONFIGURED", "La autenticacion externa no esta configurada.");
      }
      sendJson(res, 200, linkResponse.payload, {
        cookies: linkResponse.cookies
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/email/request-code") {
      const body = await readJsonBody(req);
      await authService.validateTurnstile({
        req,
        token: body.turnstileToken
      });
      const challenge = store.createEmailAuthChallenge({
        email: body.email,
        nickname: body.nickname,
        age: body.age,
        password: body.password,
        acceptedTerms: body.acceptedTerms === true,
        termsVersion: body.termsVersion
      });

      try {
        await authService.sendEmailCode(challenge);
      } catch (error) {
        store.discardEmailAuthChallenge(challenge.challengeId);
        throw error;
      }

      sendJson(res, 202, {
        challengeId: challenge.challengeId,
        email: challenge.email,
        expiresInSeconds: challenge.expiresInSeconds
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/email/verify-code") {
      const body = await readJsonBody(req);
      sendBackendPayload(res, req, authService, 200, store.verifyEmailAuthChallenge({
        ...context,
        challengeId: body.challengeId,
        code: body.code,
        selectedTopicId: body.selectedTopicId ?? null,
        rotateSession: true
      }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/password/register") {
      throw new ApiError(
        410,
        "REGISTRATION_REQUIRES_EMAIL_VERIFICATION",
        "Para crear una cuenta debes verificar el codigo enviado a tu email."
      );
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
        username: body.username,
        age: body.age,
        acceptedTerms: body.acceptedTerms === true,
        termsVersion: body.termsVersion,
        description: body.description,
        profileShowDescription: body.profileShowDescription !== false,
        profileShowJoinedAt: body.profileShowJoinedAt !== false,
        socialWhatsapp: body.socialWhatsapp,
        socialInstagram: body.socialInstagram,
        socialTiktok: body.socialTiktok,
        socialFacebook: body.socialFacebook,
        socialTwitter: body.socialTwitter,
        socialDiscord: body.socialDiscord,
        profileShowSocial: body.profileShowSocial !== false,
        profileIndexable: typeof body.profileIndexable === "boolean" ? body.profileIndexable : null,
        avatarDataUrl: body.avatarDataUrl,
        removeAvatar: body.removeAvatar === true,
        selectedTopicId: body.selectedTopicId ?? null
      }));
      return;
    }

    if (req.method === "PATCH" && url.pathname === "/api/settings") {
      const body = await readJsonBody(req);
      sendBackendPayload(res, req, authService, 200, store.updateSettings({
        ...context,
        likesAnonymous: typeof body.likesAnonymous === "boolean" ? body.likesAnonymous : null,
        filterProfanity: typeof body.filterProfanity === "boolean" ? body.filterProfanity : null,
        notificationsFriendsOnly: typeof body.notificationsFriendsOnly === "boolean" ? body.notificationsFriendsOnly : null,
        profileIndexable: typeof body.profileIndexable === "boolean" ? body.profileIndexable : null,
        selectedTopicId: body.selectedTopicId ?? null
      }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/account/delete") {
      const body = await readJsonBody(req);
      sendBackendPayload(res, req, authService, 200, store.deleteAccount({
        ...context,
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

    if (req.method === "POST" && url.pathname.startsWith("/api/messages/") && (url.pathname.endsWith("/like") || url.pathname.endsWith("/dislike"))) {
      const segments = url.pathname.split("/").filter(Boolean);
      const messageId = segments[2] || "";
      const body = await readJsonBody(req);
      const action = url.pathname.endsWith("/dislike") ? "toggleMessageDislike" : "toggleMessageLike";
      sendBackendPayload(res, req, authService, 200, store[action](messageId, {
        ...context,
        selectedTopicId: body.selectedTopicId ?? null
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


    if (req.method === "POST" && url.pathname.startsWith("/api/friends/")) {
      const segments = url.pathname.split("/").filter(Boolean);
      const userId = segments[2] || "";
      const action = segments[3] || "";
      const body = await readJsonBody(req);
      const methodByAction = {
        request: "sendFriendRequest",
        accept: "acceptFriendRequest",
        reject: "rejectFriendRequest"
      };
      const storeMethod = methodByAction[action];
      if (!storeMethod || typeof store[storeMethod] !== "function") {
        throw new ApiError(404, "NOT_FOUND", "Ruta API no encontrada.");
      }
      sendBackendPayload(res, req, authService, 200, store[storeMethod](userId, {
        ...context,
        selectedTopicId: body.selectedTopicId ?? null
      }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/admin/dashboard") {
      sendJson(res, 200, store.getAdminDashboard({
        ...context,
        reportPage: url.searchParams.get("reportPage"),
        reportLimit: url.searchParams.get("reportLimit"),
        avatarPage: url.searchParams.get("avatarPage"),
        avatarLimit: url.searchParams.get("avatarLimit")
      }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/moderation/reports") {
      sendJson(res, 200, store.listReports({
        ...context,
        reportPage: url.searchParams.get("reportPage"),
        reportLimit: url.searchParams.get("reportLimit")
      }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/moderation/actions") {
      const body = await readJsonBody(req);
      sendBackendPayload(res, req, authService, 200, store.applyModerationAction(body.actionType, {
        ...context,
        targetType: body.targetType,
        targetId: body.targetId,
        reason: body.reason,
        banHours: body.banHours,
        selectedTopicId: body.selectedTopicId ?? null
      }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/diagnostics") {
      sendJson(res, 200, store.getDiagnosticsForViewer(context));
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

    console.error("API request failed:", error);
    sendJson(res, 500, {
      error: {
        code: "INTERNAL_ERROR",
        message: "Error interno del servidor."
      }
    });
  }
}

async function handleAuthCallback(store, authService, req, res, url) {
  const query = Object.fromEntries(url.searchParams.entries());
  let callback = null;

  try {
    callback = await authService.handleCallback({
      req,
      cookies: readCookies(req),
      query
    });

    if (callback.identity) {
      if (callback.purpose === "link") {
        store.completeIdentityLink({
          sessionId: callback.sessionId,
          sourceSessionId: callback.sourceSessionId,
          targetUserId: callback.targetUserId,
          expectedEmail: callback.expectedEmail,
          selectedTopicId: callback.selectedTopicId,
          ipAddress: getRequestContext(req).ipAddress,
          ...callback.identity
        });
      } else {
        store.loginWithIdentity({
          sessionId: callback.sessionId,
          sourceSessionId: callback.sourceSessionId,
          selectedTopicId: callback.selectedTopicId,
          ipAddress: getRequestContext(req).ipAddress,
          ...callback.identity
        });
      }
    }

    sendRedirect(res, 302, callback.redirectUrl, {
      cookies: callback.cookies
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const redirectUrl = new URL("/", url);
      redirectUrl.searchParams.set("authError", error.code || "AUTH_FAILED");
      if (callback?.selectedTopicId) {
        redirectUrl.searchParams.set("selectedTopicId", callback.selectedTopicId);
      }
      if (error.code === "ACCOUNT_LINK_REQUIRED") {
        redirectUrl.searchParams.set("authAction", "link-account");
      }
      sendRedirect(res, 302, redirectUrl.toString(), {
        cookies: authService.clearFlowCookies(req)
      });
      return;
    }

    throw error;
  }
}

function handleAvatarRequest(res, url, avatarStorageDir) {
  const fileName = path.basename(decodeURIComponent(url.pathname));
  if (!fileName || url.pathname !== `/avatars/${fileName}`) {
    writePlainText(res, 400, "Invalid path");
    return;
  }

  const resolvedFilePath = path.join(avatarStorageDir, fileName);
  fs.readFile(resolvedFilePath, (error, data) => {
    if (error) {
      writePlainText(res, 404, "Not found");
      return;
    }

    res.writeHead(200, {
      ...getSecurityHeaders({ includeCsp: false, req: res.req }),
      "Content-Type": mime[path.extname(resolvedFilePath)] || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable"
    });
    res.end(data);
  });
}

function readPositiveNumber(value, fallback) {
  const parsed = Number(String(value || "").trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function resolveHttpRateLimitConfig(env = process.env) {
  return {
    windowMs: readPositiveNumber(env.TOPYKLY_HTTP_RATE_LIMIT_WINDOW_MS || env.CHETREND_HTTP_RATE_LIMIT_WINDOW_MS, DEFAULT_HTTP_RATE_LIMIT_WINDOW_MS),
    max: readPositiveNumber(env.TOPYKLY_HTTP_RATE_LIMIT_MAX || env.CHETREND_HTTP_RATE_LIMIT_MAX, DEFAULT_HTTP_RATE_LIMIT_MAX),
    authMax: readPositiveNumber(env.TOPYKLY_HTTP_AUTH_RATE_LIMIT_MAX || env.CHETREND_HTTP_AUTH_RATE_LIMIT_MAX, DEFAULT_HTTP_AUTH_RATE_LIMIT_MAX)
  };
}

function getHttpRateLimitScope(url) {
  if (
    url.pathname === "/auth/oidc/callback"
    || url.pathname.startsWith("/api/auth/")
  ) {
    return "auth";
  }

  return "api";
}

function checkHttpRateLimit(buckets, req, url, config, nowMs = Date.now()) {
  if (!config.windowMs || (!config.max && !config.authMax)) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const scope = getHttpRateLimitScope(url);
  const limit = scope === "auth" ? config.authMax : config.max;
  if (!limit) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const ipAddress = getRequestIp(req) || "unknown";
  const key = `${scope}:${ipAddress}`;
  const existing = buckets.get(key);
  const resetAt = existing?.resetAt && existing.resetAt > nowMs
    ? existing.resetAt
    : nowMs + config.windowMs;
  const count = existing?.resetAt && existing.resetAt > nowMs
    ? existing.count + 1
    : 1;

  buckets.set(key, { count, resetAt });

  for (const [bucketKey, bucket] of buckets) {
    if (bucket.resetAt <= nowMs) {
      buckets.delete(bucketKey);
    }
  }

  if (count <= limit) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - nowMs) / 1000))
  };
}

function enforceHttpRateLimit(res, buckets, req, url, config) {
  const result = checkHttpRateLimit(buckets, req, url, config);
  if (result.allowed) {
    return true;
  }

  sendJson(res, 429, {
    error: {
      code: "RATE_LIMITED",
      message: "Demasiadas solicitudes. Intenta nuevamente en unos segundos.",
      retryAfterSeconds: result.retryAfterSeconds
    }
  }, {
    headers: {
      "Retry-After": String(result.retryAfterSeconds)
    }
  });
  return false;
}
function resolveGuestCleanupIntervalMs(env = process.env) {
  const rawValue = String(env.TOPYKLY_GUEST_CLEANUP_INTERVAL_MS || env.CHETREND_GUEST_CLEANUP_INTERVAL_MS || "").trim();
  if (!rawValue) {
    return DEFAULT_GUEST_CLEANUP_INTERVAL_MS;
  }

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function runGuestCleanup(store, log) {
  try {
    const result = store.cleanupInactiveGuests();
    if (result.deletedSessions || result.deletedGuestIpRateLimits) {
      log(`guest cleanup removed ${result.deletedSessions} sessions and ${result.deletedGuestIpRateLimits} rate-limit rows`);
    }
  } catch (error) {
    log(`guest cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function resolveReactionResetCheckIntervalMs(env = process.env) {
  const rawValue = String(env.TOPYKLY_REACTION_RESET_CHECK_INTERVAL_MS || "").trim();
  if (!rawValue) {
    return DEFAULT_REACTION_RESET_CHECK_INTERVAL_MS;
  }

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function runMessageReactionReset(store, log) {
  try {
    const result = store.resetDailyMessageReactions();
    if (result.reset) {
      log(`message reactions reset for ${result.resetDay}: ${result.deletedLikes} likes and ${result.deletedDislikes} dislikes removed`);
    }
  } catch (error) {
    log(`message reaction reset failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const SITEMAP_CACHE_TTL_MS = 5 * 60_000;

function sendTextResource(res, req, body, contentType, cacheControl) {
  res.writeHead(200, {
    ...getSecurityHeaders({ req }),
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": cacheControl
  });
  res.end(req.method === "HEAD" ? "" : body);
}

function buildSitemapXml(store) {
  const origin = resolvePublicOrigin();
  const entries = [
    { loc: `${origin}/` },
    { loc: `${origin}/temas` },
    { loc: `${origin}/terms.html` }
  ];
  store.getSeoTopicEntries()
    .filter((topic) => !topic.isThin)
    .forEach((topic) => {
      entries.push({ loc: `${origin}${topicPath(topic)}`, lastmod: topic.lastActivityAt });
    });
  store.getSeoProfileEntries().forEach((profile) => {
    entries.push({ loc: `${origin}/u/${encodeURIComponent(profile.nickname)}`, lastmod: profile.lastmod });
  });
  return renderSitemap(entries);
}

function isSeoPagePath(pathname) {
  return pathname === "/temas"
    || pathname === "/tema"
    || pathname.startsWith("/tema/")
    || pathname === "/u"
    || pathname.startsWith("/u/");
}

function handleSeoPageRequest(store, req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    writePlainText(res, 405, "Method not allowed");
    return;
  }

  const userAgent = req.headers["user-agent"] || "";
  const isBot = /googlebot|bingbot|yandex|baiduspider|duckduckbot|yahoo|twitterbot|facebookexternalhit|discordbot|slackbot|lighthouse|telegrambot|embedly|quora link preview|outbrain|vkshare|pinterest|slack-imgproxy/i.test(userAgent);
  const isBrowser = /mozilla|chrome|safari|firefox|edge|mobile/i.test(userAgent);

  if (isBrowser && !isBot) {
    if (url.pathname === "/temas" || url.pathname === "/tema" || url.pathname === "/u") {
      sendRedirect(res, 302, "/");
      return;
    }
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] === "tema") {
      let topicId = "";
      try {
        topicId = decodeURIComponent(segments[1] || "");
      } catch {
        topicId = "";
      }
      if (topicId) {
        sendRedirect(res, 302, `/?selectedTopicId=${encodeURIComponent(topicId)}`);
        return;
      }
    }
    if (segments[0] === "u") {
      let nickname = "";
      try {
        nickname = decodeURIComponent(segments[1] || "");
      } catch {
        nickname = "";
      }
      if (nickname) {
        sendRedirect(res, 302, `/?perfil=${encodeURIComponent(nickname)}`);
        return;
      }
    }
  }

  const origin = resolvePublicOrigin();

  if (url.pathname === "/tema") {
    sendRedirect(res, 301, "/temas");
    return;
  }

  if (url.pathname === "/temas") {
    sendHtml(res, req, 200, renderTopicsIndexPage(store.getSeoTopicEntries(), { origin }), {
      "Cache-Control": "public, max-age=300"
    });
    return;
  }

  const segments = url.pathname.split("/").filter(Boolean);

  if (segments[0] === "u") {
    let nickname = "";
    try {
      nickname = decodeURIComponent(segments[1] || "");
    } catch {
      nickname = "";
    }
    if (!nickname || segments.length > 2) {
      sendHtml(res, req, 404, renderNotFoundPage());
      return;
    }

    let profile;
    try {
      profile = store.getPublicProfileByNickname(nickname);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        sendHtml(res, req, 404, renderNotFoundPage());
        return;
      }
      throw error;
    }

    if (profile.nickname !== nickname) {
      sendRedirect(res, 301, `/u/${encodeURIComponent(profile.nickname)}`);
      return;
    }

    sendHtml(res, req, 200, renderProfilePage(profile, { origin }), {
      "Cache-Control": "public, max-age=300",
      ...(profile.indexable ? {} : { "X-Robots-Tag": "noindex" })
    });
    return;
  }

  let topicId = "";
  let requestedSlug = "";
  try {
    topicId = decodeURIComponent(segments[1] || "");
    requestedSlug = decodeURIComponent(segments.slice(2).join("/"));
  } catch {
    sendHtml(res, req, 404, renderNotFoundPage());
    return;
  }

  let topic;
  try {
    topic = store.getTopicPageData(topicId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      sendHtml(res, req, 404, renderNotFoundPage());
      return;
    }
    throw error;
  }

  const canonicalSlug = slugify(topic.title);
  if (requestedSlug !== canonicalSlug) {
    const canonicalPath = canonicalSlug
      ? `/tema/${encodeURIComponent(topic.id)}/${canonicalSlug}`
      : `/tema/${encodeURIComponent(topic.id)}`;
    sendRedirect(res, 301, canonicalPath);
    return;
  }

  sendHtml(res, req, 200, renderTopicPage(topic, { origin }), {
    "Cache-Control": "public, max-age=60"
  });
}

function handleStaticRequest(req, res, url, store) {
  if (url.pathname.startsWith("/avatars/")) {
    handleAvatarRequest(res, url, store.avatarStorageDir);
    return;
  }
  const filePath = safeFilePathFromUrl(url.pathname);
  if (!filePath) {
    writePlainText(res, 400, "Invalid path");
    return;
  }

  const resolvedFilePath = url.pathname === "/favicon.ico"
    ? path.join(root, "favicon.svg")
    : filePath;

  fs.readFile(resolvedFilePath, (error, data) => {
    if (error) {
      writePlainText(res, 404, "Not found");
      return;
    }

    const contentType = mime[path.extname(resolvedFilePath)] || "application/octet-stream";
    const extension = path.extname(resolvedFilePath);
    const cacheControl = [".html", ".js", ".css"].includes(extension)
      ? "no-store, max-age=0"
      : "public, max-age=3600";
    res.writeHead(200, {
      ...getSecurityHeaders({ includeCsp: extension === ".html", req: res.req }),
      "Content-Type": contentType,
      "Cache-Control": cacheControl
    });
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
  const nodeEnv = String(process.env.NODE_ENV || "").trim().toLowerCase();
  const sessionSecret = String(process.env.TOPYKLY_SESSION_SECRET || process.env.CHETREND_SESSION_SECRET || "").trim();
  if (nodeEnv === "production" && !sessionSecret) {
    throw new Error("TOPYKLY_SESSION_SECRET es obligatorio cuando NODE_ENV=production.");
  }
  if (isLocalDevLoginAllowed()) {
    log("ADVERTENCIA: login local sin contraseña habilitado porque NODE_ENV no es \"production\". No usar esta configuración en producción.");
  }
  const store = createBackendStore({
    dbPath,
    seedDemoData: shouldSeedDemoData(process.env, false)
  });
  const authService = createAuthService();
  const httpRateLimitConfig = resolveHttpRateLimitConfig();
  const httpRateLimitBuckets = new Map();
  const sitemapCache = { xml: null, expiresAt: 0 };
  const guestCleanupIntervalMs = resolveGuestCleanupIntervalMs();
  const reactionResetCheckIntervalMs = resolveReactionResetCheckIntervalMs();
  const guestCleanupTimer = guestCleanupIntervalMs > 0
    ? setInterval(() => runGuestCleanup(store, log), guestCleanupIntervalMs)
    : null;
  guestCleanupTimer?.unref?.();
  const reactionResetTimer = reactionResetCheckIntervalMs > 0
    ? setInterval(() => runMessageReactionReset(store, log), reactionResetCheckIntervalMs)
    : null;
  reactionResetTimer?.unref?.();
  runGuestCleanup(store, log);
  runMessageReactionReset(store, log);
  const server = http.createServer(async (req, res) => {
    // The app is strictly same-origin: no CORS headers are ever granted.
    if (req.method === "OPTIONS") {
      res.writeHead(204, getSecurityHeaders({ includeCsp: false, req }));
      res.end();
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);

      if (url.pathname === "/auth/oidc/callback") {
        if (!enforceHttpRateLimit(res, httpRateLimitBuckets, req, url, httpRateLimitConfig)) {
          return;
        }
        await handleAuthCallback(store, authService, req, res, url);
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        if (!enforceHttpRateLimit(res, httpRateLimitBuckets, req, url, httpRateLimitConfig)) {
          return;
        }
        if (!isRequestOriginAllowed(req)) {
          sendJson(res, 403, {
            error: {
              code: "ORIGIN_NOT_ALLOWED",
              message: "Origen no permitido."
            }
          });
          return;
        }
        await handleApiRequest(store, authService, req, res, url);
        return;
      }

      if (url.pathname === "/robots.txt") {
        sendTextResource(
          res,
          req,
          renderRobots({ origin: resolvePublicOrigin() }),
          "text/plain; charset=utf-8",
          "public, max-age=3600"
        );
        return;
      }

      if (url.pathname === "/sitemap.xml") {
        if (!sitemapCache.xml || Date.now() >= sitemapCache.expiresAt) {
          sitemapCache.xml = buildSitemapXml(store);
          sitemapCache.expiresAt = Date.now() + SITEMAP_CACHE_TTL_MS;
        }
        sendTextResource(
          res,
          req,
          sitemapCache.xml,
          "application/xml; charset=utf-8",
          "public, max-age=300"
        );
        return;
      }

      if (isSeoPagePath(url.pathname)) {
        if (!enforceHttpRateLimit(res, httpRateLimitBuckets, req, url, httpRateLimitConfig)) {
          return;
        }
        handleSeoPageRequest(store, req, res, url);
        return;
      }

      handleStaticRequest(req, res, url, store);
    } catch (error) {
      console.error("Request failed:", error);
      sendJson(res, 500, {
        error: {
          code: "INTERNAL_ERROR",
          message: "Error interno del servidor."
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
      if (guestCleanupTimer) {
        clearInterval(guestCleanupTimer);
      }
      if (reactionResetTimer) {
        clearInterval(reactionResetTimer);
      }
      server.close();
      store.close();
    }
  };
}
