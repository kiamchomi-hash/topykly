import crypto from "node:crypto";

import { ApiError } from "./backend-store.js";

const AUTH_FLOW_COOKIE = "topykly_auth_flow";
const LEGACY_AUTH_FLOW_COOKIE = "chetrend_auth_flow";
const SESSION_COOKIE = "topykly_sid";
const AUTH_FLOW_TTL_MS = 10 * 60_000;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const DISCOVERY_CACHE_TTL_MS = 10 * 60_000;
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64");
}

function createRandomToken(byteLength = 32) {
  return base64UrlEncode(crypto.randomBytes(byteLength));
}

function createSha256Base64Url(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""), "utf8")
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function normalizeOrigin(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function normalizeIssuer(value) {
  return normalizeOrigin(value);
}

function normalizeEmail(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || null;
}

function normalizeImageUrl(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeDisplayName(profile) {
  const candidates = [
    profile?.name,
    profile?.preferred_username,
    profile?.given_name,
    profile?.nickname,
    profile?.email ? String(profile.email).split("@")[0] : "",
    "Usuario"
  ];

  for (const candidate of candidates) {
    const normalized = String(candidate || "").trim().replace(/\s+/g, " ");
    if (normalized) {
      return normalized.slice(0, 80);
    }
  }

  return "Usuario";
}

function parseJsonResponse(text) {
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function signPayload(payload, secret) {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", secret)
    .update(encodedPayload, "utf8")
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${encodedPayload}.${signature}`;
}

function verifySignedPayload(token, secret) {
  const [encodedPayload = "", providedSignature = ""] = String(token || "").split(".");
  if (!encodedPayload || !providedSignature) {
    throw new ApiError(400, "INVALID_AUTH_FLOW", "No se encontro un flujo de autenticacion valido.");
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(encodedPayload, "utf8")
    .digest();
  const signatureBuffer = base64UrlDecode(providedSignature);

  if (
    signatureBuffer.length !== expectedSignature.length
    || !crypto.timingSafeEqual(signatureBuffer, expectedSignature)
  ) {
    throw new ApiError(400, "INVALID_AUTH_FLOW", "La firma del flujo de autenticacion no es valida.");
  }

  try {
    return JSON.parse(base64UrlDecode(encodedPayload).toString("utf8"));
  } catch {
    throw new ApiError(400, "INVALID_AUTH_FLOW", "No se pudo leer el flujo de autenticacion.");
  }
}

function createCookie(name, value, {
  httpOnly = true,
  maxAge = null,
  path = "/",
  sameSite = "Lax",
  secure = false
} = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];

  if (httpOnly) {
    parts.push("HttpOnly");
  }

  if (typeof maxAge === "number") {
    parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  }

  if (secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function createExpiredCookie(name, options = {}) {
  return createCookie(name, "", { ...options, maxAge: 0 });
}

function getRequestOrigin(req, fallbackOrigin = "") {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProto || (req.socket.encrypted ? "https" : "http");
  const host = req.headers.host || fallbackOrigin.replace(/^https?:\/\//, "");

  return normalizeOrigin(`${protocol}://${host}`);
}

function getCookieSecurity(req, env) {
  const secureEnv = String(env.TOPYKLY_COOKIE_SECURE || env.CHETREND_COOKIE_SECURE || "").trim().toLowerCase();
  if (secureEnv === "true") {
    return true;
  }
  if (secureEnv === "false") {
    return false;
  }

  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  return forwardedProto === "https" || Boolean(req.socket.encrypted);
}

async function readResponsePayload(response) {
  const text = await response.text();
  const payload = parseJsonResponse(text);

  if (!response.ok) {
    throw new ApiError(502, "AUTH_PROVIDER_ERROR", payload.error_description || payload.error || "El proveedor de autenticacion devolvio un error.");
  }

  return payload;
}

function buildReturnUrl(origin, { selectedTopicId = null, authError = null } = {}) {
  const url = new URL("/", origin);

  if (selectedTopicId) {
    url.searchParams.set("selectedTopicId", selectedTopicId);
  }

  if (authError) {
    url.searchParams.set("authError", authError);
  }

  return url.toString();
}

export function createAuthService({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now
} = {}) {
  const issuer = normalizeIssuer(env.TOPYKLY_OIDC_ISSUER || env.CHETREND_OIDC_ISSUER);
  const clientId = String(env.TOPYKLY_OIDC_CLIENT_ID || env.CHETREND_OIDC_CLIENT_ID || "").trim();
  const clientSecret = String(env.TOPYKLY_OIDC_CLIENT_SECRET || env.CHETREND_OIDC_CLIENT_SECRET || "").trim();
  const sessionSecret = String(env.TOPYKLY_SESSION_SECRET || env.CHETREND_SESSION_SECRET || "").trim();
  const providerLabel = String(env.TOPYKLY_AUTH_PROVIDER_NAME || env.CHETREND_AUTH_PROVIDER_NAME || "Google").trim() || "Google";
  const scopes = String(env.TOPYKLY_OIDC_SCOPE || env.CHETREND_OIDC_SCOPE || "openid profile email").trim() || "openid profile email";
  const publicOrigin = normalizeOrigin(env.TOPYKLY_PUBLIC_ORIGIN || env.CHETREND_PUBLIC_ORIGIN || "");
  const turnstileSiteKey = String(env.TOPYKLY_TURNSTILE_SITE_KEY || env.CHETREND_TURNSTILE_SITE_KEY || "").trim();
  const turnstileSecretKey = String(env.TOPYKLY_TURNSTILE_SECRET_KEY || env.CHETREND_TURNSTILE_SECRET_KEY || "").trim();
  const turnstileConfigured = Boolean(fetchImpl && turnstileSiteKey && turnstileSecretKey);

  const configured = Boolean(fetchImpl && issuer && clientId && clientSecret && sessionSecret);
  const discoveryCache = {
    expiresAt: 0,
    payload: null
  };

  async function getDiscoveryConfig() {
    if (!configured) {
      throw new ApiError(503, "AUTH_NOT_CONFIGURED", "La autenticacion externa no esta configurada.");
    }

    if (discoveryCache.payload && discoveryCache.expiresAt > now()) {
      return discoveryCache.payload;
    }

    const discoveryUrl = new URL("/.well-known/openid-configuration", `${issuer}/`).toString();
    const response = await fetchImpl(discoveryUrl, {
      headers: {
        "Accept": "application/json"
      }
    });
    const payload = await readResponsePayload(response);

    if (!payload.authorization_endpoint || !payload.token_endpoint || !payload.userinfo_endpoint) {
      throw new ApiError(503, "AUTH_PROVIDER_MISCONFIGURED", "El proveedor OIDC no expone todos los endpoints necesarios.");
    }

    discoveryCache.payload = payload;
    discoveryCache.expiresAt = now() + DISCOVERY_CACHE_TTL_MS;
    return payload;
  }

  function getRedirectUri(req) {
    const origin = publicOrigin || getRequestOrigin(req);
    return new URL("/auth/oidc/callback", origin).toString();
  }

  function createSessionCookie(req, sessionId) {
    return createCookie(SESSION_COOKIE, sessionId, {
      maxAge: SESSION_TTL_SECONDS,
      secure: getCookieSecurity(req, env)
    });
  }

  function createFlowCookie(req, flowPayload) {
    return createCookie(AUTH_FLOW_COOKIE, signPayload(flowPayload, sessionSecret), {
      maxAge: Math.ceil(AUTH_FLOW_TTL_MS / 1000),
      secure: getCookieSecurity(req, env)
    });
  }

  function clearFlowCookie(req) {
    return createExpiredCookie(AUTH_FLOW_COOKIE, {
      secure: getCookieSecurity(req, env)
    });
  }

  async function validateTurnstile({ req, token = "" } = {}) {
    if (!turnstileConfigured) {
      return { success: true, skipped: true };
    }

    const normalizedToken = String(token || "").trim();
    if (!normalizedToken) {
      throw new ApiError(403, "TURNSTILE_REQUIRED", "Completa la verificacion antes de iniciar sesion.");
    }

    const remoteip = String(req?.headers?.["cf-connecting-ip"] || req?.headers?.["x-forwarded-for"] || req?.socket?.remoteAddress || "")
      .split(",")[0]
      .trim();
    const body = new URLSearchParams({
      secret: turnstileSecretKey,
      response: normalizedToken
    });
    if (remoteip) {
      body.set("remoteip", remoteip);
    }

    const response = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });
    const payload = await readResponsePayload(response);

    if (!payload.success) {
      throw new ApiError(403, "TURNSTILE_FAILED", "No se pudo validar la verificacion anti-bots.", {
        turnstileErrors: Array.isArray(payload["error-codes"]) ? payload["error-codes"] : []
      });
    }

    return { success: true, skipped: false };
  }
  return {
    configured,
    providerLabel,
    sessionCookieName: SESSION_COOKIE,
    createSessionCookie,

    getStatus(req) {
      return {
        configured,
        provider: providerLabel,
        issuer: issuer || null,
        redirectUri: getRedirectUri(req),
        publicOrigin: publicOrigin || null,
        cookieSecure: getCookieSecurity(req, env),
        checks: {
          issuer: Boolean(issuer),
          clientId: Boolean(clientId),
          clientSecret: Boolean(clientSecret),
          sessionSecret: Boolean(sessionSecret),
          fetch: Boolean(fetchImpl)
        },
        turnstile: {
          configured: turnstileConfigured,
          siteKey: turnstileSiteKey || null
        }
      };
    },

    validateTurnstile,

    async createLoginResponse({ req, sessionId, selectedTopicId = null }) {
      if (!configured) {
        return null;
      }

      const discovery = await getDiscoveryConfig();
      const state = createRandomToken(24);
      const codeVerifier = createRandomToken(48);
      const redirectUri = getRedirectUri(req);
      const normalizedSessionId = String(sessionId || `session-${crypto.randomUUID()}`).trim();
      const flowPayload = {
        state,
        codeVerifier,
        sessionId: normalizedSessionId,
        selectedTopicId: selectedTopicId || null,
        issuedAt: now()
      };

      const authorizationUrl = new URL(discovery.authorization_endpoint);
      authorizationUrl.searchParams.set("client_id", clientId);
      authorizationUrl.searchParams.set("redirect_uri", redirectUri);
      authorizationUrl.searchParams.set("response_type", "code");
      authorizationUrl.searchParams.set("scope", scopes);
      authorizationUrl.searchParams.set("state", state);
      authorizationUrl.searchParams.set("code_challenge", createSha256Base64Url(codeVerifier));
      authorizationUrl.searchParams.set("code_challenge_method", "S256");

      return {
        payload: {
          mode: "redirect",
          redirectUrl: authorizationUrl.toString(),
          provider: providerLabel
        },
        cookies: [
          createSessionCookie(req, normalizedSessionId),
          createFlowCookie(req, flowPayload)
        ]
      };
    },

    async handleCallback({ req, cookies, query }) {
      if (!configured) {
        throw new ApiError(404, "AUTH_NOT_CONFIGURED", "No hay autenticacion externa configurada.");
      }

      const flowCookie = cookies[AUTH_FLOW_COOKIE] || cookies[LEGACY_AUTH_FLOW_COOKIE];
      const flowPayload = verifySignedPayload(flowCookie, sessionSecret);
      if (flowPayload.issuedAt + AUTH_FLOW_TTL_MS < now()) {
        throw new ApiError(400, "AUTH_FLOW_EXPIRED", "La solicitud de autenticacion expiro.");
      }

      const requestOrigin = publicOrigin || getRequestOrigin(req);
      const selectedTopicId = flowPayload.selectedTopicId || null;

      if (query.error) {
        return {
          redirectUrl: buildReturnUrl(requestOrigin, {
            selectedTopicId,
            authError: String(query.error || "auth_failed")
          }),
          cookies: [
            clearFlowCookie(req)
          ]
        };
      }

      if (!query.code || !query.state || query.state !== flowPayload.state) {
        throw new ApiError(400, "INVALID_AUTH_CALLBACK", "La respuesta del proveedor no coincide con la solicitud iniciada.");
      }

      const discovery = await getDiscoveryConfig();
      const redirectUri = getRedirectUri(req);
      const tokenResponse = await fetchImpl(discovery.token_endpoint, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          code: String(query.code),
          code_verifier: flowPayload.codeVerifier
        })
      });
      const tokenPayload = await readResponsePayload(tokenResponse);

      if (!tokenPayload.access_token) {
        throw new ApiError(502, "AUTH_PROVIDER_ERROR", "El proveedor no devolvio un access token.");
      }

      const userInfoResponse = await fetchImpl(discovery.userinfo_endpoint, {
        headers: {
          "Accept": "application/json",
          "Authorization": `Bearer ${tokenPayload.access_token}`
        }
      });
      const userInfo = await readResponsePayload(userInfoResponse);

      if (!userInfo.sub) {
        throw new ApiError(502, "AUTH_PROVIDER_ERROR", "El proveedor no devolvio un identificador de usuario.");
      }

      const nextSessionId = `session-${crypto.randomUUID()}`;
      return {
        redirectUrl: buildReturnUrl(requestOrigin, { selectedTopicId }),
        identity: {
          authProvider: issuer,
          authSubject: String(userInfo.sub),
          email: normalizeEmail(userInfo.email),
          displayName: normalizeDisplayName(userInfo),
          avatarUrl: normalizeImageUrl(userInfo.picture)
        },
        sourceSessionId: String(flowPayload.sessionId || ""),
        sessionId: nextSessionId,
        selectedTopicId,
        cookies: [
          createSessionCookie(req, nextSessionId),
          clearFlowCookie(req)
        ]
      };
    }
  };
}
