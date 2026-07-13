import crypto from "node:crypto";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { initialUsers, topicSeedData } from "../data.js";
import { SEO_THIN_TOPIC_COMMENT_COUNT } from "./seo-pages.js";

export const ACTIVE_TOPIC_LIMIT = 40;
export const VISIBLE_TOPIC_LIMIT = 20;
export const TOPIC_REPLY_LIMIT = 29;
export const TOPIC_TOTAL_MESSAGE_LIMIT = TOPIC_REPLY_LIMIT + 1;

const REGISTERED_USER_ID = "u1";
const SHARED_GUEST_USER_ID = "guest-anonymous";
const DEFAULT_MODERATOR_USER_ID = "u2";
const TOPIC_TITLE_MAX_LENGTH = 80;
const MESSAGE_TEXT_MAX_LENGTH = 240;
const REPORT_REASON_MAX_LENGTH = 240;
const NICKNAME_MIN_LENGTH = 3;
const NICKNAME_MAX_LENGTH = 24;
const DISPLAY_NAME_MAX_LENGTH = 50;
const PROFILE_DESCRIPTION_MAX_LENGTH = 180;
const SOCIAL_HANDLE_MAX_LENGTH = 40;
const PASSWORD_MIN_LENGTH = 8;
export const EMAIL_AUTH_CODE_TTL_MS = 10 * 60_000;
export const EMAIL_AUTH_RESEND_DELAY_MS = 60_000;
export const PASSWORD_RESET_CODE_TTL_MS = 10 * 60_000;
export const PASSWORD_RESET_RESEND_DELAY_MS = 60_000;
export const MINIMUM_REGISTRATION_AGE = 16;
export const TERMS_VERSION = "2026-07-10";
const EMAIL_AUTH_MAX_ATTEMPTS = 5;
const PASSWORD_RESET_MAX_ATTEMPTS = 5;
const PASSWORD_RESET_EMAIL_HOURLY_MAX = 5;
const PASSWORD_RESET_IP_HOURLY_MAX = 20;
const PASSWORD_RESET_RATE_WINDOW_MS = 60 * 60_000;
const LOCAL_AUTH_CHALLENGE_SECRET = crypto.randomBytes(32).toString("base64url");
const AVATAR_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_UPLOAD_MAX_BASE64_BYTES = Math.ceil(AVATAR_UPLOAD_MAX_BYTES / 3) * 4;
const AVATAR_UPLOAD_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const AVATAR_UPLOAD_EXTENSIONS = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"]
]);
const AVATAR_PUBLIC_PATH = "/avatars";
const ADMIN_REPORT_PAGE_SIZE = 50;
const ADMIN_AVATAR_PAGE_SIZE = 50;
const ADMIN_MAX_PAGE_SIZE = 100;
const TOPIC_STATUS_ACTIVE = "active";
const TOPIC_STATUS_BLOCKED = "blocked";
const TOPIC_STATUS_EXPELLED = "expelled";
const TOPIC_STATUS_PINNED = "pinned";
const USER_STATUS_ACTIVE = "active";
const USER_STATUS_EXPELLED = "expelled";
const REPORT_STATUS_OPEN = "open";
const REPORT_STATUS_RESOLVED = "resolved";
const GUEST_DISPLAY_NAME = "*topy";
const GUEST_SESSION_TTL_MS = 7 * 24 * 60 * 60_000;
const GUEST_SESSION_MAX_PER_IP = 25;
const GUEST_SESSION_MAX_TOTAL = 1000;
const MESSAGE_REACTION_RESET_TIME_ZONE = "America/New_York";
const MESSAGE_REACTION_RESET_META_KEY = "message_reactions_reset_day";
const PRESENCE_ONLINE_WINDOW_MS = 20_000;
const PRESENCE_ACCUMULATION_CAP_SECONDS = 30;
const PRESENCE_RESET_META_KEY = "connected_hours_reset_day";
const EXTRA_TOPIC_SEEDS = [
  ["Guardia tardia", "Hilo tranquilo para quien entra despues de hora."],
  ["Objetivos cortos", "Lista rapida de pendientes y mini retos."],
  ["Hallazgos del mapa", "Ubicaciones, sorpresas y rutas utiles."],
  ["Sorteos y premios", "Anuncios simples para dinamicas chicas."],
  ["Clips destacados", "Momentos cortos para recordar despues."],
  ["Canal de trueque", "Pedidos puntuales y ofertas concretas."],
  ["Mesa de soporte", "Problemas tecnicos y soluciones rapidas."],
  ["Bitacora social", "Resumen breve de lo que va pasando."],
  ["After del evento", "Comentarios posteriores a cada encuentro."],
  ["Llamado a crews", "Busqueda de equipo para tareas concretas."],
  ["Wishlist comun", "Pedidos y mejoras que varios repiten."],
  ["Radar del barrio", "Movimientos, avisos y actividad reciente."],
  ["Charlas del lobby", "Conversacion ligera entre partidas."],
  ["Nicho creativo", "Ideas visuales, copy y nombres."],
  ["Intercambio rapido", "Espacio express para coordinar sin vueltas."],
  ["Codigo social", "Normas blandas y convivencia del cafe."],
  ["Pizarra semanal", "Resumen corto del foco de la semana."],
  ["Puerta de entrada", "Orientacion breve para gente nueva."],
  ["Tablon comercial", "Avisos con tono de tienda o mercado."],
  ["Patio abierto", "Tema amplio para charla libre moderada."]
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FALLBACK_DB_PATH = path.join(__dirname, "..", ".data", "topykly.sqlite");
const DEFAULT_DB_PATH = process.env.TOPYKLY_DB_PATH
  || process.env.CHETREND_DB_PATH
  || FALLBACK_DB_PATH;
const DEFAULT_REGISTERED_ROLE = "Registrado";
const ADMIN_ROLE = "Admin";
const MODERATOR_ROLE = "Moderacion";

function resolveDbConfig(explicitDbPath = null, env = process.env) {
  const normalizedExplicitPath = String(explicitDbPath || "").trim();
  if (normalizedExplicitPath) {
    return {
      dbPath: normalizedExplicitPath,
      dbPathSource: "explicit",
      storageConfigured: true,
      storageWarning: null
    };
  }

  const topyklyDbPath = String(env.TOPYKLY_DB_PATH || "").trim();
  if (topyklyDbPath) {
    return {
      dbPath: topyklyDbPath,
      dbPathSource: "TOPYKLY_DB_PATH",
      storageConfigured: true,
      storageWarning: null
    };
  }

  const legacyDbPath = String(env.CHETREND_DB_PATH || "").trim();
  if (legacyDbPath) {
    return {
      dbPath: legacyDbPath,
      dbPathSource: "CHETREND_DB_PATH",
      storageConfigured: true,
      storageWarning: null
    };
  }

  return {
    dbPath: FALLBACK_DB_PATH,
    dbPathSource: "default",
    storageConfigured: false,
    storageWarning: "TOPYKLY_DB_PATH no esta configurado; en Render usa un Persistent Disk para no perder datos."
  };
}

function getConfiguredAdminEmails() {
  return String(process.env.TOPYKLY_ADMIN_EMAILS || process.env.CHETREND_ADMIN_EMAILS || "")
    .split(",")
    .map((email) => normalizeOptionalEmail(email))
    .filter(Boolean);
}

function isAdminEmail(email) {
  const normalizedEmail = normalizeOptionalEmail(email);
  return Boolean(normalizedEmail && getConfiguredAdminEmails().includes(normalizedEmail));
}

function isModeratorRole(role) {
  return role === ADMIN_ROLE || role === MODERATOR_ROLE || role === "Moderacion";
}

function getEffectiveViewerRole(row) {
  if (row?.type === "registered" && row.email_verified_at && isAdminEmail(row.email)) {
    return ADMIN_ROLE;
  }
  return row?.role || "";
}

function canModerate(row) {
  return row?.id === DEFAULT_MODERATOR_USER_ID || isModeratorRole(getEffectiveViewerRole(row));
}
class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    Object.assign(this, details);
  }
}

function normalizeTopicTitle(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeMessageText(value) {
  return String(value || "").trim();
}

function normalizeIpAddress(value) {
  return String(value || "").trim();
}

function normalizeUserDisplayName(value, fallback = "Usuario") {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  return (normalized || fallback).slice(0, 80);
}

function normalizeRequiredDisplayName(value) {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    throw new ApiError(400, "VALIDATION_ERROR", "Ingresa un nombre visible.");
  }
  if (normalized.length > DISPLAY_NAME_MAX_LENGTH) {
    throw new ApiError(400, "VALIDATION_ERROR", `El nombre visible no puede superar ${DISPLAY_NAME_MAX_LENGTH} caracteres.`);
  }

  return normalized;
}

function normalizeOptionalEmail(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || null;
}

function normalizeRequiredEmail(value) {
  const normalized = normalizeOptionalEmail(value);
  if (!normalized || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Ingresa un email valido.");
  }

  return normalized;
}

function normalizeRegistrationAge(value) {
  const age = Number(value);
  if (!Number.isInteger(age) || age < MINIMUM_REGISTRATION_AGE || age > 120) {
    throw new ApiError(400, "INVALID_AGE", `Debes tener al menos ${MINIMUM_REGISTRATION_AGE} anos para crear una cuenta.`);
  }

  return age;
}

function assertTermsAccepted(acceptedTerms, termsVersion) {
  if (acceptedTerms !== true || termsVersion !== TERMS_VERSION) {
    throw new ApiError(400, "TERMS_REQUIRED", "Debes aceptar los Terminos y Condiciones para crear una cuenta.");
  }
}

function hashEmailAuthCode(challengeId, code) {
  return crypto
    .createHash("sha256")
    .update(`${challengeId}:${String(code || "")}`, "utf8")
    .digest("base64url");
}

function codesMatch(actualHash, expectedHash) {
  const actual = Buffer.from(String(actualHash || ""));
  const expected = Buffer.from(String(expectedHash || ""));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function getAuthChallengeSecret() {
  const configuredSecret = String(
    process.env.TOPYKLY_AUTH_CHALLENGE_SECRET
    || process.env.TOPYKLY_SESSION_SECRET
    || process.env.CHETREND_SESSION_SECRET
    || ""
  ).trim();
  if (configuredSecret) {
    return configuredSecret;
  }

  const runtimeEnvironment = String(process.env.NODE_ENV || "").trim().toLowerCase();
  if (runtimeEnvironment === "production") {
    throw new ApiError(503, "AUTH_CHALLENGE_NOT_CONFIGURED", "La recuperacion de cuenta no esta configurada.");
  }
  return LOCAL_AUTH_CHALLENGE_SECRET;
}

function createPrivateLookupKey(kind, value) {
  return crypto
    .createHmac("sha256", getAuthChallengeSecret())
    .update(`${kind}:${String(value || "")}`, "utf8")
    .digest("base64url");
}

function hashPasswordResetCode(challengeId, code) {
  return createPrivateLookupKey("password-reset-code", `${challengeId}:${String(code || "")}`);
}

function normalizeNickname(value) {
  const normalized = String(value || "").trim();
  if (normalized.length < NICKNAME_MIN_LENGTH || normalized.length > NICKNAME_MAX_LENGTH) {
    throw new ApiError(400, "VALIDATION_ERROR", `El nickname debe tener entre ${NICKNAME_MIN_LENGTH} y ${NICKNAME_MAX_LENGTH} caracteres.`);
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(normalized)) {
    throw new ApiError(400, "VALIDATION_ERROR", "El nickname solo puede usar letras, numeros, punto, guion y guion bajo. Usa _ en lugar de espacios.");
  }
  if (!/^[A-Za-z]/.test(normalized)) {
    throw new ApiError(400, "VALIDATION_ERROR", "El nickname debe empezar con una letra.");
  }

  return `${normalized[0].toUpperCase()}${normalized.slice(1).toLowerCase()}`;
}

function normalizeUniqueNameKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeNicknameKey(value) {
  return normalizeUniqueNameKey(normalizeNickname(value));
}

function normalizeProfileDescription(value) {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  if (normalized.length > PROFILE_DESCRIPTION_MAX_LENGTH) {
    throw new ApiError(400, "VALIDATION_ERROR", `La descripcion no puede superar ${PROFILE_DESCRIPTION_MAX_LENGTH} caracteres.`);
  }

  return normalized;
}

function normalizeSocialHandle(value, label) {
  const normalized = String(value || "").trim().replace(/\s+/g, "");
  if (!normalized) {
    return "";
  }

  if (normalized.length > SOCIAL_HANDLE_MAX_LENGTH) {
    throw new ApiError(400, "VALIDATION_ERROR", `El usuario de ${label} no puede superar ${SOCIAL_HANDLE_MAX_LENGTH} caracteres.`);
  }

  if (/[\/\\]|:\/\/|^javascript:|^data:|[\x00-\x1f]/i.test(normalized)) {
    throw new ApiError(400, "VALIDATION_ERROR", `El usuario de ${label} contiene caracteres no permitidos.`);
  }

  if (!/^[A-Za-z0-9_.\-@+]+$/.test(normalized)) {
    throw new ApiError(400, "VALIDATION_ERROR", `El usuario de ${label} solo puede usar letras, numeros, punto, guion y guion bajo.`);
  }

  return normalized.replace(/^@/, "");
}

function normalizeSocialWhatsapp(value) {
  const normalized = String(value || "").trim().replace(/[\s()-]/g, "");
  if (!normalized) {
    return "";
  }

  if (normalized.length > SOCIAL_HANDLE_MAX_LENGTH) {
    throw new ApiError(400, "VALIDATION_ERROR", `El numero de WhatsApp no puede superar ${SOCIAL_HANDLE_MAX_LENGTH} caracteres.`);
  }

  if (!/^\+?[0-9]+$/.test(normalized)) {
    throw new ApiError(400, "VALIDATION_ERROR", "El numero de WhatsApp solo puede tener digitos y un + inicial.");
  }

  return normalized;
}

function validatePassword(value) {
  const password = String(value || "");
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new ApiError(400, "VALIDATION_ERROR", `La contrasena debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`);
  }
  if (password.length > 256) {
    throw new ApiError(400, "VALIDATION_ERROR", "La contrasena excede el maximo permitido.");
  }

  return password;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto.scryptSync(password, salt, 64).toString("base64url");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [, salt = "", expected = ""] = String(storedHash || "").split(":");
  if (!salt || !expected) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, "base64url");
  const actualBuffer = crypto.scryptSync(String(password || ""), salt, expectedBuffer.length);
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}


function normalizeOptionalUrl(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeAvatarUrl(value, { discardInvalid = false } = {}) {
  const normalized = normalizeOptionalUrl(value);
  if (!normalized) {
    return null;
  }

  if (normalized.length > 500) {
    if (discardInvalid) {
      return null;
    }
    throw new ApiError(400, "VALIDATION_ERROR", "La URL del avatar excede el maximo permitido.");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(normalized);
  } catch {
    if (discardInvalid) {
      return null;
    }
    throw new ApiError(400, "VALIDATION_ERROR", "La URL del avatar no es valida.");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    if (discardInvalid) {
      return null;
    }
    throw new ApiError(400, "VALIDATION_ERROR", "El avatar debe usar una URL http o https.");
  }

  return parsedUrl.toString();
}

function estimateBase64DecodedBytes(value) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

function storeAvatarDataUrl(value, avatarStorageDir) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new ApiError(400, "VALIDATION_ERROR", "La foto debe ser una imagen PNG, JPG, WebP o GIF valida.");
  }

  const mimeType = match[1];
  const payload = match[2];
  if (payload.length > AVATAR_UPLOAD_MAX_BASE64_BYTES || estimateBase64DecodedBytes(payload) > AVATAR_UPLOAD_MAX_BYTES) {
    throw new ApiError(400, "VALIDATION_ERROR", "La foto no puede superar 2 MB.");
  }

  if (!AVATAR_UPLOAD_MIME_TYPES.has(mimeType)) {
    throw new ApiError(400, "VALIDATION_ERROR", "El tipo de imagen no esta permitido.");
  }

  const avatarBuffer = Buffer.from(payload, "base64");
  if (avatarBuffer.byteLength > AVATAR_UPLOAD_MAX_BYTES) {
    throw new ApiError(400, "VALIDATION_ERROR", "La foto no puede superar 2 MB.");
  }

  const extension = AVATAR_UPLOAD_EXTENSIONS.get(mimeType);
  const fileName = `${crypto.randomUUID()}.${extension}`;
  mkdirSync(avatarStorageDir, { recursive: true });
  writeFileSync(path.join(avatarStorageDir, fileName), avatarBuffer, { flag: "wx" });

  return `${AVATAR_PUBLIC_PATH}/${fileName}`;
}

function isStoredAvatarUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized.startsWith(`${AVATAR_PUBLIC_PATH}/`)) {
    return false;
  }

  const fileName = normalized.slice(AVATAR_PUBLIC_PATH.length + 1);
  return Boolean(fileName) && fileName === path.basename(fileName) && !fileName.startsWith(".");
}

function cleanupStoredAvatarUrl(db, avatarStorageDir, avatarUrl) {
  const normalized = String(avatarUrl || "").trim();
  if (!isStoredAvatarUrl(normalized)) {
    return;
  }

  const reference = db.prepare(`
    SELECT id
    FROM users
    WHERE avatar_url = ? OR avatar_pending_url = ?
    LIMIT 1
  `).get(normalized, normalized);
  if (reference) {
    return;
  }

  try {
    unlinkSync(path.join(avatarStorageDir, path.basename(normalized)));
  } catch {
    // A missing stale file should not break the profile or moderation flow.
  }
}

function scheduleStoredAvatarCleanup(registerAfterCommit, db, avatarStorageDir, avatarUrls) {
  const uniqueUrls = [...new Set(avatarUrls.filter(Boolean))];
  if (!uniqueUrls.length) {
    return;
  }

  registerAfterCommit(() => {
    uniqueUrls.forEach((avatarUrl) => cleanupStoredAvatarUrl(db, avatarStorageDir, avatarUrl));
  });
}
function summarizeText(text, limit = 96) {
  const normalized = normalizeMessageText(text).replace(/\s+/g, " ");
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit - 3).trimEnd()}...`;
}

function createIsoTimestamp(offsetMinutes = 0, baseMs = Date.now()) {
  return new Date(baseMs + offsetMinutes * 60_000).toISOString();
}

function getMessageReactionResetDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MESSAGE_REACTION_RESET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now instanceof Date ? now : new Date(now));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function resetDailyMessageReactionsIfNeeded(db, now = new Date()) {
  const resetDay = getMessageReactionResetDay(now);
  const nowIso = (now instanceof Date ? now : new Date(now)).toISOString();
  const row = db.prepare("SELECT value FROM app_metadata WHERE key = ?").get(MESSAGE_REACTION_RESET_META_KEY);

  if (!row) {
    db.prepare("INSERT INTO app_metadata (key, value, updated_at) VALUES (?, ?, ?)").run(
      MESSAGE_REACTION_RESET_META_KEY,
      resetDay,
      nowIso
    );
    return { reset: false, resetDay, deletedLikes: 0, deletedDislikes: 0 };
  }

  if (row.value === resetDay) {
    return { reset: false, resetDay, deletedLikes: 0, deletedDislikes: 0 };
  }

  const deletedLikes = db.prepare("DELETE FROM message_likes").run().changes ?? 0;
  const deletedDislikes = db.prepare("DELETE FROM message_dislikes").run().changes ?? 0;
  db.prepare("UPDATE messages SET likes = 0, dislikes = 0 WHERE likes <> 0 OR dislikes <> 0").run();
  db.prepare("UPDATE app_metadata SET value = ?, updated_at = ? WHERE key = ?").run(
    resetDay,
    nowIso,
    MESSAGE_REACTION_RESET_META_KEY
  );

  return { reset: true, resetDay, deletedLikes, deletedDislikes };
}

function computeRetryAfterSeconds(nextAllowedAt, now = Date.now()) {
  const deltaMs = Math.max(0, nextAllowedAt - now);
  return Math.ceil(deltaMs / 1000);
}

function ensureViewerSessionId(sessionId) {
  const normalized = String(sessionId || "").trim();
  if (normalized) {
    return normalized;
  }

  return `session-${crypto.randomUUID()}`;
}

function getRateLimitConfig(viewerType) {
  if (viewerType === "registered") {
    return {
      createTopicMs: 30 * 60_000,
      postMessageMs: 10_000
    };
  }

  return {
    createTopicMs: 2 * 60 * 60_000,
    postMessageMs: 5 * 60_000
  };
}

function withTransaction(db, task) {
  const afterCommitTasks = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = task((callback) => {
      if (typeof callback === "function") {
        afterCommitTasks.push(callback);
      }
    });
    db.exec("COMMIT");
    afterCommitTasks.forEach((callback) => callback());
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function normalizePositiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function normalizePaginationOptions({ page = 1, limit } = {}, defaultLimit) {
  const normalizedLimit = normalizePositiveInteger(limit, defaultLimit, {
    min: 1,
    max: ADMIN_MAX_PAGE_SIZE
  });
  const normalizedPage = normalizePositiveInteger(page, 1, { min: 1 });

  return {
    page: normalizedPage,
    limit: normalizedLimit,
    offset: (normalizedPage - 1) * normalizedLimit
  };
}

function createPaginationMeta(total, { page, limit }) {
  return {
    page,
    limit,
    total,
    hasMore: page * limit < total
  };
}
function getSeedTopicEntries() {
  return [...topicSeedData, ...EXTRA_TOPIC_SEEDS].slice(0, ACTIVE_TOPIC_LIMIT);
}

function initSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('guest', 'registered', 'system')),
      role TEXT NOT NULL DEFAULT '',
      score INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      auth_provider TEXT,
      auth_subject TEXT,
      email TEXT,
      email_verified_at TEXT,
      description TEXT NOT NULL DEFAULT '',
      profile_show_description INTEGER NOT NULL DEFAULT 1,
      profile_show_joined_at INTEGER NOT NULL DEFAULT 1,
      social_whatsapp TEXT NOT NULL DEFAULT '',
      social_instagram TEXT NOT NULL DEFAULT '',
      social_tiktok TEXT NOT NULL DEFAULT '',
      social_facebook TEXT NOT NULL DEFAULT '',
      social_twitter TEXT NOT NULL DEFAULT '',
      social_discord TEXT NOT NULL DEFAULT '',
      profile_show_social INTEGER NOT NULL DEFAULT 1,
      likes_anonymous INTEGER NOT NULL DEFAULT 0,
      filter_profanity INTEGER NOT NULL DEFAULT 1,
      notifications_friends_only INTEGER NOT NULL DEFAULT 0,
      avatar_url TEXT,
      avatar_pending_url TEXT,
      avatar_review_status TEXT,
      profile_pending INTEGER NOT NULL DEFAULT 0,
      profile_suggested_name TEXT,
      profile_suggested_avatar_url TEXT,
      last_topic_at TEXT,
      last_message_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      banned_until TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      auth_mode TEXT NOT NULL CHECK (auth_mode IN ('guest', 'registered')),
      guest_label TEXT,
      last_ip TEXT,
      last_topic_at TEXT,
      last_message_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      subtitle TEXT NOT NULL,
      author_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'expelled', 'blocked', 'pinned')),
      active_rank INTEGER,
      last_message_id INTEGER NOT NULL DEFAULT 0,
      last_activity_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (author_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      text TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'user',
      likes INTEGER NOT NULL DEFAULT 0,
      is_root INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
      FOREIGN KEY (author_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS message_likes (
      message_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (message_id, user_id),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS message_dislikes (
      message_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (message_id, user_id),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      reporter_session_id TEXT,
      reporter_user_id TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      resolved_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS friend_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id TEXT NOT NULL,
      addressee_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(requester_id, addressee_id),
      FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (addressee_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS moderation_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action_type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      actor_user_id TEXT,
      reason TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS blocked_sessions (
      session_id TEXT PRIMARY KEY,
      actor_user_id TEXT,
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS blocked_ips (
      ip_address TEXT PRIMARY KEY,
      actor_user_id TEXT,
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS guest_ip_rate_limits (
      ip_address TEXT PRIMARY KEY,
      last_topic_at TEXT,
      last_message_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_email_challenges (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      intent TEXT NOT NULL CHECK (intent IN ('login', 'register')),
      code_hash TEXT NOT NULL,
      nickname TEXT,
      age INTEGER,
      terms_version TEXT,
      expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      consumed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS password_reset_challenges (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      email_key TEXT NOT NULL,
      request_ip_key TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      consumed_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  ensureColumn(db, "users", "last_topic_at", "TEXT");
  ensureColumn(db, "users", "last_message_at", "TEXT");
  ensureColumn(db, "users", "auth_provider", "TEXT");
  ensureColumn(db, "users", "auth_subject", "TEXT");
  ensureColumn(db, "users", "email", "TEXT");
  ensureColumn(db, "users", "email_verified_at", "TEXT");
  ensureColumn(db, "users", "description", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "users", "profile_show_description", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "users", "profile_show_joined_at", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "users", "social_whatsapp", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "users", "social_instagram", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "users", "social_tiktok", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "users", "social_facebook", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "users", "social_twitter", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "users", "social_discord", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "users", "profile_show_social", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "users", "likes_anonymous", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "users", "filter_profanity", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "users", "notifications_friends_only", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "users", "profile_indexable", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "users", "nickname", "TEXT");
  ensureColumn(db, "users", "nickname_norm", "TEXT");
  ensureColumn(db, "users", "password_hash", "TEXT");
  ensureColumn(db, "users", "avatar_url", "TEXT");
  ensureColumn(db, "users", "avatar_pending_url", "TEXT");
  ensureColumn(db, "users", "avatar_review_status", "TEXT");
  ensureColumn(db, "users", "profile_pending", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "users", "profile_suggested_name", "TEXT");
  ensureColumn(db, "users", "profile_suggested_avatar_url", "TEXT");
  ensureColumn(db, "users", "registration_age", "INTEGER");
  ensureColumn(db, "users", "banned_until", "TEXT");
  ensureColumn(db, "users", "terms_accepted_at", "TEXT");
  ensureColumn(db, "users", "terms_version", "TEXT");
  ensureColumn(db, "auth_email_challenges", "password_hash", "TEXT");
  ensureColumn(db, "messages", "dislikes", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "reports", "reporter_session_id", "TEXT");
  ensureColumn(db, "reports", "reporter_user_id", "TEXT");
  ensureColumn(db, "reports", "status", `TEXT NOT NULL DEFAULT '${REPORT_STATUS_OPEN}'`);
  ensureColumn(db, "reports", "resolved_at", "TEXT");
  ensureColumn(db, "moderation_actions", "actor_user_id", "TEXT");
  ensureColumn(db, "moderation_actions", "reason", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "users", "total_connected_seconds", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "users", "connected_seconds_24h", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "users", "connected_seconds_today", "INTEGER NOT NULL DEFAULT 0");
  db.exec("DROP TABLE IF EXISTS user_presence_hourly;");
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_auth_identity_idx
    ON users(auth_provider, auth_subject)
    WHERE auth_provider IS NOT NULL AND auth_subject IS NOT NULL;

    CREATE INDEX IF NOT EXISTS users_email_idx
    ON users(email)
    WHERE email IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS users_verified_email_idx
    ON users(email)
    WHERE email IS NOT NULL AND email_verified_at IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS users_nickname_norm_idx
    ON users(nickname_norm)
    WHERE nickname_norm IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS users_password_email_idx
    ON users(email)
    WHERE email IS NOT NULL AND password_hash IS NOT NULL;

    CREATE INDEX IF NOT EXISTS password_reset_email_rate_idx
    ON password_reset_challenges(email_key, created_at DESC);

    CREATE INDEX IF NOT EXISTS password_reset_ip_rate_idx
    ON password_reset_challenges(request_ip_key, created_at DESC);

    CREATE INDEX IF NOT EXISTS password_reset_expiry_idx
    ON password_reset_challenges(expires_at, consumed_at);
    CREATE INDEX IF NOT EXISTS users_frontend_active_idx
    ON users(status, type, score DESC, created_at ASC);

    CREATE INDEX IF NOT EXISTS users_pending_avatar_idx
    ON users(type, updated_at DESC, created_at DESC)
    WHERE avatar_pending_url IS NOT NULL AND avatar_pending_url <> '';

    CREATE INDEX IF NOT EXISTS users_avatar_url_idx
    ON users(avatar_url)
    WHERE avatar_url IS NOT NULL;

    CREATE INDEX IF NOT EXISTS users_avatar_pending_url_idx
    ON users(avatar_pending_url)
    WHERE avatar_pending_url IS NOT NULL;

    CREATE INDEX IF NOT EXISTS sessions_guest_cleanup_idx
    ON sessions(auth_mode, updated_at, id);

    CREATE INDEX IF NOT EXISTS sessions_guest_ip_idx
    ON sessions(auth_mode, last_ip, updated_at DESC, created_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS sessions_user_presence_idx
    ON sessions(user_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS topics_status_rank_idx
    ON topics(status, active_rank ASC);

    CREATE INDEX IF NOT EXISTS topics_status_activity_idx
    ON topics(status, last_message_id DESC, created_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS messages_topic_id_idx
    ON messages(topic_id, id ASC);

    CREATE INDEX IF NOT EXISTS messages_topic_reply_trim_idx
    ON messages(topic_id, is_root, id DESC);
    CREATE INDEX IF NOT EXISTS message_likes_user_idx
    ON message_likes(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS message_dislikes_user_idx
    ON message_dislikes(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS reports_session_open_idx
    ON reports(reporter_session_id, status, id DESC);

    CREATE INDEX IF NOT EXISTS reports_user_open_idx
    ON reports(reporter_user_id, entity_type, entity_id, status);

    CREATE INDEX IF NOT EXISTS reports_entity_open_idx
    ON reports(entity_type, entity_id, status);

    CREATE INDEX IF NOT EXISTS reports_status_created_idx
    ON reports(status, created_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS friend_requests_requester_idx
    ON friend_requests(requester_id, status, updated_at DESC);

    CREATE INDEX IF NOT EXISTS friend_requests_addressee_idx
    ON friend_requests(addressee_id, status, updated_at DESC);

    CREATE INDEX IF NOT EXISTS guest_ip_rate_limits_updated_idx
    ON guest_ip_rate_limits(updated_at);

    CREATE INDEX IF NOT EXISTS moderation_actions_target_idx
    ON moderation_actions(target_type, target_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS auth_email_challenges_email_idx
    ON auth_email_challenges(email, created_at DESC);

    CREATE INDEX IF NOT EXISTS auth_email_challenges_expiry_idx
    ON auth_email_challenges(expires_at, consumed_at);
  `);

  // Migracion unica: el filtro de insultos paso a estar activado por defecto;
  // las filas creadas con el default viejo (0) nunca reflejaron una eleccion del usuario.
  const filterProfanityDefaultKey = "filter_profanity_default_on";
  const filterProfanityDefaultRow = db
    .prepare("SELECT value FROM app_metadata WHERE key = ?")
    .get(filterProfanityDefaultKey);
  if (!filterProfanityDefaultRow) {
    db.prepare("UPDATE users SET filter_profanity = 1").run();
    db.prepare("INSERT INTO app_metadata (key, value, updated_at) VALUES (?, ?, ?)").run(
      filterProfanityDefaultKey,
      "1",
      new Date().toISOString()
    );
  }
}

function ensureColumn(db, tableName, columnName, columnDefinition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
}

function rollConnectedHoursIfNeeded(db, nowIso) {
  const resetDay = getMessageReactionResetDay(nowIso);
  const row = db.prepare("SELECT value FROM app_metadata WHERE key = ?").get(PRESENCE_RESET_META_KEY);

  if (!row) {
    db.prepare("INSERT INTO app_metadata (key, value, updated_at) VALUES (?, ?, ?)").run(
      PRESENCE_RESET_META_KEY,
      resetDay,
      nowIso
    );
    return;
  }

  if (row.value === resetDay) {
    return;
  }

  db.prepare("UPDATE users SET connected_seconds_24h = connected_seconds_today, connected_seconds_today = 0").run();
  db.prepare("UPDATE app_metadata SET value = ?, updated_at = ? WHERE key = ?").run(
    resetDay,
    nowIso,
    PRESENCE_RESET_META_KEY
  );
}

function accumulatePresence(db, userId, previousUpdatedAtIso, nowIso) {
  rollConnectedHoursIfNeeded(db, nowIso);

  if (!userId || !previousUpdatedAtIso) {
    return;
  }

  const elapsedSeconds = Math.round(
    (new Date(nowIso).getTime() - new Date(previousUpdatedAtIso).getTime()) / 1000
  );
  if (elapsedSeconds <= 0 || elapsedSeconds > PRESENCE_ACCUMULATION_CAP_SECONDS) {
    return;
  }

  db.prepare(`
    UPDATE users
    SET total_connected_seconds = total_connected_seconds + ?,
        connected_seconds_today = connected_seconds_today + ?
    WHERE id = ?
  `).run(elapsedSeconds, elapsedSeconds, userId);
}

function seedUsers(db) {
  const countRow = db.prepare("SELECT COUNT(*) AS count FROM users").get();
  if ((countRow?.count ?? 0) > 0) {
    return;
  }

  const insertUser = db.prepare(`
    INSERT INTO users (id, name, type, role, score, status, created_at, updated_at)
    VALUES (?, ?, 'registered', ?, ?, 'active', ?, ?)
  `);

  const nowIso = new Date().toISOString();
  initialUsers.forEach((user) => {
    insertUser.run(user.id, user.name, user.role || "", user.score ?? 0, nowIso, nowIso);
  });
}

function seedTopics(db) {
  const countRow = db.prepare("SELECT COUNT(*) AS count FROM topics").get();
  if ((countRow?.count ?? 0) > 0) {
    return;
  }

  const insertTopic = db.prepare(`
    INSERT INTO topics (
      id, title, subtitle, author_id, status, active_rank, last_message_id, last_activity_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
  `);
  const insertMessage = db.prepare(`
    INSERT INTO messages (topic_id, author_id, text, kind, likes, is_root, created_at)
    VALUES (?, ?, ?, 'user', ?, ?, ?)
  `);
  const updateTopic = db.prepare(`
    UPDATE topics
    SET subtitle = ?, last_message_id = ?, last_activity_at = ?, updated_at = ?
    WHERE id = ?
  `);

  const users = initialUsers.map((user) => user.id);
  const seeds = getSeedTopicEntries();
  const baseMs = Date.now() - seeds.length * 90 * 60_000;

  seeds.forEach(([title, subtitle], topicIndex) => {
    const topicId = `topic-${topicIndex + 1}`;
    const authorId = users[topicIndex % users.length];
    const createdAt = createIsoTimestamp(topicIndex * 4, baseMs);
    insertTopic.run(
      topicId,
      normalizeTopicTitle(title),
      summarizeText(subtitle),
      authorId,
      TOPIC_STATUS_ACTIVE,
      topicIndex,
      createdAt,
      createdAt,
      createdAt
    );

    let lastMessageId = 0;
    const rootText = `${normalizeTopicTitle(title)}. ${normalizeMessageText(subtitle)}`;
    const rootResult = insertMessage.run(topicId, authorId, rootText, 1 + (topicIndex % 4), 1, createdAt);
    lastMessageId = Number(rootResult.lastInsertRowid);
    let lastActivityAt = createdAt;
    let subtitlePreview = summarizeText(rootText);

    for (let replyIndex = 0; replyIndex < 5; replyIndex += 1) {
      const replyAuthorId = users[(topicIndex + replyIndex + 1) % users.length];
      const replyText = [
        `Respuesta ${replyIndex + 1} en ${normalizeTopicTitle(title)}.`,
        `Sigue la conversacion del tema ${topicIndex + 1}.`
      ].join(" ");
      const replyCreatedAt = createIsoTimestamp(topicIndex * 4 + replyIndex + 1, baseMs);
      const replyResult = insertMessage.run(
        topicId,
        replyAuthorId,
        replyText,
        1 + ((topicIndex + replyIndex) % 5),
        0,
        replyCreatedAt
      );
      lastMessageId = Number(replyResult.lastInsertRowid);
      lastActivityAt = replyCreatedAt;
      subtitlePreview = summarizeText(replyText);
    }

    updateTopic.run(subtitlePreview, lastMessageId, lastActivityAt, lastActivityAt, topicId);
  });

  rebuildActiveTopicRanks(db);
}

function shouldSeedDemoData(env = process.env, fallback = true) {
  const rawValue = String(env.TOPYKLY_SEED_DEMO_DATA || env.CHETREND_SEED_DEMO_DATA || "").trim().toLowerCase();
  if (["1", "true", "yes", "demo"].includes(rawValue)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(rawValue)) {
    return false;
  }

  return fallback;
}
function seedFakeFriendRequests(db) {
  const countRow = db.prepare("SELECT COUNT(*) AS count FROM users WHERE id LIKE 'fake-user-%'").get();
  if ((countRow?.count ?? 0) > 0) {
    return;
  }

  const insertUser = db.prepare(`
    INSERT INTO users (id, name, type, role, score, status, created_at, updated_at)
    VALUES (?, ?, 'registered', '', 0, 'active', ?, ?)
  `);

  const insertRequest = db.prepare(`
    INSERT OR IGNORE INTO friend_requests (requester_id, addressee_id, status, created_at, updated_at)
    VALUES (?, ?, 'pending', ?, ?)
  `);

  const nowIso = new Date().toISOString();

  // Create 30 fake users sending request to u1 (incoming)
  for (let i = 1; i <= 30; i++) {
    const userId = `fake-user-in-${i}`;
    const name = `Usuario Recibido ${i}`;
    insertUser.run(userId, name, nowIso, nowIso);
    insertRequest.run(userId, "u1", nowIso, nowIso);
  }

  // Create 30 fake users receiving request from u1 (outgoing)
  for (let i = 1; i <= 30; i++) {
    const userId = `fake-user-out-${i}`;
    const name = `Usuario Enviado ${i}`;
    insertUser.run(userId, name, nowIso, nowIso);
    insertRequest.run("u1", userId, nowIso, nowIso);
  }
}

function seedDatabase(db) {
  seedUsers(db);
  seedTopics(db);

  const isRunningTests = process.argv[1] && (process.argv[1].endsWith("run.mjs") || process.argv[1].includes("tests"));
  if (!isRunningTests) {
    seedFakeFriendRequests(db);
  }
}

function purgeDemoData(db) {
  const demoUserIds = initialUsers.map((user) => user.id);
  const demoTopicIds = getSeedTopicEntries().map((_, index) => `topic-${index + 1}`);
  const demoMessageIds = demoTopicIds.length
    ? db.prepare(`
      SELECT id
      FROM messages
      WHERE topic_id IN (${demoTopicIds.map(() => "?").join(", ")})
    `).all(...demoTopicIds).map((row) => String(row.id))
    : [];

  if (demoTopicIds.length) {
    db.prepare(`
      DELETE FROM reports
      WHERE entity_type = 'topic' AND entity_id IN (${demoTopicIds.map(() => "?").join(", ")})
    `).run(...demoTopicIds);
    db.prepare(`
      DELETE FROM topics
      WHERE id IN (${demoTopicIds.map(() => "?").join(", ")})
    `).run(...demoTopicIds);
  }

  if (demoMessageIds.length) {
    db.prepare(`
      DELETE FROM reports
      WHERE entity_type = 'message' AND entity_id IN (${demoMessageIds.map(() => "?").join(", ")})
    `).run(...demoMessageIds);
  }

  if (demoUserIds.length) {
    db.prepare(`
      DELETE FROM reports
      WHERE entity_type = 'user' AND entity_id IN (${demoUserIds.map(() => "?").join(", ")})
    `).run(...demoUserIds);
    db.prepare(`
      DELETE FROM sessions
      WHERE user_id IN (${demoUserIds.map(() => "?").join(", ")})
    `).run(...demoUserIds);
    db.prepare(`
      DELETE FROM users
      WHERE id IN (${demoUserIds.map(() => "?").join(", ")})
        AND NOT EXISTS (SELECT 1 FROM topics WHERE topics.author_id = users.id)
        AND NOT EXISTS (SELECT 1 FROM messages WHERE messages.author_id = users.id)
    `).run(...demoUserIds);
  }

  rebuildActiveTopicRanks(db);
}

function mapViewerRow(row, sessionRow) {
  const viewerType = row?.type === "registered" ? "registered" : "guest";
  const rateLimits = getRateLimitConfig(viewerType);
  const lastTopicAt = viewerType === "registered"
    ? row?.last_topic_at ?? null
    : sessionRow?.last_topic_at ?? null;
  const lastMessageAt = viewerType === "registered"
    ? row?.last_message_at ?? null
    : sessionRow?.last_message_at ?? null;
  const displayName = viewerType === "guest"
    ? sessionRow?.guest_label || row.name
    : row.name;
  return {
    id: row.id,
    type: viewerType,
    displayName,
    nickname: row.nickname ?? null,
    role: getEffectiveViewerRole(row),
    isAdmin: row.type === "registered" && canModerate(row),
    email: row.email ?? null,
    emailVerified: Boolean(row.email_verified_at),
    registrationAge: row.registration_age ?? null,
    termsAccepted: Boolean(row.terms_accepted_at),
    description: row.description ?? "",
    profileShowDescription: row.profile_show_description !== 0,
    profileShowJoinedAt: row.profile_show_joined_at !== 0,
    socialWhatsapp: row.social_whatsapp ?? "",
    socialInstagram: row.social_instagram ?? "",
    socialTiktok: row.social_tiktok ?? "",
    socialFacebook: row.social_facebook ?? "",
    socialTwitter: row.social_twitter ?? "",
    socialDiscord: row.social_discord ?? "",
    profileShowSocial: row.profile_show_social !== 0,
    profileIndexable: row.profile_indexable !== 0,
    likesAnonymous: row.likes_anonymous === 1,
    filterProfanity: row.filter_profanity === 1,
    notificationsFriendsOnly: row.notifications_friends_only === 1,
    createdAt: row.created_at ?? null,
    avatarUrl: row.avatar_url ?? null,
    avatarPendingUrl: row.avatar_pending_url ?? null,
    avatarReviewStatus: row.avatar_review_status ?? null,
    profilePending: Boolean(row.profile_pending),
    profileSuggestedName: row.profile_suggested_name ?? null,
    profileSuggestedAvatarUrl: row.profile_suggested_avatar_url ?? null,
    authProvider: row.auth_provider ?? null,
    hasPassword: viewerType === "registered" && Boolean(row.password_hash),
    canLinkGoogle: viewerType === "registered" && Boolean(row.password_hash && row.email && !row.auth_provider && !row.auth_subject),
    rateLimits: {
      createTopicMs: rateLimits.createTopicMs,
      postMessageMs: rateLimits.postMessageMs,
      lastTopicAt,
      lastMessageAt
    }
  };
}

function createGuestName() {
  const suffix = Math.floor(Math.random() * 90) + 10;
  return `${GUEST_DISPLAY_NAME}${suffix}`;
}

function createTransientGuestName(sessionId) {
  const sum = String(sessionId || "")
    .split("")
    .reduce((total, character) => total + character.charCodeAt(0), 0);
  return `${GUEST_DISPLAY_NAME}${(sum % 90) + 10}`;
}

function createTransientGuestContext(sessionId, ipAddress = "") {
  const name = createTransientGuestName(sessionId);
  const safeSessionLabel = String(sessionId || "")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 48) || "anon";
  const viewerRow = {
    id: `guest-preview-${safeSessionLabel}`,
    name,
    type: "guest",
    role: "Invitado",
    score: 0,
    status: "active"
  };

  return {
    sessionId,
    sessionRow: null,
    viewerRow,
    viewer: mapViewerRow(viewerRow, null),
    ipAddress: normalizeIpAddress(ipAddress)
  };
}

function getOrCreateGuestUser(db) {
  const nowIso = new Date().toISOString();

  db.prepare(`
    INSERT INTO users (id, name, type, role, score, status, created_at, updated_at)
    VALUES (?, ?, 'guest', 'Invitado', 0, 'active', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      updated_at = excluded.updated_at
  `).run(SHARED_GUEST_USER_ID, GUEST_DISPLAY_NAME, nowIso, nowIso);

  return db.prepare("SELECT * FROM users WHERE id = ?").get(SHARED_GUEST_USER_ID);
}

function pruneGuestSessions(db, ipAddress = "", nowMs = Date.now(), keepSessionId = "") {
  const expiresBeforeIso = new Date(nowMs - GUEST_SESSION_TTL_MS).toISOString();
  const perIpOffset = keepSessionId ? Math.max(0, GUEST_SESSION_MAX_PER_IP - 1) : GUEST_SESSION_MAX_PER_IP;
  const totalOffset = keepSessionId ? Math.max(0, GUEST_SESSION_MAX_TOTAL - 1) : GUEST_SESSION_MAX_TOTAL;
  let deletedSessions = 0;

  deletedSessions += db.prepare(`
    DELETE FROM sessions
    WHERE auth_mode = 'guest' AND updated_at < ? AND id <> ?
  `).run(expiresBeforeIso, keepSessionId).changes ?? 0;

  const normalizedIpAddress = normalizeIpAddress(ipAddress);
  if (normalizedIpAddress) {
    deletedSessions += db.prepare(`
      DELETE FROM sessions
      WHERE id IN (
        SELECT id
        FROM sessions
        WHERE auth_mode = 'guest' AND last_ip = ? AND id <> ?
        ORDER BY updated_at DESC, created_at DESC, id DESC
        LIMIT -1 OFFSET ?
      )
    `).run(normalizedIpAddress, keepSessionId, perIpOffset).changes ?? 0;
  }

  deletedSessions += db.prepare(`
    DELETE FROM sessions
    WHERE id IN (
      SELECT id
      FROM sessions
      WHERE auth_mode = 'guest' AND id <> ?
      ORDER BY updated_at DESC, created_at DESC, id DESC
      LIMIT -1 OFFSET ?
    )
  `).run(keepSessionId, totalOffset).changes ?? 0;

  const deletedGuestIpRateLimits = db.prepare(`
    DELETE FROM guest_ip_rate_limits
    WHERE updated_at < ?
  `).run(expiresBeforeIso).changes ?? 0;

  return {
    deletedSessions,
    deletedGuestIpRateLimits
  };
}

function getRegisteredViewerRow(db, userId = REGISTERED_USER_ID) {
  const viewerRow = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!viewerRow) {
    throw new ApiError(500, "REGISTERED_VIEWER_MISSING", "No se encontro el usuario registrado inicial.");
  }
  if (viewerRow.type !== "registered") {
    throw new ApiError(400, "INVALID_REGISTERED_VIEWER", "El usuario solicitado no es un usuario registrado.");
  }

  return viewerRow;
}

function readSessionRow(db, sessionId) {
  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
}

function createRotatedSessionId(previousSessionId = "") {
  let nextSessionId;
  do {
    nextSessionId = `session-${crypto.randomUUID()}`;
  } while (nextSessionId === previousSessionId);

  return nextSessionId;
}

function invalidateSession(db, sessionId) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (normalizedSessionId) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(normalizedSessionId);
  }
}

function invalidatePreviousSession(db, previousSessionId, nextSessionId) {
  if (previousSessionId && previousSessionId !== nextSessionId) {
    invalidateSession(db, previousSessionId);
  }
}

function createGuestSession(db, sessionId, ipAddress, nowIso, existingSessionRow = null) {
  const resolvedIpAddress = normalizeIpAddress(ipAddress || existingSessionRow?.last_ip || "");
  const guestRow = getOrCreateGuestUser(db);
  const guestLabel = existingSessionRow?.auth_mode === "guest" && existingSessionRow.guest_label
    ? existingSessionRow.guest_label
    : createGuestName();

  if (existingSessionRow) {
    db.prepare(`
      UPDATE sessions
      SET user_id = ?, auth_mode = 'guest', guest_label = ?, last_ip = ?, last_topic_at = NULL, last_message_at = NULL, updated_at = ?
      WHERE id = ?
    `).run(guestRow.id, guestLabel, resolvedIpAddress, nowIso, sessionId);
  } else {
    db.prepare(`
      INSERT INTO sessions (
        id, user_id, auth_mode, guest_label, last_ip, last_topic_at, last_message_at, created_at, updated_at
      ) VALUES (?, ?, 'guest', ?, ?, NULL, NULL, ?, ?)
    `).run(sessionId, guestRow.id, guestLabel, resolvedIpAddress, nowIso, nowIso);
  }

  pruneGuestSessions(db, resolvedIpAddress, new Date(nowIso).getTime(), sessionId);
  const sessionRow = readSessionRow(db, sessionId);
  return {
    sessionId,
    sessionRow,
    viewerRow: guestRow,
    viewer: mapViewerRow(guestRow, sessionRow),
    ipAddress: normalizeIpAddress(resolvedIpAddress || sessionRow?.last_ip || "")
  };
}

function createRegisteredSession(db, sessionId, ipAddress, nowIso, existingSessionRow = null, userId = REGISTERED_USER_ID) {
  const registeredViewerRow = getRegisteredViewerRow(db, userId);
  const resolvedIpAddress = normalizeIpAddress(ipAddress || existingSessionRow?.last_ip || "");

  if (existingSessionRow?.id === sessionId) {
    db.prepare(`
      UPDATE sessions
      SET user_id = ?, auth_mode = 'registered', guest_label = NULL, last_ip = ?, last_topic_at = ?, last_message_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      registeredViewerRow.id,
      resolvedIpAddress,
      registeredViewerRow.last_topic_at ?? null,
      registeredViewerRow.last_message_at ?? null,
      nowIso,
      sessionId
    );
  } else {
    db.prepare(`
      INSERT INTO sessions (
        id, user_id, auth_mode, guest_label, last_ip, last_topic_at, last_message_at, created_at, updated_at
      ) VALUES (?, ?, 'registered', NULL, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      registeredViewerRow.id,
      resolvedIpAddress,
      registeredViewerRow.last_topic_at ?? null,
      registeredViewerRow.last_message_at ?? null,
      nowIso,
      nowIso
    );
  }

  const sessionRow = readSessionRow(db, sessionId);
  return {
    sessionId,
    sessionRow,
    viewerRow: registeredViewerRow,
    viewer: mapViewerRow(registeredViewerRow, sessionRow),
    ipAddress: normalizeIpAddress(resolvedIpAddress || sessionRow?.last_ip || "")
  };
}

function resolveViewer(db, { sessionId, authMode = "guest", ipAddress = "", persistGuest = false }) {
  const normalizedSessionId = ensureViewerSessionId(sessionId);
  const fallbackAuthMode = authMode === "registered" ? "registered" : "guest";
  const nowIso = new Date().toISOString();
  const sessionRow = readSessionRow(db, normalizedSessionId);

  if (!sessionRow) {
    if (fallbackAuthMode === "registered") {
      return createRegisteredSession(db, normalizedSessionId, ipAddress, nowIso);
    }

    return persistGuest
      ? createGuestSession(db, normalizedSessionId, ipAddress, nowIso)
      : createTransientGuestContext(normalizedSessionId, ipAddress);
  }

  const resolvedIpAddress = normalizeIpAddress(ipAddress || sessionRow.last_ip || "");

  accumulatePresence(db, sessionRow.user_id, sessionRow.updated_at, nowIso);

  db.prepare(`
    UPDATE sessions
    SET last_ip = ?, updated_at = ?
    WHERE id = ?
  `).run(resolvedIpAddress, nowIso, normalizedSessionId);

  if (sessionRow.auth_mode === "registered") {
    return createRegisteredSession(db, normalizedSessionId, resolvedIpAddress, nowIso, sessionRow, sessionRow.user_id || REGISTERED_USER_ID);
  }

  let viewerRow = db.prepare("SELECT * FROM users WHERE id = ?").get(sessionRow.user_id);
  if (!viewerRow || viewerRow.type !== "guest") {
    return createGuestSession(db, normalizedSessionId, resolvedIpAddress, nowIso, sessionRow);
  }

  const updatedSession = readSessionRow(db, normalizedSessionId);
  return {
    sessionId: normalizedSessionId,
    sessionRow: updatedSession,
    viewerRow,
    viewer: mapViewerRow(viewerRow, updatedSession),
    ipAddress: normalizeIpAddress(resolvedIpAddress || updatedSession?.last_ip || "")
  };
}

function getFrontendUsers(db, viewerId, profileUserIds = []) {
  const friendshipStatusByUserId = arguments[3] instanceof Map ? arguments[3] : new Map();
  const extraUserIds = [...new Set(profileUserIds.filter((userId) => userId && userId !== viewerId))];
  const extraUserFilter = extraUserIds.length ? ` OR users.id IN (${extraUserIds.map(() => "?").join(", ")})` : "";
  const nowMs = Date.now();

  const rows = db.prepare(`
    SELECT
      users.id, users.name, users.nickname, users.type, users.role, users.score, users.description,
      users.profile_show_description AS profileShowDescription,
      users.profile_show_joined_at AS profileShowJoinedAt,
      users.social_whatsapp AS socialWhatsapp,
      users.social_instagram AS socialInstagram,
      users.social_tiktok AS socialTiktok,
      users.social_facebook AS socialFacebook,
      users.social_twitter AS socialTwitter,
      users.social_discord AS socialDiscord,
      users.profile_show_social AS profileShowSocial,
      users.created_at AS createdAt,
      users.avatar_url AS avatarUrl,
      users.avatar_pending_url AS avatarPendingUrl,
      users.avatar_review_status AS avatarReviewStatus,
      users.profile_pending AS profilePending,
      users.total_connected_seconds AS totalConnectedSeconds,
      users.connected_seconds_24h AS connectedSeconds24h,
      COALESCE(post_stats.post_count, 0) AS postCount,
      COALESCE(comment_stats.comment_count, 0) AS commentCount,
      COALESCE(like_stats.like_count, 0) AS likeCount,
      presence.last_seen_at AS lastSeenAt
    FROM users
    LEFT JOIN (
      SELECT author_id, COUNT(*) AS post_count FROM topics WHERE status != 'blocked' GROUP BY author_id
    ) post_stats ON post_stats.author_id = users.id
    LEFT JOIN (
      SELECT author_id, COUNT(*) AS comment_count FROM messages WHERE kind = 'user' AND is_root = 0 GROUP BY author_id
    ) comment_stats ON comment_stats.author_id = users.id
    LEFT JOIN (
      SELECT author_id, SUM(likes) AS like_count FROM messages WHERE kind = 'user' GROUP BY author_id
    ) like_stats ON like_stats.author_id = users.id
    LEFT JOIN (
      SELECT user_id, MAX(updated_at) AS last_seen_at FROM sessions GROUP BY user_id
    ) presence ON presence.user_id = users.id
    WHERE users.status = 'active' AND (users.type = 'registered' OR users.id = ?${extraUserFilter})
    ORDER BY
      COALESCE(post_stats.post_count, 0) DESC,
      COALESCE(comment_stats.comment_count, 0) DESC,
      COALESCE(like_stats.like_count, 0) DESC,
      users.total_connected_seconds DESC,
      users.connected_seconds_24h DESC,
      users.created_at ASC
    LIMIT 80
  `).all(viewerId, ...extraUserIds);

  return rows.map((user) => {
    const { lastSeenAt, ...rest } = user;
    return {
      ...rest,
      online: Boolean(lastSeenAt) && nowMs - new Date(lastSeenAt).getTime() <= PRESENCE_ONLINE_WINDOW_MS,
      profileShowDescription: user.profileShowDescription !== 0,
      profileShowJoinedAt: user.profileShowJoinedAt !== 0,
      profileShowSocial: user.profileShowSocial !== 0,
      friendshipStatus: user.id === viewerId ? "self" : friendshipStatusByUserId.get(user.id) || "none"
    };
  });
}

function hydrateTopicMessages(db, topicId, viewerId = null) {
  return db.prepare(`
    SELECT
      messages.id,
      messages.topic_id,
      messages.author_id,
      messages.text,
      messages.kind,
      messages.likes,
      messages.dislikes,
      messages.is_root,
      messages.created_at,
      CASE WHEN message_likes.user_id IS NULL THEN 0 ELSE 1 END AS liked_by_viewer,
      CASE WHEN message_dislikes.user_id IS NULL THEN 0 ELSE 1 END AS disliked_by_viewer,
      (
        SELECT CASE WHEN liker.likes_anonymous = 1 THEN NULL ELSE liker.id END
        FROM message_likes last_like
        JOIN users liker ON liker.id = last_like.user_id
        WHERE last_like.message_id = messages.id
        ORDER BY last_like.created_at DESC, last_like.rowid DESC
        LIMIT 1
      ) AS last_like_by_id,
      (
        SELECT CASE WHEN liker.likes_anonymous = 1 THEN NULL ELSE liker.name END
        FROM message_likes last_like
        JOIN users liker ON liker.id = last_like.user_id
        WHERE last_like.message_id = messages.id
        ORDER BY last_like.created_at DESC, last_like.rowid DESC
        LIMIT 1
      ) AS last_like_by_name
    FROM messages
    LEFT JOIN message_likes ON message_likes.message_id = messages.id AND message_likes.user_id = ?
    LEFT JOIN message_dislikes ON message_dislikes.message_id = messages.id AND message_dislikes.user_id = ?
    WHERE messages.topic_id = ?
    ORDER BY messages.id ASC
  `).all(viewerId || "", viewerId || "", topicId).map((row) => ({
    id: `message-${row.id}`,
    topicId: row.topic_id,
    authorId: row.author_id,
    text: row.text,
    kind: row.kind,
    likes: row.likes,
    dislikes: row.dislikes,
    isRoot: Boolean(row.is_root),
    likedByViewer: Boolean(row.liked_by_viewer),
    dislikedByViewer: Boolean(row.disliked_by_viewer),
    lastLikeById: row.last_like_by_id ?? null,
    lastLikeByName: row.last_like_by_name ?? null,
    createdAt: row.created_at,
    timestamp: row.created_at
  }));
}

function formatBackendCommentCount(count) {
  return count === 1 ? "1 comentario" : `${count} comentarios`;
}

function formatBackendLikeCount(count) {
  return count === 1 ? "1 like" : `${count} likes`;
}

function emptyRankingEntry(title, meta) {
  return [{ id: "empty", title, count: 0, meta, active: false }];
}

function mapRankingRows(rows, { emptyTitle, emptyMeta, formatMeta, currentUserId = null }) {
  if (!rows.length) {
    return emptyRankingEntry(emptyTitle, emptyMeta);
  }

  return rows.map((row) => ({
    id: String(row.id),
    title: row.title,
    count: Number(row.count ?? 0),
    meta: formatMeta(Number(row.count ?? 0)),
    active: currentUserId ? row.id === currentUserId : false
  }));
}

function getBackendPostRankingEntries(db, metric = "comments") {
  const rows = metric === "likes"
    ? db.prepare(`
      SELECT topics.id, topics.title, COALESCE(SUM(messages.likes), 0) AS count
      FROM topics
      JOIN messages ON messages.topic_id = topics.id AND messages.kind = 'user'
      WHERE topics.status != ?
      GROUP BY topics.id
      HAVING count > 0
      ORDER BY count DESC, topics.last_activity_at DESC, topics.created_at DESC
      LIMIT 10
    `).all(TOPIC_STATUS_EXPELLED)
    : db.prepare(`
      SELECT topics.id, topics.title, COUNT(messages.id) AS count
      FROM topics
      JOIN messages ON messages.topic_id = topics.id AND messages.kind = 'user'
      WHERE topics.status != ?
      GROUP BY topics.id
      HAVING count > 0
      ORDER BY count DESC, topics.last_activity_at DESC, topics.created_at DESC
      LIMIT 10
    `).all(TOPIC_STATUS_EXPELLED);

  return mapRankingRows(rows, {
    emptyTitle: metric === "likes" ? "Sin likes" : "Sin comentarios",
    emptyMeta: metric === "likes" ? "Los likes apareceran cuando usuarios reales voten." : "Los temas apareceran cuando usuarios reales publiquen.",
    formatMeta: metric === "likes" ? formatBackendLikeCount : formatBackendCommentCount
  });
}

function getBackendUserRankingEntries(db, { metric = "comments", selectedTopicId = null, currentUserId = null } = {}) {
  const topicFilter = selectedTopicId ? "AND messages.topic_id = ?" : "";
  const params = selectedTopicId ? [selectedTopicId] : [];
  const rows = metric === "likes"
    ? db.prepare(`
      SELECT users.id, users.name AS title, COALESCE(SUM(messages.likes), 0) AS count
      FROM messages
      JOIN users ON users.id = messages.author_id
      JOIN topics ON topics.id = messages.topic_id
      WHERE messages.kind = 'user'
        AND users.status = 'active'
        AND users.type = 'registered'
        AND topics.status != '${TOPIC_STATUS_EXPELLED}'
        ${topicFilter}
      GROUP BY users.id
      HAVING count > 0
      ORDER BY count DESC, users.created_at ASC
      LIMIT 10
    `).all(...params)
    : db.prepare(`
      SELECT users.id, users.name AS title, COUNT(messages.id) AS count
      FROM messages
      JOIN users ON users.id = messages.author_id
      JOIN topics ON topics.id = messages.topic_id
      WHERE messages.kind = 'user'
        AND users.status = 'active'
        AND users.type = 'registered'
        AND topics.status != '${TOPIC_STATUS_EXPELLED}'
        ${topicFilter}
      GROUP BY users.id
      HAVING count > 0
      ORDER BY count DESC, users.created_at ASC
      LIMIT 10
    `).all(...params);

  return mapRankingRows(rows, {
    emptyTitle: metric === "likes" ? "Sin likes" : "Sin comentarios",
    emptyMeta: metric === "likes" ? "Los likes apareceran cuando usuarios reales voten." : "Los usuarios apareceran cuando empiecen a comentar.",
    formatMeta: metric === "likes" ? formatBackendLikeCount : formatBackendCommentCount,
    currentUserId
  });
}

function buildBackendRankings(db, context, selectedTopicId = null) {
  return {
    global: {
      posts: {
        comments: getBackendPostRankingEntries(db, "comments"),
        likes: getBackendPostRankingEntries(db, "likes")
      },
      users: {
        comments: getBackendUserRankingEntries(db, { metric: "comments", currentUserId: context.viewer.id }),
        likes: getBackendUserRankingEntries(db, { metric: "likes", currentUserId: context.viewer.id })
      }
    },
    topic: {
      users: {
        comments: selectedTopicId
          ? getBackendUserRankingEntries(db, { metric: "comments", selectedTopicId, currentUserId: context.viewer.id })
          : emptyRankingEntry("Sin tema", "Selecciona un tema para ver su actividad real."),
        likes: selectedTopicId
          ? getBackendUserRankingEntries(db, { metric: "likes", selectedTopicId, currentUserId: context.viewer.id })
          : emptyRankingEntry("Sin tema", "Selecciona un tema para ver su actividad real.")
      }
    }
  };
}
function hydrateTopic(db, row, { forceVisible = null, viewerId = null } = {}) {
  const isVisible = forceVisible ?? (row.status !== TOPIC_STATUS_EXPELLED && row.active_rank !== null && row.active_rank < VISIBLE_TOPIC_LIMIT);

  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    authorId: row.author_id,
    status: row.status,
    activeRank: row.active_rank,
    isVisible,
    visible: isVisible,
    messageCount: db.prepare("SELECT COUNT(*) AS count FROM messages WHERE topic_id = ?").get(row.id)?.count ?? 0,
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
    messages: hydrateTopicMessages(db, row.id, viewerId)
  };
}

function getOrderedActiveTopicRows(db) {
  return db.prepare(`
    SELECT *
    FROM topics
    WHERE status IN (?, ?)
    ORDER BY
      CASE WHEN status = ? THEN 0 ELSE 1 END ASC,
      last_message_id DESC,
      created_at DESC,
      id DESC
  `).all(TOPIC_STATUS_ACTIVE, TOPIC_STATUS_PINNED, TOPIC_STATUS_PINNED);
}

function rebuildActiveTopicRanks(db) {
  const orderedRows = getOrderedActiveTopicRows(db);
  const keptRows = orderedRows.slice(0, ACTIVE_TOPIC_LIMIT);
  const droppedRows = orderedRows.slice(ACTIVE_TOPIC_LIMIT);
  const updateRank = db.prepare("UPDATE topics SET active_rank = ?, updated_at = ? WHERE id = ?");
  const expelTopic = db.prepare(`
    UPDATE topics
    SET status = ?, active_rank = NULL, updated_at = ?
    WHERE id = ?
  `);
  const nowIso = new Date().toISOString();

  keptRows.forEach((row, index) => {
    updateRank.run(index, nowIso, row.id);
  });

  droppedRows.forEach((row) => {
    expelTopic.run(TOPIC_STATUS_EXPELLED, nowIso, row.id);
  });

  db.prepare(`
    UPDATE topics
    SET active_rank = NULL
    WHERE status = ?
  `).run(TOPIC_STATUS_BLOCKED);
}

function getActiveTopicsForFrontend(db) {
  return db.prepare(`
    SELECT *
    FROM topics
    WHERE status IN (?, ?)
    ORDER BY active_rank ASC
    LIMIT ?
  `).all(TOPIC_STATUS_ACTIVE, TOPIC_STATUS_PINNED, ACTIVE_TOPIC_LIMIT);
}

function getFriendshipUserSummary(row) {
  return {
    id: row.id,
    name: row.name,
    nickname: row.nickname ?? null,
    avatarUrl: row.avatar_url ?? null
  };
}

function getFriendshipsForFrontend(db, viewerId) {
  const empty = { incoming: [], outgoing: [], friends: [] };
  if (!viewerId) {
    return empty;
  }

  const viewerRow = db.prepare("SELECT id, type FROM users WHERE id = ?").get(viewerId);
  if (!viewerRow || viewerRow.type !== "registered") {
    return empty;
  }

  const incoming = db.prepare(`
    SELECT users.id, users.name, users.nickname, users.avatar_url
    FROM friend_requests
    JOIN users ON users.id = friend_requests.requester_id
    WHERE friend_requests.addressee_id = ?
      AND friend_requests.status = 'pending'
      AND users.status = 'active'
    ORDER BY friend_requests.updated_at DESC, friend_requests.id DESC
    LIMIT 50
  `).all(viewerId).map(getFriendshipUserSummary);

  const outgoing = db.prepare(`
    SELECT users.id, users.name, users.nickname, users.avatar_url
    FROM friend_requests
    JOIN users ON users.id = friend_requests.addressee_id
    WHERE friend_requests.requester_id = ?
      AND friend_requests.status = 'pending'
      AND users.status = 'active'
    ORDER BY friend_requests.updated_at DESC, friend_requests.id DESC
    LIMIT 50
  `).all(viewerId).map(getFriendshipUserSummary);

  const nowMs = Date.now();
  const friends = db.prepare(`
    SELECT users.id, users.name, users.nickname, users.avatar_url, presence.last_seen_at
    FROM friend_requests
    JOIN users ON users.id = CASE
      WHEN friend_requests.requester_id = ? THEN friend_requests.addressee_id
      ELSE friend_requests.requester_id
    END
    LEFT JOIN (
      SELECT user_id, MAX(updated_at) AS last_seen_at FROM sessions GROUP BY user_id
    ) presence ON presence.user_id = users.id
    WHERE friend_requests.status = 'accepted'
      AND (friend_requests.requester_id = ? OR friend_requests.addressee_id = ?)
      AND users.status = 'active'
    ORDER BY friend_requests.updated_at DESC, users.name ASC
    LIMIT 80
  `).all(viewerId, viewerId, viewerId).map((row) => ({
    ...getFriendshipUserSummary(row),
    online: Boolean(row.last_seen_at) && nowMs - new Date(row.last_seen_at).getTime() <= PRESENCE_ONLINE_WINDOW_MS
  }));

  return { incoming, outgoing, friends };
}

function getFriendshipStatusByUserId(friendships) {
  const statusByUserId = new Map();
  friendships.friends.forEach((user) => statusByUserId.set(user.id, "friend"));
  friendships.incoming.forEach((user) => statusByUserId.set(user.id, "incoming-request"));
  friendships.outgoing.forEach((user) => statusByUserId.set(user.id, "outgoing-request"));
  return statusByUserId;
}

function getFriendRequestBetween(db, leftUserId, rightUserId) {
  return db.prepare(`
    SELECT *
    FROM friend_requests
    WHERE (requester_id = ? AND addressee_id = ?)
       OR (requester_id = ? AND addressee_id = ?)
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `).get(leftUserId, rightUserId, rightUserId, leftUserId);
}

function assertFriendTarget(db, viewerId, targetUserId) {
  const normalizedTargetUserId = String(targetUserId || "").trim();
  if (!normalizedTargetUserId) {
    throw new ApiError(400, "VALIDATION_ERROR", "Selecciona un usuario para agregar.");
  }
  if (normalizedTargetUserId === viewerId) {
    throw new ApiError(400, "INVALID_FRIEND_TARGET", "No puedes agregarte a ti mismo.");
  }

  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(normalizedTargetUserId);
  if (!target || target.type !== "registered" || target.status !== USER_STATUS_ACTIVE) {
    throw new ApiError(404, "NOT_FOUND", "Usuario no disponible para amistad.");
  }

  return target;
}

function assertRegisteredFriendContext(db, context) {
  assertContextCanParticipate(db, context);
  if (context.viewer.type !== "registered") {
    throw new ApiError(403, "LOGIN_REQUIRED", "Hace falta iniciar sesion para agregar amigos.");
  }
}
function buildFrontendPayload(db, context, selectedTopicId = null, profileNickname = null) {
  rebuildActiveTopicRanks(db);

  const activeTopicRows = getActiveTopicsForFrontend(db);
  const topicIds = new Set(activeTopicRows.map((row) => row.id));
  const topics = activeTopicRows.map((row) => hydrateTopic(db, row, { viewerId: context.viewer.id }));
  const reportSnapshot = getReportSnapshot(db, context.sessionId);
  const friendships = getFriendshipsForFrontend(db, context.viewer.id);
  const friendshipStatusByUserId = getFriendshipStatusByUserId(friendships);
  let resolvedSelectedTopicId = selectedTopicId && topicIds.has(selectedTopicId) ? selectedTopicId : null;

  if (selectedTopicId && !topicIds.has(selectedTopicId)) {
    const selectedRow = db.prepare("SELECT * FROM topics WHERE id = ?").get(selectedTopicId);
    if (selectedRow) {
      topics.push(hydrateTopic(db, selectedRow, { forceVisible: false, viewerId: context.viewer.id }));
      resolvedSelectedTopicId = selectedTopicId;
    }
  }

  const profileUserIds = topics.flatMap((topic) => [
    topic.authorId,
    ...topic.messages.map((message) => message.authorId)
  ]);

  if (profileNickname) {
    const sharedProfileRow = db.prepare(
      "SELECT id FROM users WHERE nickname_norm = ? AND type = 'registered' AND status = 'active'"
    ).get(normalizeUniqueNameKey(profileNickname));
    if (sharedProfileRow) {
      profileUserIds.push(sharedProfileRow.id);
    }
  }

  let pendingModerationCount = 0;
  if (context.viewer.role === "admin") {
    const reportsCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM reports
      WHERE status = ?
    `).get(REPORT_STATUS_OPEN)?.count ?? 0;

    const avatarsCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM users
      WHERE type = 'registered' AND avatar_pending_url IS NOT NULL AND avatar_pending_url <> ''
    `).get()?.count ?? 0;

    pendingModerationCount = reportsCount + avatarsCount;
  }

  return {
    sessionId: context.sessionId,
    viewer: context.viewer,
    users: getFrontendUsers(db, context.viewer.id, profileUserIds).map((user) => ({
      ...user,
      friendshipStatus: user.id === context.viewer.id ? "self" : friendshipStatusByUserId.get(user.id) || "none"
    })),
    friendships,
    topics,
    selectedTopicId: resolvedSelectedTopicId,
    reportedTopicIds: reportSnapshot.reportedTopicIds,
    reportedMessageIds: reportSnapshot.reportedMessageIds,
    rankings: buildBackendRankings(db, context, resolvedSelectedTopicId),
    pendingModerationCount
  };
}

function assertRateLimit(lastAtIso, viewerType, fieldName) {
  const now = Date.now();
  const limits = getRateLimitConfig(viewerType);
  const config = fieldName === "last_topic_at"
    ? { waitMs: limits.createTopicMs, code: "RATE_LIMITED", message: "Todavia no puedes crear otro tema." }
    : { waitMs: limits.postMessageMs, code: "RATE_LIMITED", message: "Todavia no puedes comentar de nuevo." };

  if (!lastAtIso) {
    return;
  }

  const nextAllowedAt = new Date(lastAtIso).getTime() + config.waitMs;
  if (nextAllowedAt > now) {
    throw new ApiError(429, config.code, config.message, {
      retryAfterSeconds: computeRetryAfterSeconds(nextAllowedAt, now)
    });
  }
}

function getGuestIpActivityAt(db, context, fieldName) {
  const ipAddress = getEffectiveContextIpAddress(context);
  if (!ipAddress) {
    return null;
  }

  const row = db.prepare(`
    SELECT ${fieldName} AS last_at
    FROM guest_ip_rate_limits
    WHERE ip_address = ?
    LIMIT 1
  `).get(ipAddress);

  return row?.last_at ?? null;
}

function getContextActivityAt(db, context, fieldName) {
  if (context.viewer.type === "registered") {
    return context.viewerRow[fieldName];
  }

  return getGuestIpActivityAt(db, context, fieldName) || context.sessionRow[fieldName];
}

function updateViewerActivity(db, context, fieldName) {
  const nowIso = new Date().toISOString();
  db.prepare(`
    UPDATE sessions
    SET ${fieldName} = ?, updated_at = ?
    WHERE id = ?
  `).run(nowIso, nowIso, context.sessionId);

  if (context.viewer.type === "registered") {
    db.prepare(`
      UPDATE users
      SET ${fieldName} = ?, updated_at = ?
      WHERE id = ?
    `).run(nowIso, nowIso, context.viewer.id);
    return;
  }

  const ipAddress = getEffectiveContextIpAddress(context);
  if (ipAddress) {
    db.prepare(`
      INSERT INTO guest_ip_rate_limits (ip_address, ${fieldName}, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(ip_address) DO UPDATE SET
        ${fieldName} = excluded.${fieldName},
        updated_at = excluded.updated_at
    `).run(ipAddress, nowIso, nowIso, nowIso);
  }
}

function validateTopicInput(title, text) {
  const normalizedTitle = normalizeTopicTitle(title);
  const normalizedText = normalizeMessageText(text);

  if (!normalizedTitle) {
    throw new ApiError(400, "VALIDATION_ERROR", "El titulo del tema es obligatorio.");
  }
  if (!normalizedText) {
    throw new ApiError(400, "VALIDATION_ERROR", "El mensaje es obligatorio.");
  }
  if (normalizedTitle.length > TOPIC_TITLE_MAX_LENGTH) {
    throw new ApiError(400, "VALIDATION_ERROR", "El titulo excede el maximo permitido.");
  }
  if (normalizedText.length > MESSAGE_TEXT_MAX_LENGTH) {
    throw new ApiError(400, "VALIDATION_ERROR", "El mensaje excede el maximo permitido.");
  }

  return {
    normalizedTitle,
    normalizedText
  };
}

function validateMessageInput(text) {
  const normalizedText = normalizeMessageText(text);
  if (!normalizedText) {
    throw new ApiError(400, "VALIDATION_ERROR", "El mensaje es obligatorio.");
  }
  if (normalizedText.length > MESSAGE_TEXT_MAX_LENGTH) {
    throw new ApiError(400, "VALIDATION_ERROR", "El mensaje excede el maximo permitido.");
  }

  return normalizedText;
}

function validateReportReason(reason, entityType) {
  const normalizedReason = normalizeMessageText(reason);
  const fallbackReason = entityType === "message"
    ? "Reporte rapido sobre mensaje."
    : entityType === "user"
      ? "Reporte rapido sobre usuario."
      : "Reporte rapido sobre tema.";
  const finalReason = normalizedReason || fallbackReason;

  if (finalReason.length > REPORT_REASON_MAX_LENGTH) {
    throw new ApiError(400, "VALIDATION_ERROR", "El motivo del reporte excede el maximo permitido.");
  }

  return finalReason;
}

function normalizeMessageEntityId(messageId) {
  const normalized = String(messageId || "").trim();
  if (/^message-\d+$/.test(normalized)) {
    return normalized.slice("message-".length);
  }
  if (/^\d+$/.test(normalized)) {
    return normalized;
  }

  throw new ApiError(404, "NOT_FOUND", "Mensaje no encontrado.");
}

function assertViewerCanParticipate(viewerRow) {
  if (!viewerRow) {
    return;
  }

  if (viewerRow.status === USER_STATUS_EXPELLED) {
    throw new ApiError(403, "USER_EXPELLED", "Este usuario está expulsado permanentemente.");
  }

  if (viewerRow.banned_until) {
    const bannedUntil = new Date(viewerRow.banned_until);
    if (!Number.isNaN(bannedUntil.getTime()) && bannedUntil > new Date()) {
      const remainingHours = Math.ceil((bannedUntil - new Date()) / (1000 * 60 * 60));
      throw new ApiError(
        403,
        "USER_EXPELLED",
        `Este usuario está suspendido temporalmente por ${remainingHours} hora${remainingHours === 1 ? "" : "s"}.`
      );
    }
  }
}

function getEffectiveContextIpAddress(context) {
  return normalizeIpAddress(context.ipAddress || context.sessionRow?.last_ip || "");
}

function assertContextNotBlocked(db, context) {
  const blockedSession = db.prepare(`
    SELECT session_id
    FROM blocked_sessions
    WHERE session_id = ?
    LIMIT 1
  `).get(context.sessionId);
  if (blockedSession) {
    throw new ApiError(403, "SESSION_BLOCKED", "Esta sesion no puede participar en esta etapa.");
  }

  const effectiveIpAddress = getEffectiveContextIpAddress(context);
  if (!effectiveIpAddress) {
    return;
  }

  const blockedIp = db.prepare(`
    SELECT ip_address
    FROM blocked_ips
    WHERE ip_address = ?
    LIMIT 1
  `).get(effectiveIpAddress);
  if (blockedIp) {
    throw new ApiError(403, "IP_BLOCKED", "Esta IP no puede participar en esta etapa.");
  }
}

function assertProfileReady(context) {
  if (context.viewerRow?.type !== "registered" || !context.viewerRow.profile_pending) {
    return;
  }

  throw new ApiError(403, "PROFILE_REQUIRED", "Completa tu perfil antes de participar como usuario registrado.");
}

function assertContextCanParticipate(db, context) {
  assertViewerCanParticipate(context.viewerRow);
  assertContextNotBlocked(db, context);
  assertProfileReady(context);
}

function assertRegisteredContextCanPost(db, context) {
  assertContextCanParticipate(db, context);
  if (context.viewer.type !== "registered") {
    throw new ApiError(403, "LOGIN_REQUIRED", "Hace falta iniciar sesion para crear temas o comentar.");
  }
}

function assertExistingTopic(db, topicId) {
  const normalizedTopicId = String(topicId || "").trim();
  if (!normalizedTopicId) {
    throw new ApiError(404, "NOT_FOUND", "Tema no encontrado.");
  }

  const topicRow = db.prepare("SELECT * FROM topics WHERE id = ?").get(normalizedTopicId);
  if (!topicRow) {
    throw new ApiError(404, "NOT_FOUND", "Tema no encontrado.");
  }

  return topicRow;
}

function normalizeMessageLikeId(messageId) {
  const normalized = normalizeMessageEntityId(messageId);
  return Number(normalized);
}

function assertLikeableMessage(db, messageId) {
  const normalizedMessageId = normalizeMessageLikeId(messageId);
  const messageRow = db.prepare(`
    SELECT messages.id, messages.topic_id, messages.kind, topics.status AS topic_status
    FROM messages
    JOIN topics ON topics.id = messages.topic_id
    WHERE messages.id = ?
    LIMIT 1
  `).get(normalizedMessageId);
  if (!messageRow) {
    throw new ApiError(404, "NOT_FOUND", "Mensaje no encontrado.");
  }
  if (messageRow.kind === "system") {
    throw new ApiError(409, "INVALID_LIKE_TARGET", "Este mensaje no acepta likes.");
  }

  return messageRow;
}

function refreshMessageReactionCounts(db, messageId) {
  const likes = db.prepare("SELECT COUNT(*) AS count FROM message_likes WHERE message_id = ?").get(messageId)?.count ?? 0;
  const dislikes = db.prepare("SELECT COUNT(*) AS count FROM message_dislikes WHERE message_id = ?").get(messageId)?.count ?? 0;
  db.prepare("UPDATE messages SET likes = ?, dislikes = ? WHERE id = ?").run(likes, dislikes, messageId);
  return { likes, dislikes };
}

function recordMessageReaction(db, messageRow, userId, reactionType) {
  const tableName = reactionType === "dislike" ? "message_dislikes" : "message_likes";
  const existingReaction = db.prepare(`
    SELECT 'like' AS reaction_type
    FROM message_likes
    WHERE message_id = ? AND user_id = ?
    UNION ALL
    SELECT 'dislike' AS reaction_type
    FROM message_dislikes
    WHERE message_id = ? AND user_id = ?
    LIMIT 1
  `).get(messageRow.id, userId, messageRow.id, userId);

  if (existingReaction) {
    throw new ApiError(409, "MESSAGE_REACTION_LOCKED", "Ya reaccionaste a este comentario. Podras hacerlo de nuevo despues del reinicio diario.");
  }

  db.prepare(`
    INSERT INTO ${tableName} (message_id, user_id, created_at)
    VALUES (?, ?, ?)
  `).run(messageRow.id, userId, new Date().toISOString());

  refreshMessageReactionCounts(db, messageRow.id);
}
function assertExistingUser(db, userId) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    throw new ApiError(404, "NOT_FOUND", "Usuario no encontrado.");
  }

  const userRow = db.prepare("SELECT * FROM users WHERE id = ?").get(normalizedUserId);
  if (!userRow) {
    throw new ApiError(404, "NOT_FOUND", "Usuario no encontrado.");
  }

  return userRow;
}

function assertNicknameAvailable(db, nicknameKey, userId = null) {
  const existing = db.prepare(`
    SELECT id
    FROM users
    WHERE nickname_norm = ?
    LIMIT 1
  `).get(nicknameKey);
  if (existing && existing.id !== userId) {
    throw new ApiError(409, "NICKNAME_TAKEN", "Ese nickname ya esta en uso.");
  }
}
function normalizeGeneratedNicknameBase(value) {
  let candidate = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .replace(/^[^A-Za-z]+/, "")
    .replace(/[._-]+$/g, "");

  if (!candidate) {
    candidate = "Usuario";
  }
  if (candidate.length < NICKNAME_MIN_LENGTH) {
    candidate = `${candidate}_user`;
  }

  return normalizeNickname(candidate.slice(0, NICKNAME_MAX_LENGTH));
}

function createAvailableNickname(db, preferredValue, userId) {
  const baseNickname = normalizeGeneratedNicknameBase(preferredValue);
  const baseKey = normalizeNicknameKey(baseNickname);
  const existingBase = db.prepare("SELECT id FROM users WHERE nickname_norm = ? LIMIT 1").get(baseKey);
  if (!existingBase || existingBase.id === userId) {
    return baseNickname;
  }

  const digest = crypto
    .createHash("sha256")
    .update(String(userId || preferredValue || crypto.randomUUID()), "utf8")
    .digest("hex");

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = `_${digest.slice(0, 5)}${attempt || ""}`;
    const prefixLength = NICKNAME_MAX_LENGTH - suffix.length;
    const candidate = normalizeNickname(`${baseNickname.slice(0, prefixLength)}${suffix}`);
    const existing = db.prepare("SELECT id FROM users WHERE nickname_norm = ? LIMIT 1")
      .get(normalizeNicknameKey(candidate));
    if (!existing || existing.id === userId) {
      return candidate;
    }
  }

  throw new ApiError(409, "NICKNAME_TAKEN", "No pudimos generar un username disponible.");
}

function backfillRegisteredNicknames(db) {
  const rows = db.prepare(`
    SELECT id, name, nickname
    FROM users
    WHERE type = 'registered'
      AND profile_pending = 0
      AND (nickname IS NULL OR nickname = '' OR nickname_norm IS NULL OR nickname_norm = '')
    ORDER BY created_at ASC, id ASC
  `).all();

  const updateNickname = db.prepare(`
    UPDATE users
    SET nickname = ?, nickname_norm = ?
    WHERE id = ?
  `);

  rows.forEach((row) => {
    const nickname = createAvailableNickname(db, row.nickname || row.name, row.id);
    updateNickname.run(nickname, normalizeNicknameKey(nickname), row.id);
  });
}
function backfillVerifiedPasswordEmails(db) {
  db.prepare(`
    UPDATE users
    SET email_verified_at = terms_accepted_at
    WHERE type = 'registered'
      AND password_hash IS NOT NULL
      AND email IS NOT NULL
      AND email_verified_at IS NULL
      AND terms_accepted_at IS NOT NULL
      AND terms_version = ?
  `).run(TERMS_VERSION);
}



function getPasswordUserByEmail(db, email) {
  return db.prepare(`
    SELECT *
    FROM users
    WHERE email = ? AND password_hash IS NOT NULL
    LIMIT 1
  `).get(email);
}

function getRegisteredUserByEmail(db, email) {
  return db.prepare(`
    SELECT *
    FROM users
    WHERE email = ? AND type = 'registered'
    ORDER BY created_at ASC
    LIMIT 1
  `).get(email);
}

function insertPasswordUser(db, {
  email,
  passwordHash,
  nickname,
  displayName = null,
  age = null,
  termsVersion = null,
  emailVerified = false,
  nowIso
}) {
  const normalizedEmail = normalizeRequiredEmail(email);
  const normalizedNickname = normalizeNickname(nickname);
  const normalizedDisplayName = displayName === null ? normalizedNickname : normalizeRequiredDisplayName(displayName);
  const nicknameKey = normalizeNicknameKey(normalizedNickname);
  if (getRegisteredUserByEmail(db, normalizedEmail)) {
    throw new ApiError(409, "EMAIL_TAKEN", "Ese email ya tiene cuenta.");
  }
  assertNicknameAvailable(db, nicknameKey);

  const userId = `user-${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO users (
      id, name, nickname, nickname_norm, type, role, score, status, email, email_verified_at, password_hash,
      registration_age, terms_accepted_at, terms_version, profile_pending, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'registered', ?, 0, 'active', ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    userId,
    normalizedDisplayName,
    normalizedNickname,
    nicknameKey,
    emailVerified && isAdminEmail(normalizedEmail) ? ADMIN_ROLE : DEFAULT_REGISTERED_ROLE,
    normalizedEmail,
    emailVerified ? nowIso : null,
    passwordHash,
    age,
    termsVersion ? nowIso : null,
    termsVersion,
    nowIso,
    nowIso
  );

  return db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
}

function createPasswordUser(db, { email, password, nickname, nowIso }) {
  return insertPasswordUser(db, {
    email,
    passwordHash: hashPassword(validatePassword(password)),
    nickname,
    nowIso
  });
}

function getAuthenticatedPasswordUser(db, { email, password }) {
  const normalizedEmail = normalizeRequiredEmail(email);
  const userRow = getPasswordUserByEmail(db, normalizedEmail);
  if (!userRow || !verifyPassword(password, userRow.password_hash)) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Email o contrasena incorrectos.");
  }

  return userRow;
}

function resolvePreservedOptionalValue(nextValue, currentValue = null) {
  return nextValue ?? currentValue ?? null;
}

function resolvePreservedSuggestedDisplayName(nextValue, currentValue = null) {
  const normalized = normalizeUserDisplayName(nextValue, "");
  return normalized || currentValue || null;
}

function getOrCreateAuthenticatedUser(db, {
  authProvider,
  authSubject,
  email,
  emailVerified = false,
  displayName,
  avatarUrl,
  nowIso
}) {
  const normalizedProvider = String(authProvider || "").trim();
  const normalizedSubject = String(authSubject || "").trim();

  if (!normalizedProvider || !normalizedSubject) {
    throw new ApiError(400, "INVALID_AUTH_IDENTITY", "La identidad autenticada no es valida.");
  }

  const normalizedSuggestedAvatarUrl = normalizeAvatarUrl(avatarUrl, { discardInvalid: true });
  const existingUser = db.prepare(`
    SELECT *
    FROM users
    WHERE auth_provider = ? AND auth_subject = ?
    LIMIT 1
  `).get(normalizedProvider, normalizedSubject);

  if (existingUser && emailVerified !== true) {
    const nextSuggestedDisplayName = resolvePreservedSuggestedDisplayName(
      displayName,
      existingUser.profile_suggested_name
    );
    const nextSuggestedAvatarUrl = resolvePreservedOptionalValue(
      normalizedSuggestedAvatarUrl,
      existingUser.profile_suggested_avatar_url
    );
    db.prepare(`
      UPDATE users
      SET profile_suggested_name = ?, profile_suggested_avatar_url = ?, updated_at = ?
      WHERE id = ?
    `).run(nextSuggestedDisplayName, nextSuggestedAvatarUrl, nowIso, existingUser.id);
    return db.prepare("SELECT * FROM users WHERE id = ?").get(existingUser.id);
  }

  if (emailVerified !== true) {
    throw new ApiError(403, "OIDC_EMAIL_NOT_VERIFIED", "Google no confirmo que el email de la cuenta este verificado.");
  }

  const normalizedEmail = normalizeRequiredEmail(email);
  const normalizedSuggestedDisplayName = normalizeUserDisplayName(
    displayName,
    normalizedEmail.split("@")[0]
  );
  const resolvedRole = isAdminEmail(normalizedEmail) ? ADMIN_ROLE : DEFAULT_REGISTERED_ROLE;
  const matchingEmailUsers = db.prepare(`
    SELECT *
    FROM users
    WHERE email = ? AND type = 'registered'
    ORDER BY CASE WHEN email_verified_at IS NOT NULL THEN 0 ELSE 1 END, created_at ASC
  `).all(normalizedEmail);

  if (existingUser) {
    if (matchingEmailUsers.some((candidate) => candidate.id !== existingUser.id)) {
      throw new ApiError(409, "AUTH_EMAIL_CONFLICT", "Ese email ya pertenece a otra cuenta.");
    }

    const nextSuggestedDisplayName = resolvePreservedSuggestedDisplayName(
      displayName,
      existingUser.profile_suggested_name
    );
    const nextSuggestedAvatarUrl = resolvePreservedOptionalValue(
      normalizedSuggestedAvatarUrl,
      existingUser.profile_suggested_avatar_url
    );
    const nextRole = resolvedRole === ADMIN_ROLE || isModeratorRole(existingUser.role || "")
      ? (resolvedRole === ADMIN_ROLE ? ADMIN_ROLE : existingUser.role)
      : DEFAULT_REGISTERED_ROLE;
    db.prepare(`
      UPDATE users
      SET role = ?, email = ?, email_verified_at = COALESCE(email_verified_at, ?),
          profile_suggested_name = ?, profile_suggested_avatar_url = ?, updated_at = ?
      WHERE id = ?
    `).run(
      nextRole,
      normalizedEmail,
      nowIso,
      nextSuggestedDisplayName,
      nextSuggestedAvatarUrl,
      nowIso,
      existingUser.id
    );
    return db.prepare("SELECT * FROM users WHERE id = ?").get(existingUser.id);
  }

  if (matchingEmailUsers.length > 1) {
    throw new ApiError(409, "AUTH_EMAIL_CONFLICT", "Ese email esta asociado a mas de una cuenta. Contacta a soporte.");
  }

  const existingEmailUser = matchingEmailUsers[0] || null;
  if (existingEmailUser) {
    if (!existingEmailUser.email_verified_at) {
      throw new ApiError(
        409,
        "ACCOUNT_LINK_REQUIRED",
        "Ese email pertenece a una cuenta anterior. Entra con tu contrasena o recuperala y luego vincula Google desde tu perfil."
      );
    }
    if (existingEmailUser.auth_provider || existingEmailUser.auth_subject) {
      throw new ApiError(409, "AUTH_EMAIL_CONFLICT", "Ese email ya esta vinculado a otra identidad.");
    }

    const nextRole = resolvedRole === ADMIN_ROLE || isModeratorRole(existingEmailUser.role || "")
      ? (resolvedRole === ADMIN_ROLE ? ADMIN_ROLE : existingEmailUser.role)
      : DEFAULT_REGISTERED_ROLE;
    db.prepare(`
      UPDATE users
      SET role = ?, auth_provider = ?, auth_subject = ?, email_verified_at = COALESCE(email_verified_at, ?),
          updated_at = ?
      WHERE id = ?
    `).run(
      nextRole,
      normalizedProvider,
      normalizedSubject,
      nowIso,
      nowIso,
      existingEmailUser.id
    );
    return db.prepare("SELECT * FROM users WHERE id = ?").get(existingEmailUser.id);
  }

  const userId = `user-${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO users (
      id, name, type, role, score, status, auth_provider, auth_subject, email, email_verified_at, avatar_url,
      profile_pending, profile_suggested_name, profile_suggested_avatar_url, created_at, updated_at
    ) VALUES (?, 'Usuario', 'registered', ?, 0, 'active', ?, ?, ?, ?, NULL, 1, ?, ?, ?, ?)
  `).run(
    userId,
    resolvedRole,
    normalizedProvider,
    normalizedSubject,
    normalizedEmail,
    nowIso,
    normalizedSuggestedDisplayName,
    normalizedSuggestedAvatarUrl,
    nowIso,
    nowIso
  );

  return db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
}
function assertReportableEntity(db, entityType, entityId) {
  if (entityType === "topic") {
    return {
      entityType,
      entityId: assertExistingTopic(db, entityId).id,
      topicId: String(entityId || "").trim()
    };
  }

  if (entityType === "message") {
    const normalizedMessageId = normalizeMessageEntityId(entityId);
    const messageRow = db.prepare(`
      SELECT id, topic_id
      FROM messages
      WHERE id = ?
      LIMIT 1
    `).get(normalizedMessageId);
    if (!messageRow) {
      throw new ApiError(404, "NOT_FOUND", "Mensaje no encontrado.");
    }

    return {
      entityType,
      entityId: normalizedMessageId,
      topicId: messageRow.topic_id
    };
  }

  if (entityType === "user") {
    return {
      entityType,
      entityId: assertExistingUser(db, entityId).id,
      topicId: null
    };
  }

  throw new ApiError(400, "INVALID_REPORT_TARGET", "Entidad de reporte no soportada.");
}

function insertOrUpdateBlockedSession(db, { sessionId, actorUserId, reason, createdAt }) {
  db.prepare(`
    INSERT INTO blocked_sessions (session_id, actor_user_id, reason, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      actor_user_id = excluded.actor_user_id,
      reason = excluded.reason,
      created_at = excluded.created_at
  `).run(sessionId, actorUserId, reason, createdAt);
}

function insertOrUpdateBlockedIp(db, { ipAddress, actorUserId, reason, createdAt }) {
  db.prepare(`
    INSERT INTO blocked_ips (ip_address, actor_user_id, reason, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(ip_address) DO UPDATE SET
      actor_user_id = excluded.actor_user_id,
      reason = excluded.reason,
      created_at = excluded.created_at
  `).run(ipAddress, actorUserId, reason, createdAt);
}

function assertModerator(viewerRow) {
  if (!viewerRow || !canModerate(viewerRow)) {
    throw new ApiError(403, "MODERATOR_REQUIRED", "Hace falta un moderador.");
  }
}

function getReportSnapshot(db, sessionId) {
  const rows = db.prepare(`
    SELECT entity_type, entity_id
    FROM reports
    WHERE reporter_session_id = ? AND status = ?
    ORDER BY id DESC
  `).all(sessionId, REPORT_STATUS_OPEN);

  const reportedTopicIds = [];
  const reportedMessageIds = [];

  rows.forEach((row) => {
    if (row.entity_type === "topic") {
      reportedTopicIds.push(row.entity_id);
      return;
    }

    if (row.entity_type === "message") {
      reportedMessageIds.push(`message-${row.entity_id}`);
    }
  });

  return {
    reportedTopicIds: [...new Set(reportedTopicIds)],
    reportedMessageIds: [...new Set(reportedMessageIds)]
  };
}

function recordModerationAction(db, {
  actionType,
  targetType,
  targetId,
  actorUserId,
  reason = "",
  metadataJson = "{}",
  createdAt
}) {
  db.prepare(`
    INSERT INTO moderation_actions (action_type, target_type, target_id, actor_user_id, reason, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(actionType, targetType, targetId, actorUserId, reason, metadataJson, createdAt);
}

function resolveReportsForEntity(db, entityType, entityId, resolvedAt) {
  db.prepare(`
    UPDATE reports
    SET status = ?, resolved_at = ?
    WHERE entity_type = ? AND entity_id = ? AND status = ?
  `).run(REPORT_STATUS_RESOLVED, resolvedAt, entityType, entityId, REPORT_STATUS_OPEN);
}

function recalculateTopicActivity(db, topicId, updatedAt) {
  const latestMessage = db.prepare(`
    SELECT id, text, created_at
    FROM messages
    WHERE topic_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(topicId);

  if (!latestMessage) {
    throw new ApiError(409, "INVALID_TOPIC_STATE", "El tema no puede quedar sin mensajes.");
  }

  db.prepare(`
    UPDATE topics
    SET subtitle = ?, last_message_id = ?, last_activity_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    summarizeText(latestMessage.text),
    Number(latestMessage.id),
    latestMessage.created_at,
    updatedAt,
    topicId
  );
}

function listPendingAvatars(db, options = {}) {
  const pagination = normalizePaginationOptions(options, ADMIN_AVATAR_PAGE_SIZE);
  const total = db.prepare(`
    SELECT COUNT(*) AS count
    FROM users
    WHERE type = 'registered' AND avatar_pending_url IS NOT NULL AND avatar_pending_url <> ''
  `).get()?.count ?? 0;
  const items = db.prepare(`
    SELECT id, name, email, avatar_pending_url, avatar_review_status, updated_at
    FROM users
    WHERE type = 'registered' AND avatar_pending_url IS NOT NULL AND avatar_pending_url <> ''
    ORDER BY updated_at DESC, created_at DESC
    LIMIT ? OFFSET ?
  `).all(pagination.limit, pagination.offset).map((row) => ({
    userId: row.id,
    name: row.name,
    email: row.email ?? null,
    description: row.description ?? "",
    avatarPendingUrl: row.avatar_pending_url,
    avatarReviewStatus: row.avatar_review_status || "pending",
    updatedAt: row.updated_at
  }));

  return {
    items,
    pagination: createPaginationMeta(total, pagination)
  };
}

function attachReportTargets(db, items) {
  const messageIds = items.filter((item) => item.entityType === "message").map((item) => item.entityId);
  const topicIds = items.filter((item) => item.entityType === "topic").map((item) => item.entityId);
  const userIds = items.filter((item) => item.entityType === "user").map((item) => item.entityId);

  const messageTargets = new Map();
  if (messageIds.length) {
    db.prepare(`
      SELECT
        messages.id,
        messages.text,
        messages.topic_id,
        messages.author_id,
        users.name AS author_name,
        topics.title AS topic_title
      FROM messages
      LEFT JOIN users ON users.id = messages.author_id
      LEFT JOIN topics ON topics.id = messages.topic_id
      WHERE messages.id IN (${messageIds.map(() => "?").join(", ")})
    `).all(...messageIds).forEach((row) => {
      messageTargets.set(String(row.id), {
        kind: "message",
        text: row.text,
        authorId: row.author_id,
        authorName: row.author_name || "Usuario eliminado",
        topicId: row.topic_id,
        topicTitle: row.topic_title || "Tema eliminado"
      });
    });
  }

  const topicTargets = new Map();
  if (topicIds.length) {
    db.prepare(`
      SELECT topics.id, topics.title, topics.author_id, users.name AS author_name
      FROM topics
      LEFT JOIN users ON users.id = topics.author_id
      WHERE topics.id IN (${topicIds.map(() => "?").join(", ")})
    `).all(...topicIds).forEach((row) => {
      topicTargets.set(String(row.id), {
        kind: "topic",
        title: row.title || "Tema eliminado",
        authorId: row.author_id,
        authorName: row.author_name || "Usuario eliminado"
      });
    });
  }

  const userTargets = new Map();
  if (userIds.length) {
    db.prepare(`
      SELECT id, name, status
      FROM users
      WHERE id IN (${userIds.map(() => "?").join(", ")})
    `).all(...userIds).forEach((row) => {
      userTargets.set(String(row.id), {
        kind: "user",
        name: row.name || "Usuario eliminado",
        status: row.status
      });
    });
  }

  return items.map((item) => {
    if (item.entityType === "message") {
      return { ...item, target: messageTargets.get(String(item.entityId)) || null };
    }
    if (item.entityType === "topic") {
      return { ...item, target: topicTargets.get(String(item.entityId)) || null };
    }
    if (item.entityType === "user") {
      return { ...item, target: userTargets.get(String(item.entityId)) || null };
    }
    return { ...item, target: null };
  });
}

function listOpenReports(db, options = {}) {
  const pagination = normalizePaginationOptions(options, ADMIN_REPORT_PAGE_SIZE);
  const total = db.prepare(`
    SELECT COUNT(*) AS count
    FROM reports
    WHERE status = ?
  `).get(REPORT_STATUS_OPEN)?.count ?? 0;
  const items = db.prepare(`
    SELECT
      reports.id,
      reports.entity_type,
      reports.entity_id,
      reports.reason,
      reports.created_at,
      reports.reporter_session_id,
      reports.reporter_user_id,
      users.name AS reporter_name
    FROM reports
    LEFT JOIN users ON users.id = reports.reporter_user_id
    WHERE reports.status = ?
    ORDER BY reports.created_at DESC, reports.id DESC
    LIMIT ? OFFSET ?
  `).all(REPORT_STATUS_OPEN, pagination.limit, pagination.offset).map((row) => ({
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    reason: row.reason,
    createdAt: row.created_at,
    reporterSessionId: row.reporter_session_id,
    reporterUserId: row.reporter_user_id,
    reporterName: row.reporter_name || "Anonimo"
  }));

  return {
    items: attachReportTargets(db, items),
    pagination: createPaginationMeta(total, pagination)
  };
}

function trimTopicReplies(db, topicId) {
  const overflowRows = db.prepare(`
    SELECT id
    FROM messages
    WHERE topic_id = ? AND is_root = 0
    ORDER BY id DESC
    LIMIT -1 OFFSET ?
  `).all(topicId, TOPIC_REPLY_LIMIT);

  if (!overflowRows.length) {
    return;
  }

  const deleteMessage = db.prepare("DELETE FROM messages WHERE id = ?");
  overflowRows.forEach((row) => {
    deleteMessage.run(row.id);
  });
}

function assertCommentableTopic(row) {
  if (!row) {
    throw new ApiError(404, "NOT_FOUND", "Tema no encontrado.");
  }

  if (row.status === TOPIC_STATUS_EXPELLED || row.status === TOPIC_STATUS_BLOCKED) {
    throw new ApiError(409, "TOPIC_EXPELLED_OR_BLOCKED", "Este tema ya no acepta comentarios.", {
      topicStatus: row.status
    });
  }
}

function createStoredEmailAuthChallenge(db, {
  email,
  nickname = "",
  age = null,
  acceptedTerms = false,
  termsVersion = null,
  password,
  nowMs = Date.now()
} = {}) {
  const normalizedEmail = normalizeRequiredEmail(email);
  const nowIso = new Date(nowMs).toISOString();
  const recentChallenge = db.prepare(`
    SELECT created_at
    FROM auth_email_challenges
    WHERE email = ? AND consumed_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `).get(normalizedEmail);
  const recentCreatedAtMs = Date.parse(recentChallenge?.created_at || "");
  if (Number.isFinite(recentCreatedAtMs) && nowMs - recentCreatedAtMs < EMAIL_AUTH_RESEND_DELAY_MS) {
    const retryAfterSeconds = Math.ceil((EMAIL_AUTH_RESEND_DELAY_MS - (nowMs - recentCreatedAtMs)) / 1000);
    throw new ApiError(429, "EMAIL_CODE_RATE_LIMITED", `Espera ${retryAfterSeconds} segundos antes de pedir otro codigo.`, {
      retryAfterSeconds
    });
  }

  const normalizedNickname = normalizeNickname(nickname);
  const normalizedAge = normalizeRegistrationAge(age);
  assertTermsAccepted(acceptedTerms, termsVersion);
  const normalizedTermsVersion = TERMS_VERSION;
  const passwordHash = hashPassword(validatePassword(password));
  if (getRegisteredUserByEmail(db, normalizedEmail)) {
    throw new ApiError(409, "EMAIL_TAKEN", "Ese email ya tiene cuenta.");
  }
  assertNicknameAvailable(db, normalizeNicknameKey(normalizedNickname));

  db.prepare(`
    DELETE FROM auth_email_challenges
    WHERE expires_at <= ? OR consumed_at IS NOT NULL
  `).run(nowIso);

  const challengeId = `email-code-${crypto.randomUUID()}`;
  const code = String(crypto.randomInt(100000, 1_000_000));
  const expiresAt = new Date(nowMs + EMAIL_AUTH_CODE_TTL_MS).toISOString();
  db.prepare(`
    INSERT INTO auth_email_challenges (
      id, email, intent, code_hash, nickname, age, terms_version, password_hash,
      expires_at, attempts, max_attempts, consumed_at, created_at
    ) VALUES (?, ?, 'register', ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?)
  `).run(
    challengeId,
    normalizedEmail,
    hashEmailAuthCode(challengeId, code),
    normalizedNickname,
    normalizedAge,
    normalizedTermsVersion,
    passwordHash,
    expiresAt,
    EMAIL_AUTH_MAX_ATTEMPTS,
    nowIso
  );

  return {
    challengeId,
    code,
    email: normalizedEmail,
    expiresAt,
    expiresInSeconds: Math.floor(EMAIL_AUTH_CODE_TTL_MS / 1000)
  };
}

function verifyStoredEmailAuthChallenge(db, {
  challengeId,
  code,
  sessionId,
  selectedTopicId = null,
  ipAddress = "",
  rotateSession = false,
  nowMs = Date.now()
} = {}) {
  const normalizedChallengeId = String(challengeId || "").trim();
  const normalizedCode = String(code || "").trim();
  if (!normalizedChallengeId || !/^\d{6}$/.test(normalizedCode)) {
    throw new ApiError(400, "INVALID_EMAIL_CODE", "Ingresa el codigo de 6 digitos que recibiste por email.");
  }

  const result = withTransaction(db, () => {
    const challenge = db.prepare(`
      SELECT * FROM auth_email_challenges WHERE id = ? LIMIT 1
    `).get(normalizedChallengeId);
    const nowIso = new Date(nowMs).toISOString();
    if (!challenge || challenge.consumed_at) {
      return { error: new ApiError(400, "INVALID_EMAIL_CODE", "El codigo no es valido o ya fue usado.") };
    }
    if (Date.parse(challenge.expires_at) <= nowMs) {
      return { error: new ApiError(410, "EMAIL_CODE_EXPIRED", "El codigo vencio. Solicita uno nuevo.") };
    }
    if (challenge.attempts >= challenge.max_attempts) {
      return { error: new ApiError(429, "EMAIL_CODE_ATTEMPTS_EXCEEDED", "Superaste los intentos permitidos. Solicita un codigo nuevo.") };
    }

    const actualHash = hashEmailAuthCode(normalizedChallengeId, normalizedCode);
    if (!codesMatch(actualHash, challenge.code_hash)) {
      db.prepare("UPDATE auth_email_challenges SET attempts = attempts + 1 WHERE id = ?").run(normalizedChallengeId);
      return { error: new ApiError(401, "INVALID_EMAIL_CODE", "El codigo ingresado no es correcto.") };
    }

    const normalizedSessionId = ensureViewerSessionId(sessionId);
    const existingSessionRow = readSessionRow(db, normalizedSessionId);
    assertContextNotBlocked(db, {
      sessionId: normalizedSessionId,
      sessionRow: existingSessionRow,
      ipAddress: normalizeIpAddress(ipAddress || existingSessionRow?.last_ip || "")
    });
    const viewerRow = insertPasswordUser(db, {
      email: challenge.email,
      passwordHash: challenge.password_hash,
      nickname: challenge.nickname,
      age: challenge.age,
      termsVersion: challenge.terms_version,
      emailVerified: true,
      nowIso
    });

    db.prepare("UPDATE auth_email_challenges SET consumed_at = ? WHERE id = ?").run(nowIso, normalizedChallengeId);
    const nextSessionId = rotateSession ? createRotatedSessionId(normalizedSessionId) : normalizedSessionId;
    const context = createRegisteredSession(db, nextSessionId, ipAddress, nowIso, existingSessionRow, viewerRow.id);
    invalidatePreviousSession(db, normalizedSessionId, nextSessionId);
    return { payload: buildFrontendPayload(db, context, selectedTopicId) };
  });

  if (result.error) {
    throw result.error;
  }
  return result.payload;
}

function createStoredPasswordResetChallenge(db, {
  email,
  ipAddress = "",
  nowMs = Date.now()
} = {}) {
  const normalizedEmail = normalizeRequiredEmail(email);
  const normalizedIpAddress = normalizeIpAddress(ipAddress) || "unknown";
  const emailKey = createPrivateLookupKey("password-reset-email", normalizedEmail);
  const requestIpKey = createPrivateLookupKey("password-reset-ip", normalizedIpAddress);
  const nowIso = new Date(nowMs).toISOString();
  const rateWindowStartIso = new Date(nowMs - PASSWORD_RESET_RATE_WINDOW_MS).toISOString();
  const expiresAt = new Date(nowMs + PASSWORD_RESET_CODE_TTL_MS).toISOString();

  db.prepare(`
    DELETE FROM password_reset_challenges
    WHERE created_at < ? AND (expires_at <= ? OR consumed_at IS NOT NULL)
  `).run(rateWindowStartIso, nowIso);

  const recentChallenge = db.prepare(`
    SELECT created_at
    FROM password_reset_challenges
    WHERE email_key = ? AND consumed_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `).get(emailKey);
  const recentCreatedAtMs = Date.parse(recentChallenge?.created_at || "");
  const emailHourlyCount = db.prepare(`
    SELECT COUNT(*) AS count
    FROM password_reset_challenges
    WHERE email_key = ? AND created_at >= ?
  `).get(emailKey, rateWindowStartIso)?.count ?? 0;
  const ipHourlyCount = db.prepare(`
    SELECT COUNT(*) AS count
    FROM password_reset_challenges
    WHERE request_ip_key = ? AND created_at >= ?
  `).get(requestIpKey, rateWindowStartIso)?.count ?? 0;
  const resendLimited = Number.isFinite(recentCreatedAtMs)
    && nowMs - recentCreatedAtMs < PASSWORD_RESET_RESEND_DELAY_MS;
  const rateLimited = resendLimited
    || emailHourlyCount >= PASSWORD_RESET_EMAIL_HOURLY_MAX
    || ipHourlyCount >= PASSWORD_RESET_IP_HOURLY_MAX;

  if (rateLimited) {
    return {
      challengeId: `password-reset-${crypto.randomUUID()}`,
      code: null,
      email: null,
      expiresAt,
      expiresInSeconds: Math.floor(PASSWORD_RESET_CODE_TTL_MS / 1000),
      deliveryRequired: false
    };
  }

  const matchingUsers = db.prepare(`
    SELECT *
    FROM users
    WHERE email = ? AND type = 'registered'
    ORDER BY created_at ASC, id ASC
  `).all(normalizedEmail);
  const targetUser = matchingUsers.length === 1
    && (matchingUsers[0].password_hash || matchingUsers[0].email_verified_at)
    ? matchingUsers[0]
    : null;
  const challengeId = `password-reset-${crypto.randomUUID()}`;
  const code = String(crypto.randomInt(100000, 1_000_000));

  db.prepare(`
    UPDATE password_reset_challenges
    SET consumed_at = ?
    WHERE email_key = ? AND consumed_at IS NULL
  `).run(nowIso, emailKey);
  db.prepare(`
    INSERT INTO password_reset_challenges (
      id, user_id, email_key, request_ip_key, code_hash, expires_at,
      attempts, max_attempts, consumed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, ?)
  `).run(
    challengeId,
    targetUser?.id ?? null,
    emailKey,
    requestIpKey,
    hashPasswordResetCode(challengeId, code),
    expiresAt,
    PASSWORD_RESET_MAX_ATTEMPTS,
    nowIso
  );

  return {
    challengeId,
    code: targetUser ? code : null,
    email: targetUser ? normalizedEmail : null,
    expiresAt,
    expiresInSeconds: Math.floor(PASSWORD_RESET_CODE_TTL_MS / 1000),
    deliveryRequired: Boolean(targetUser)
  };
}

function verifyStoredPasswordResetChallenge(db, {
  challengeId,
  code,
  newPassword,
  sessionId,
  selectedTopicId = null,
  ipAddress = "",
  rotateSession = true,
  nowMs = Date.now()
} = {}) {
  const normalizedChallengeId = String(challengeId || "").trim();
  const normalizedCode = String(code || "").trim();
  if (!normalizedChallengeId || !/^\d{6}$/.test(normalizedCode)) {
    throw new ApiError(400, "INVALID_PASSWORD_RESET_CODE", "Ingresa el codigo de 6 digitos que recibiste por email.");
  }

  const result = withTransaction(db, () => {
    const challenge = db.prepare(`
      SELECT * FROM password_reset_challenges WHERE id = ? LIMIT 1
    `).get(normalizedChallengeId);
    const nowIso = new Date(nowMs).toISOString();
    if (!challenge || challenge.consumed_at) {
      return { error: new ApiError(400, "INVALID_PASSWORD_RESET_CODE", "El codigo no es valido o ya fue usado.") };
    }
    if (Date.parse(challenge.expires_at) <= nowMs) {
      return { error: new ApiError(410, "PASSWORD_RESET_CODE_EXPIRED", "El codigo vencio. Solicita uno nuevo.") };
    }
    if (challenge.attempts >= challenge.max_attempts) {
      return { error: new ApiError(429, "PASSWORD_RESET_ATTEMPTS_EXCEEDED", "Superaste los intentos permitidos. Solicita un codigo nuevo.") };
    }

    const actualHash = hashPasswordResetCode(normalizedChallengeId, normalizedCode);
    if (!codesMatch(actualHash, challenge.code_hash) || !challenge.user_id) {
      db.prepare("UPDATE password_reset_challenges SET attempts = attempts + 1 WHERE id = ?").run(normalizedChallengeId);
      return { error: new ApiError(401, "INVALID_PASSWORD_RESET_CODE", "El codigo ingresado no es correcto.") };
    }

    const userRow = db.prepare("SELECT * FROM users WHERE id = ? AND type = 'registered' LIMIT 1").get(challenge.user_id);
    const expectedEmailKey = userRow?.email
      ? createPrivateLookupKey("password-reset-email", normalizeRequiredEmail(userRow.email))
      : "";
    const matchingEmailUsers = userRow?.email
      ? db.prepare("SELECT id FROM users WHERE email = ? AND type = 'registered'").all(userRow.email)
      : [];
    if (!userRow || !codesMatch(expectedEmailKey, challenge.email_key) || matchingEmailUsers.length !== 1) {
      return { error: new ApiError(409, "PASSWORD_RESET_CONFLICT", "No se pudo recuperar esta cuenta de forma segura.") };
    }

    const nextPasswordHash = hashPassword(validatePassword(newPassword));
    const normalizedSessionId = ensureViewerSessionId(sessionId);
    const sourceSessionRow = readSessionRow(db, normalizedSessionId);
    assertContextNotBlocked(db, {
      sessionId: normalizedSessionId,
      sessionRow: sourceSessionRow,
      ipAddress: normalizeIpAddress(ipAddress || sourceSessionRow?.last_ip || "")
    });
    const nextRole = isAdminEmail(userRow.email)
      ? ADMIN_ROLE
      : (isModeratorRole(userRow.role || "") ? userRow.role : DEFAULT_REGISTERED_ROLE);
    db.prepare(`
      UPDATE users
      SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?), role = ?, updated_at = ?
      WHERE id = ?
    `).run(nextPasswordHash, nowIso, nextRole, nowIso, userRow.id);
    db.prepare(`
      UPDATE password_reset_challenges
      SET consumed_at = ?
      WHERE user_id = ? AND consumed_at IS NULL
    `).run(nowIso, userRow.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userRow.id);

    const nextSessionId = rotateSession ? createRotatedSessionId(normalizedSessionId) : normalizedSessionId;
    const context = createRegisteredSession(db, nextSessionId, ipAddress, nowIso, null, userRow.id);
    invalidatePreviousSession(db, normalizedSessionId, nextSessionId);
    return { payload: buildFrontendPayload(db, context, selectedTopicId) };
  });

  if (result.error) {
    throw result.error;
  }
  return result.payload;
}

function getIdentityLinkTarget(db, { sessionId, authMode, ipAddress = "", password } = {}) {
  const context = resolveViewer(db, { sessionId, authMode, ipAddress });
  assertContextNotBlocked(db, context);
  assertViewerCanParticipate(context.viewerRow);
  if (context.viewer.type !== "registered" || !context.viewerRow.password_hash || !context.viewerRow.email) {
    throw new ApiError(403, "ACCOUNT_LINK_NOT_AVAILABLE", "Esta cuenta no se puede vincular con Google.");
  }
  if (context.viewerRow.auth_provider || context.viewerRow.auth_subject) {
    throw new ApiError(409, "ACCOUNT_ALREADY_LINKED", "Esta cuenta ya esta vinculada con un proveedor externo.");
  }
  if (!verifyPassword(password, context.viewerRow.password_hash)) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "La contrasena actual no es correcta.");
  }
  return {
    userId: context.viewerRow.id,
    email: normalizeRequiredEmail(context.viewerRow.email),
    sessionId: context.sessionId
  };
}

function linkIdentityToCurrentUser(db, {
  sessionId,
  sourceSessionId,
  targetUserId,
  expectedEmail,
  selectedTopicId = null,
  ipAddress = "",
  authProvider,
  authSubject,
  email,
  emailVerified = false
} = {}) {
  const normalizedProvider = String(authProvider || "").trim();
  const normalizedSubject = String(authSubject || "").trim();
  if (!normalizedProvider || !normalizedSubject || emailVerified !== true) {
    throw new ApiError(403, "INVALID_ACCOUNT_LINK_IDENTITY", "Google no confirmo una identidad verificable.");
  }

  const normalizedSourceSessionId = ensureViewerSessionId(sourceSessionId);
  const normalizedNextSessionId = ensureViewerSessionId(sessionId);
  const normalizedExpectedEmail = normalizeRequiredEmail(expectedEmail);
  const normalizedIdentityEmail = normalizeRequiredEmail(email);
  if (normalizedIdentityEmail !== normalizedExpectedEmail) {
    throw new ApiError(409, "ACCOUNT_LINK_EMAIL_MISMATCH", "La cuenta de Google debe usar el mismo email.");
  }

  return withTransaction(db, () => {
    const sourceSessionRow = readSessionRow(db, normalizedSourceSessionId);
    if (
      !sourceSessionRow
      || sourceSessionRow.auth_mode !== "registered"
      || sourceSessionRow.user_id !== String(targetUserId || "")
    ) {
      throw new ApiError(401, "ACCOUNT_LINK_SESSION_EXPIRED", "La sesion para vincular la cuenta vencio. Intentalo de nuevo.");
    }
    assertContextNotBlocked(db, {
      sessionId: normalizedSourceSessionId,
      sessionRow: sourceSessionRow,
      ipAddress: normalizeIpAddress(ipAddress || sourceSessionRow.last_ip || "")
    });

    const targetUser = db.prepare("SELECT * FROM users WHERE id = ? AND type = 'registered' LIMIT 1").get(targetUserId);
    if (!targetUser || !targetUser.password_hash || normalizeOptionalEmail(targetUser.email) !== normalizedExpectedEmail) {
      throw new ApiError(409, "ACCOUNT_LINK_TARGET_CHANGED", "La cuenta existente ya no coincide con la solicitud.");
    }
    assertViewerCanParticipate(targetUser);
    if (targetUser.auth_provider || targetUser.auth_subject) {
      throw new ApiError(409, "ACCOUNT_ALREADY_LINKED", "Esta cuenta ya esta vinculada con un proveedor externo.");
    }

    const identityOwner = db.prepare(`
      SELECT id FROM users WHERE auth_provider = ? AND auth_subject = ? LIMIT 1
    `).get(normalizedProvider, normalizedSubject);
    if (identityOwner && identityOwner.id !== targetUser.id) {
      throw new ApiError(409, "AUTH_IDENTITY_TAKEN", "Esa identidad de Google ya pertenece a otra cuenta.");
    }
    const emailOwners = db.prepare(`
      SELECT id FROM users WHERE email = ? AND type = 'registered'
    `).all(normalizedExpectedEmail);
    if (emailOwners.length !== 1 || emailOwners[0].id !== targetUser.id) {
      throw new ApiError(409, "AUTH_EMAIL_CONFLICT", "Ese email esta asociado a mas de una cuenta.");
    }

    const nowIso = new Date().toISOString();
    const nextRole = isAdminEmail(normalizedExpectedEmail)
      ? ADMIN_ROLE
      : (isModeratorRole(targetUser.role || "") ? targetUser.role : DEFAULT_REGISTERED_ROLE);
    db.prepare(`
      UPDATE users
      SET auth_provider = ?, auth_subject = ?, email_verified_at = COALESCE(email_verified_at, ?),
          role = ?, updated_at = ?
      WHERE id = ?
    `).run(normalizedProvider, normalizedSubject, nowIso, nextRole, nowIso, targetUser.id);

    const context = createRegisteredSession(
      db,
      normalizedNextSessionId,
      ipAddress,
      nowIso,
      readSessionRow(db, normalizedNextSessionId),
      targetUser.id
    );
    invalidatePreviousSession(db, normalizedSourceSessionId, normalizedNextSessionId);
    return buildFrontendPayload(db, context, selectedTopicId);
  });
}

export function createBackendStore({ dbPath = null, seedDemoData = true } = {}) {
  const dbConfig = resolveDbConfig(dbPath);
  const resolvedDbPath = dbConfig.dbPath;
  const storageDir = path.dirname(resolvedDbPath);
  const avatarStorageDir = path.join(storageDir, "avatars");
  mkdirSync(storageDir, { recursive: true });
  mkdirSync(avatarStorageDir, { recursive: true });
  const db = new DatabaseSync(resolvedDbPath);

  initSchema(db);
  if (seedDemoData) {
    seedDatabase(db);
  } else {
    purgeDemoData(db);
  }
  backfillVerifiedPasswordEmails(db);
  backfillRegisteredNicknames(db);

  return {
    dbPath: resolvedDbPath,
    avatarStorageDir,
    close() {
      db.close();
    },
    cleanupInactiveGuests({ nowMs = Date.now() } = {}) {
      return withTransaction(db, () => pruneGuestSessions(db, "", nowMs, ""));
    },
    resetDailyMessageReactions({ now = new Date() } = {}) {
      return withTransaction(db, () => resetDailyMessageReactionsIfNeeded(db, now));
    },
    createEmailAuthChallenge(options = {}) {
      return withTransaction(db, () => createStoredEmailAuthChallenge(db, options));
    },
    discardEmailAuthChallenge(challengeId) {
      db.prepare("DELETE FROM auth_email_challenges WHERE id = ?").run(String(challengeId || ""));
    },
    verifyEmailAuthChallenge(options = {}) {
      return verifyStoredEmailAuthChallenge(db, options);
    },
    createPasswordResetChallenge(options = {}) {
      return withTransaction(db, () => createStoredPasswordResetChallenge(db, options));
    },
    discardPasswordResetChallenge(challengeId) {
      db.prepare(`
        UPDATE password_reset_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL
      `).run(new Date().toISOString(), String(challengeId || ""));
    },
    verifyPasswordResetChallenge(options = {}) {
      return verifyStoredPasswordResetChallenge(db, options);
    },
    prepareIdentityLink(options = {}) {
      return getIdentityLinkTarget(db, options);
    },
    completeIdentityLink(options = {}) {
      return linkIdentityToCurrentUser(db, options);
    },
    registerWithPassword({ sessionId, selectedTopicId = null, ipAddress = "", email, password, nickname, rotateSession = false } = {}) {
      return withTransaction(db, () => {
        const normalizedSessionId = ensureViewerSessionId(sessionId);
        const nowIso = new Date().toISOString();
        const existingSessionRow = readSessionRow(db, normalizedSessionId);
        assertContextNotBlocked(db, {
          sessionId: normalizedSessionId,
          sessionRow: existingSessionRow,
          ipAddress: normalizeIpAddress(ipAddress || existingSessionRow?.last_ip || "")
        });
        const viewerRow = createPasswordUser(db, { email, password, nickname, nowIso });
        const nextSessionId = rotateSession ? createRotatedSessionId(normalizedSessionId) : normalizedSessionId;
        const context = createRegisteredSession(db, nextSessionId, ipAddress, nowIso, existingSessionRow, viewerRow.id);
        invalidatePreviousSession(db, normalizedSessionId, nextSessionId);
        return buildFrontendPayload(db, context, selectedTopicId);
      });
    },
    loginWithPassword({ sessionId, selectedTopicId = null, ipAddress = "", email, password, rotateSession = false } = {}) {
      return withTransaction(db, () => {
        const normalizedSessionId = ensureViewerSessionId(sessionId);
        const nowIso = new Date().toISOString();
        const existingSessionRow = readSessionRow(db, normalizedSessionId);
        assertContextNotBlocked(db, {
          sessionId: normalizedSessionId,
          sessionRow: existingSessionRow,
          ipAddress: normalizeIpAddress(ipAddress || existingSessionRow?.last_ip || "")
        });
        const viewerRow = getAuthenticatedPasswordUser(db, { email, password });
        const nextSessionId = rotateSession ? createRotatedSessionId(normalizedSessionId) : normalizedSessionId;
        const context = createRegisteredSession(db, nextSessionId, ipAddress, nowIso, existingSessionRow, viewerRow.id);
        invalidatePreviousSession(db, normalizedSessionId, nextSessionId);
        return buildFrontendPayload(db, context, selectedTopicId);
      });
    },    login({ sessionId, selectedTopicId = null, ipAddress = "", userId = REGISTERED_USER_ID, rotateSession = false } = {}) {
      return withTransaction(db, () => {
        const normalizedSessionId = ensureViewerSessionId(sessionId);
        const nowIso = new Date().toISOString();
        const existingSessionRow = readSessionRow(db, normalizedSessionId);
        assertContextNotBlocked(db, {
          sessionId: normalizedSessionId,
          sessionRow: existingSessionRow,
          ipAddress: normalizeIpAddress(ipAddress || existingSessionRow?.last_ip || "")
        });
        const nextSessionId = rotateSession ? createRotatedSessionId(normalizedSessionId) : normalizedSessionId;
        const context = createRegisteredSession(db, nextSessionId, ipAddress, nowIso, existingSessionRow, userId);
        invalidatePreviousSession(db, normalizedSessionId, nextSessionId);
        return buildFrontendPayload(db, context, selectedTopicId);
      });
    },
    loginWithIdentity({
      sessionId,
      sourceSessionId = sessionId,
      selectedTopicId = null,
      ipAddress = "",
      authProvider,
      authSubject,
      email = null,
      emailVerified = false,
      displayName = "",
      avatarUrl = null
    } = {}) {
      return withTransaction(db, () => {
        const normalizedSessionId = ensureViewerSessionId(sessionId);
        const normalizedSourceSessionId = ensureViewerSessionId(sourceSessionId);
        const nowIso = new Date().toISOString();
        const sourceSessionRow = readSessionRow(db, normalizedSourceSessionId);
        assertContextNotBlocked(db, {
          sessionId: normalizedSourceSessionId,
          sessionRow: sourceSessionRow,
          ipAddress: normalizeIpAddress(ipAddress || sourceSessionRow?.last_ip || "")
        });

        const viewerRow = getOrCreateAuthenticatedUser(db, {
          authProvider,
          authSubject,
          email,
          emailVerified,
          displayName,
          avatarUrl,
          nowIso
        });
        const existingSessionRow = readSessionRow(db, normalizedSessionId);
        const context = createRegisteredSession(db, normalizedSessionId, ipAddress, nowIso, existingSessionRow, viewerRow.id);
        invalidatePreviousSession(db, normalizedSourceSessionId, normalizedSessionId);
        return buildFrontendPayload(db, context, selectedTopicId);
      });
    },
    logout({ sessionId, selectedTopicId = null, ipAddress = "" } = {}) {
      return withTransaction(db, () => {
        const normalizedSessionId = ensureViewerSessionId(sessionId);
        const nowIso = new Date().toISOString();
        const existingSessionRow = readSessionRow(db, normalizedSessionId);
        const context = createGuestSession(db, normalizedSessionId, ipAddress, nowIso, existingSessionRow);
        return buildFrontendPayload(db, context, selectedTopicId);
      });
    },
    updateProfile({ sessionId, authMode, displayName = null, username = null, age = null, acceptedTerms = false, termsVersion = null, description = "", profileShowDescription = true, profileShowJoinedAt = true, socialWhatsapp = "", socialInstagram = "", socialTiktok = "", socialFacebook = "", socialTwitter = "", socialDiscord = "", profileShowSocial = true, profileIndexable = null, avatarDataUrl = null, removeAvatar = false, selectedTopicId = null, ipAddress = "" } = {}) {
      return withTransaction(db, (afterCommit) => {
        const context = resolveViewer(db, { sessionId, authMode, ipAddress });
        assertViewerCanParticipate(context.viewerRow);
        assertContextNotBlocked(db, context);
        if (context.viewer.type !== "registered") {
          throw new ApiError(403, "LOGIN_REQUIRED", "Hace falta iniciar sesion para editar el perfil.");
        }

        const normalizedDisplayName = normalizeRequiredDisplayName(displayName || context.viewer.displayName || "Usuario");
        const currentUsername = context.viewer.nickname || null;
        const normalizedUsername = username === null
          ? currentUsername
          : normalizeNickname(username);
        if (!normalizedUsername) {
          throw new ApiError(400, "USERNAME_REQUIRED", "Elige un username unico para completar tu perfil.");
        }

        const normalizedUsernameKey = normalizeNicknameKey(normalizedUsername);
        const currentUsernameKey = currentUsername ? normalizeNicknameKey(currentUsername) : null;
        if (currentUsernameKey && currentUsernameKey !== normalizedUsernameKey && !context.viewer.profilePending) {
          throw new ApiError(409, "USERNAME_IMMUTABLE", "El username no se puede cambiar despues de completar el perfil.");
        }
        assertNicknameAvailable(db, normalizedUsernameKey, context.viewer.id);
        const completingProfile = context.viewer.profilePending;
        const normalizedRegistrationAge = completingProfile
          ? normalizeRegistrationAge(age)
          : context.viewerRow.registration_age ?? null;
        if (completingProfile) {
          assertTermsAccepted(acceptedTerms, termsVersion);
        }
        const normalizedDescription = normalizeProfileDescription(description);
        const normalizedSocialWhatsapp = normalizeSocialWhatsapp(socialWhatsapp);
        const normalizedSocialInstagram = normalizeSocialHandle(socialInstagram, "Instagram");
        const normalizedSocialTiktok = normalizeSocialHandle(socialTiktok, "TikTok");
        const normalizedSocialFacebook = normalizeSocialHandle(socialFacebook, "Facebook");
        const normalizedSocialTwitter = normalizeSocialHandle(socialTwitter, "Twitter/X");
        const normalizedSocialDiscord = normalizeSocialHandle(socialDiscord, "Discord");
        const previousAvatarUrls = [context.viewer.avatarUrl, context.viewer.avatarPendingUrl];
        const normalizedAvatarDataUrl = removeAvatar ? null : storeAvatarDataUrl(avatarDataUrl, avatarStorageDir);
        const nowIso = new Date().toISOString();
        const nextAvatarUrl = removeAvatar ? null : context.viewer.avatarUrl ?? null;
        const nextPendingUrl = removeAvatar
          ? null
          : normalizedAvatarDataUrl ?? context.viewer.avatarPendingUrl ?? null;
        const nextReviewStatus = removeAvatar
          ? null
          : normalizedAvatarDataUrl
            ? "pending"
            : context.viewer.avatarReviewStatus ?? null;
        const nextTermsAcceptedAt = completingProfile ? nowIso : context.viewerRow.terms_accepted_at ?? null;
        const nextTermsVersion = completingProfile ? termsVersion : context.viewerRow.terms_version ?? null;
        const nextProfileIndexable = profileIndexable === null
          ? (context.viewerRow.profile_indexable !== 0 ? 1 : 0)
          : (profileIndexable === false ? 0 : 1);

        db.prepare(`
          UPDATE users
          SET name = ?, nickname = ?, nickname_norm = ?, description = ?, profile_show_description = ?, profile_show_joined_at = ?,
              social_whatsapp = ?, social_instagram = ?, social_tiktok = ?, social_facebook = ?, social_twitter = ?, social_discord = ?, profile_show_social = ?,
              profile_indexable = ?,
              avatar_url = ?, avatar_pending_url = ?, avatar_review_status = ?, profile_pending = 0,
              registration_age = ?, terms_accepted_at = ?, terms_version = ?,
              profile_suggested_name = NULL, profile_suggested_avatar_url = NULL, updated_at = ?
          WHERE id = ?
        `).run(
          normalizedDisplayName,
          normalizedUsername,
          normalizedUsernameKey,
          normalizedDescription,
          profileShowDescription === false ? 0 : 1,
          profileShowJoinedAt === false ? 0 : 1,
          normalizedSocialWhatsapp,
          normalizedSocialInstagram,
          normalizedSocialTiktok,
          normalizedSocialFacebook,
          normalizedSocialTwitter,
          normalizedSocialDiscord,
          profileShowSocial === false ? 0 : 1,
          nextProfileIndexable,
          nextAvatarUrl,
          nextPendingUrl,
          nextReviewStatus,
          normalizedRegistrationAge,
          nextTermsAcceptedAt,
          nextTermsVersion,
          nowIso,
          context.viewer.id
        );

        const nextAvatarUrls = new Set([nextAvatarUrl, nextPendingUrl].filter(Boolean));
        scheduleStoredAvatarCleanup(
          afterCommit,
          db,
          avatarStorageDir,
          previousAvatarUrls.filter((avatarUrl) => avatarUrl && !nextAvatarUrls.has(avatarUrl))
        );

        const refreshedContext = resolveViewer(db, {
          sessionId: context.sessionId,
          authMode,
          ipAddress
        });
        return buildFrontendPayload(db, refreshedContext, selectedTopicId);
      });
    },
    updateSettings({ sessionId, authMode, likesAnonymous = null, filterProfanity = null, notificationsFriendsOnly = null, profileIndexable = null, selectedTopicId = null, ipAddress = "" } = {}) {
      return withTransaction(db, () => {
        const context = resolveViewer(db, { sessionId, authMode, ipAddress });
        assertViewerCanParticipate(context.viewerRow);
        assertContextNotBlocked(db, context);
        if (context.viewer.type !== "registered") {
          throw new ApiError(403, "LOGIN_REQUIRED", "Hace falta iniciar sesion para cambiar la configuracion.");
        }

        const nextLikesAnonymous = likesAnonymous === null ? context.viewer.likesAnonymous : likesAnonymous === true;
        const nextFilterProfanity = filterProfanity === null ? context.viewer.filterProfanity : filterProfanity === true;
        const nextNotificationsFriendsOnly = notificationsFriendsOnly === null
          ? context.viewer.notificationsFriendsOnly
          : notificationsFriendsOnly === true;
        const nextProfileIndexable = profileIndexable === null
          ? context.viewerRow.profile_indexable !== 0
          : profileIndexable === true;

        db.prepare(`
          UPDATE users
          SET likes_anonymous = ?, filter_profanity = ?, notifications_friends_only = ?, profile_indexable = ?, updated_at = ?
          WHERE id = ?
        `).run(
          nextLikesAnonymous ? 1 : 0,
          nextFilterProfanity ? 1 : 0,
          nextNotificationsFriendsOnly ? 1 : 0,
          nextProfileIndexable ? 1 : 0,
          new Date().toISOString(),
          context.viewer.id
        );

        const refreshedContext = resolveViewer(db, {
          sessionId: context.sessionId,
          authMode,
          ipAddress
        });
        return buildFrontendPayload(db, refreshedContext, selectedTopicId);
      });
    },
    deleteAccount({ sessionId, authMode, selectedTopicId = null, ipAddress = "" } = {}) {
      return withTransaction(db, (afterCommit) => {
        const context = resolveViewer(db, { sessionId, authMode, ipAddress });
        if (context.viewer.type !== "registered") {
          throw new ApiError(403, "LOGIN_REQUIRED", "Hace falta iniciar sesion para eliminar la cuenta.");
        }

        const userId = context.viewer.id;
        const nowIso = new Date().toISOString();
        const previousAvatarUrls = [context.viewer.avatarUrl, context.viewer.avatarPendingUrl];

        db.prepare("DELETE FROM friend_requests WHERE requester_id = ? OR addressee_id = ?").run(userId, userId);
        db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);

        // Los mensajes y temas quedan (tienen FK al usuario); la fila se anonimiza y desactiva.
        db.prepare(`
          UPDATE users
          SET name = 'Usuario eliminado', nickname = NULL, nickname_norm = NULL,
              email = NULL, email_verified_at = NULL, auth_provider = NULL, auth_subject = NULL, password_hash = NULL,
              description = '', social_whatsapp = '', social_instagram = '', social_tiktok = '',
              social_facebook = '', social_twitter = '', social_discord = '',
              avatar_url = NULL, avatar_pending_url = NULL, avatar_review_status = NULL,
              profile_pending = 0, profile_suggested_name = NULL, profile_suggested_avatar_url = NULL,
              role = '', status = 'deleted', updated_at = ?
          WHERE id = ?
        `).run(nowIso, userId);

        scheduleStoredAvatarCleanup(afterCommit, db, avatarStorageDir, previousAvatarUrls);

        const guestContext = createGuestSession(db, context.sessionId, ipAddress, nowIso, null);
        return buildFrontendPayload(db, guestContext, selectedTopicId);
      });
    },
    bootstrap({ sessionId, authMode, selectedTopicId = null, ipAddress = "", profileNickname = null } = {}) {
      return withTransaction(db, () => {
        const context = resolveViewer(db, { sessionId, authMode, ipAddress });
        return buildFrontendPayload(db, context, selectedTopicId, profileNickname);
      });
    },
    refresh({ sessionId, authMode, selectedTopicId = null, ipAddress = "" } = {}) {
      return withTransaction(db, () => {
        const context = resolveViewer(db, { sessionId, authMode, ipAddress });
        return buildFrontendPayload(db, context, selectedTopicId);
      });
    },
    openTopic(topicId, { sessionId, authMode, ipAddress = "" } = {}) {
      return withTransaction(db, () => {
        const context = resolveViewer(db, { sessionId, authMode, ipAddress });
        const row = db.prepare("SELECT id FROM topics WHERE id = ?").get(topicId);
        if (!row) {
          throw new ApiError(404, "NOT_FOUND", "Tema no encontrado.");
        }
        return buildFrontendPayload(db, context, topicId);
      });
    },
    createTopic({ sessionId, authMode, title, text, ipAddress = "" } = {}) {
      return withTransaction(db, () => {
        const context = resolveViewer(db, { sessionId, authMode, ipAddress });
        assertRegisteredContextCanPost(db, context);
        const lastTopicAt = getContextActivityAt(db, context, "last_topic_at");
        assertRateLimit(lastTopicAt, context.viewer.type, "last_topic_at");
        const { normalizedTitle, normalizedText } = validateTopicInput(title, text);
        const topicId = `topic-${crypto.randomUUID()}`;
        const nowIso = new Date().toISOString();

        db.prepare(`
          INSERT INTO topics (
            id, title, subtitle, author_id, status, active_rank, last_message_id, last_activity_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
        `).run(
          topicId,
          normalizedTitle,
          summarizeText(normalizedText),
          context.viewer.id,
          TOPIC_STATUS_ACTIVE,
          nowIso,
          nowIso,
          nowIso
        );

        const messageResult = db.prepare(`
          INSERT INTO messages (topic_id, author_id, text, kind, likes, is_root, created_at)
          VALUES (?, ?, ?, 'user', 0, 1, ?)
        `).run(topicId, context.viewer.id, normalizedText, nowIso);

        db.prepare(`
          UPDATE topics
          SET subtitle = ?, last_message_id = ?, last_activity_at = ?, updated_at = ?
          WHERE id = ?
        `).run(summarizeText(normalizedText), Number(messageResult.lastInsertRowid), nowIso, nowIso, topicId);

        rebuildActiveTopicRanks(db);
        updateViewerActivity(db, context, "last_topic_at");

        const refreshedContext = resolveViewer(db, {
          sessionId: context.sessionId,
          authMode,
          ipAddress
        });
        return buildFrontendPayload(db, refreshedContext, topicId);
      });
    },
    addMessage(topicId, { sessionId, authMode, text, ipAddress = "" } = {}) {
      return withTransaction(db, () => {
        const context = resolveViewer(db, { sessionId, authMode, ipAddress });
        assertRegisteredContextCanPost(db, context);
        const lastMessageAt = getContextActivityAt(db, context, "last_message_at");
        assertRateLimit(lastMessageAt, context.viewer.type, "last_message_at");
        const normalizedText = validateMessageInput(text);
        const topicRow = db.prepare("SELECT * FROM topics WHERE id = ?").get(topicId);
        assertCommentableTopic(topicRow);

        const nowIso = new Date().toISOString();
        const messageResult = db.prepare(`
          INSERT INTO messages (topic_id, author_id, text, kind, likes, is_root, created_at)
          VALUES (?, ?, ?, 'user', 0, 0, ?)
        `).run(topicId, context.viewer.id, normalizedText, nowIso);

        trimTopicReplies(db, topicId);
        db.prepare(`
          UPDATE topics
          SET subtitle = ?, last_message_id = ?, last_activity_at = ?, updated_at = ?
          WHERE id = ?
        `).run(
          summarizeText(normalizedText),
          Number(messageResult.lastInsertRowid),
          nowIso,
          nowIso,
          topicId
        );

        rebuildActiveTopicRanks(db);
        updateViewerActivity(db, context, "last_message_at");

        const refreshedContext = resolveViewer(db, {
          sessionId: context.sessionId,
          authMode,
          ipAddress
        });
        return buildFrontendPayload(db, refreshedContext, topicId);
      });
    },
    toggleMessageLike(messageId, { sessionId, authMode, selectedTopicId = null, ipAddress = "" } = {}) {
      return withTransaction(db, () => {
        const context = resolveViewer(db, { sessionId, authMode, ipAddress });
        assertContextCanParticipate(db, context);
        if (context.viewer.type !== "registered") {
          throw new ApiError(403, "LOGIN_REQUIRED", "Hace falta iniciar sesion para dar likes.");
        }

        resetDailyMessageReactionsIfNeeded(db);
        const messageRow = assertLikeableMessage(db, messageId);
        recordMessageReaction(db, messageRow, context.viewer.id, "like");
        return buildFrontendPayload(db, context, selectedTopicId || messageRow.topic_id);
      });
    },
    toggleMessageDislike(messageId, { sessionId, authMode, selectedTopicId = null, ipAddress = "" } = {}) {
      return withTransaction(db, () => {
        const context = resolveViewer(db, { sessionId, authMode, ipAddress });
        assertContextCanParticipate(db, context);
        if (context.viewer.type !== "registered") {
          throw new ApiError(403, "LOGIN_REQUIRED", "Hace falta iniciar sesion para dar dislikes.");
        }

        resetDailyMessageReactionsIfNeeded(db);
        const messageRow = assertLikeableMessage(db, messageId);
        recordMessageReaction(db, messageRow, context.viewer.id, "dislike");
        return buildFrontendPayload(db, context, selectedTopicId || messageRow.topic_id);
      });
    },
    sendFriendRequest(targetUserId, { sessionId, authMode, selectedTopicId = null, ipAddress = "" } = {}) {
      return withTransaction(db, () => {
        const context = resolveViewer(db, { sessionId, authMode, ipAddress });
        assertRegisteredFriendContext(db, context);
        const target = assertFriendTarget(db, context.viewer.id, targetUserId);
        const nowIso = new Date().toISOString();
        const existing = getFriendRequestBetween(db, context.viewer.id, target.id);

        if (!existing) {
          db.prepare(`
            INSERT INTO friend_requests (requester_id, addressee_id, status, created_at, updated_at)
            VALUES (?, ?, 'pending', ?, ?)
          `).run(context.viewer.id, target.id, nowIso, nowIso);
          return buildFrontendPayload(db, context, selectedTopicId);
        }

        if (existing.status === 'accepted') {
          return buildFrontendPayload(db, context, selectedTopicId);
        }

        if (existing.status === 'pending' && existing.addressee_id === context.viewer.id) {
          db.prepare(`
            UPDATE friend_requests
            SET status = 'accepted', updated_at = ?
            WHERE id = ?
          `).run(nowIso, existing.id);
          return buildFrontendPayload(db, context, selectedTopicId);
        }

        if (existing.status === 'rejected') {
          db.prepare(`
            UPDATE friend_requests
            SET requester_id = ?, addressee_id = ?, status = 'pending', updated_at = ?
            WHERE id = ?
          `).run(context.viewer.id, target.id, nowIso, existing.id);
        }

        return buildFrontendPayload(db, context, selectedTopicId);
      });
    },
    acceptFriendRequest(requesterUserId, { sessionId, authMode, selectedTopicId = null, ipAddress = "" } = {}) {
      return withTransaction(db, () => {
        const context = resolveViewer(db, { sessionId, authMode, ipAddress });
        assertRegisteredFriendContext(db, context);
        const requester = assertFriendTarget(db, context.viewer.id, requesterUserId);
        const nowIso = new Date().toISOString();
        const result = db.prepare(`
          UPDATE friend_requests
          SET status = 'accepted', updated_at = ?
          WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'
        `).run(nowIso, requester.id, context.viewer.id);

        if (!result.changes) {
          throw new ApiError(404, "NOT_FOUND", "Solicitud de amistad no encontrada.");
        }

        return buildFrontendPayload(db, context, selectedTopicId);
      });
    },
    rejectFriendRequest(requesterUserId, { sessionId, authMode, selectedTopicId = null, ipAddress = "" } = {}) {
      return withTransaction(db, () => {
        const context = resolveViewer(db, { sessionId, authMode, ipAddress });
        assertRegisteredFriendContext(db, context);
        const requester = assertFriendTarget(db, context.viewer.id, requesterUserId);
        const nowIso = new Date().toISOString();
        const result = db.prepare(`
          UPDATE friend_requests
          SET status = 'rejected', updated_at = ?
          WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'
        `).run(nowIso, requester.id, context.viewer.id);

        if (!result.changes) {
          throw new ApiError(404, "NOT_FOUND", "Solicitud de amistad no encontrada.");
        }

        return buildFrontendPayload(db, context, selectedTopicId);
      });
    },    reportEntity(entityType, entityId, { sessionId, authMode, reason = "", selectedTopicId = null, ipAddress = "" } = {}) {
      return withTransaction(db, () => {
        const context = resolveViewer(db, { sessionId, authMode, ipAddress, persistGuest: true });
        assertContextCanParticipate(db, context);
        const normalizedEntityType = entityType === "message"
          ? "message"
          : entityType === "user"
            ? "user"
            : "topic";
        const target = assertReportableEntity(db, normalizedEntityType, entityId);
        const normalizedReason = validateReportReason(reason, target.entityType);

        const existingReport = db.prepare(`
          SELECT id
          FROM reports
          WHERE reporter_session_id = ? AND entity_type = ? AND entity_id = ? AND status = ?
          LIMIT 1
        `).get(context.sessionId, target.entityType, target.entityId, REPORT_STATUS_OPEN);

        if (!existingReport) {
          db.prepare(`
            INSERT INTO reports (
              entity_type, entity_id, reason, reporter_session_id, reporter_user_id, status, resolved_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
          `).run(
            target.entityType,
            target.entityId,
            normalizedReason,
            context.sessionId,
            context.viewer.id,
            REPORT_STATUS_OPEN,
            new Date().toISOString()
          );
        }

        const reportSelectedTopicId = target.entityType === "topic"
          ? target.entityId
          : target.entityType === "message"
            ? selectedTopicId || target.topicId
          : selectedTopicId;
        return buildFrontendPayload(db, context, reportSelectedTopicId);
      });
    },
    listReports({ sessionId, authMode, ipAddress = "", reportPage = 1, reportLimit = ADMIN_REPORT_PAGE_SIZE } = {}) {
      return withTransaction(db, () => {
        const context = resolveViewer(db, { sessionId, authMode, ipAddress });
        assertModerator(context.viewerRow);
        const reportPageResult = listOpenReports(db, { page: reportPage, limit: reportLimit });
        return {
          reports: reportPageResult.items,
          reportPagination: reportPageResult.pagination
        };
      });
    },
    getAdminDashboard({
      sessionId,
      authMode,
      ipAddress = "",
      reportPage = 1,
      reportLimit = ADMIN_REPORT_PAGE_SIZE,
      avatarPage = 1,
      avatarLimit = ADMIN_AVATAR_PAGE_SIZE
    } = {}) {
      return withTransaction(db, () => {
        const context = resolveViewer(db, { sessionId, authMode, ipAddress });
        assertModerator(context.viewerRow);
        const reportPageResult = listOpenReports(db, { page: reportPage, limit: reportLimit });
        const avatarPageResult = listPendingAvatars(db, { page: avatarPage, limit: avatarLimit });
        return {
          viewer: context.viewer,
          reports: reportPageResult.items,
          reportPagination: reportPageResult.pagination,
          pendingAvatars: avatarPageResult.items,
          avatarPagination: avatarPageResult.pagination
        };
      });
    },
    applyModerationAction(actionType, {
      sessionId,
      authMode,
      targetType,
      targetId,
      reason = "",
      banHours = null,
      selectedTopicId = null,
      ipAddress = ""
    } = {}) {
      return withTransaction(db, (afterCommit) => {
        const context = resolveViewer(db, { sessionId, authMode, ipAddress });
        assertModerator(context.viewerRow);
        const nowIso = new Date().toISOString();
        const normalizedActionType = String(actionType || "").trim();
        const normalizedReason = normalizeMessageText(reason);

        if (normalizedActionType === "block_topic") {
          const normalizedTopicId = assertExistingTopic(db, targetId).id;

          db.prepare(`
            UPDATE topics
            SET status = ?, active_rank = NULL, updated_at = ?
            WHERE id = ?
          `).run(TOPIC_STATUS_BLOCKED, nowIso, normalizedTopicId);
          resolveReportsForEntity(db, "topic", normalizedTopicId, nowIso);
          recordModerationAction(db, {
            actionType: normalizedActionType,
            targetType: "topic",
            targetId: normalizedTopicId,
            actorUserId: context.viewer.id,
            reason: normalizedReason,
            createdAt: nowIso
          });

          return buildFrontendPayload(db, context, selectedTopicId || normalizedTopicId);
        }

        if (normalizedActionType === "pin_topic") {
          const topicRow = assertExistingTopic(db, targetId);
          if (topicRow.status === TOPIC_STATUS_BLOCKED) {
            throw new ApiError(409, "INVALID_MODERATION_TARGET", "Un tema bloqueado no se fija en esta etapa.");
          }

          db.prepare(`
            UPDATE topics
            SET status = ?, updated_at = ?
            WHERE id = ?
          `).run(TOPIC_STATUS_PINNED, nowIso, topicRow.id);
          rebuildActiveTopicRanks(db);
          recordModerationAction(db, {
            actionType: normalizedActionType,
            targetType: "topic",
            targetId: topicRow.id,
            actorUserId: context.viewer.id,
            reason: normalizedReason,
            createdAt: nowIso
          });

          return buildFrontendPayload(db, context, selectedTopicId || topicRow.id);
        }

        if (normalizedActionType === "delete_message") {
          const normalizedMessageId = normalizeMessageEntityId(targetId);
          const messageRow = db.prepare(`
            SELECT id, topic_id, is_root
            FROM messages
            WHERE id = ?
          `).get(normalizedMessageId);
          if (!messageRow) {
            throw new ApiError(404, "NOT_FOUND", "Mensaje no encontrado.");
          }
          if (Boolean(messageRow.is_root)) {
            throw new ApiError(409, "ROOT_MESSAGE_IMMUTABLE", "El mensaje raiz no se elimina en esta etapa.");
          }

          db.prepare("DELETE FROM messages WHERE id = ?").run(normalizedMessageId);
          recalculateTopicActivity(db, messageRow.topic_id, nowIso);
          rebuildActiveTopicRanks(db);
          resolveReportsForEntity(db, "message", normalizedMessageId, nowIso);
          recordModerationAction(db, {
            actionType: normalizedActionType,
            targetType: "message",
            targetId: normalizedMessageId,
            actorUserId: context.viewer.id,
            reason: normalizedReason,
            createdAt: nowIso
          });

          return buildFrontendPayload(db, context, selectedTopicId || messageRow.topic_id);
        }

        if (normalizedActionType === "expel_user") {
          const userRow = assertExistingUser(db, targetId);
          const normalizedUserId = userRow.id;
          if (userRow.type !== "registered") {
            throw new ApiError(409, "INVALID_MODERATION_TARGET", "Solo se expulsa a usuarios registrados en esta etapa.");
          }

          let bannedUntil = null;
          let status = USER_STATUS_EXPELLED;

          if (banHours !== null && banHours !== "permanent" && banHours !== "") {
            const hours = Number(banHours);
            if (Number.isFinite(hours) && hours > 0) {
              const date = new Date(nowIso);
              date.setHours(date.getHours() + hours);
              bannedUntil = date.toISOString();
              status = USER_STATUS_ACTIVE;
            }
          }

          db.prepare(`
            UPDATE users
            SET status = ?, banned_until = ?, updated_at = ?
            WHERE id = ?
          `).run(status, bannedUntil, nowIso, normalizedUserId);
          resolveReportsForEntity(db, "user", normalizedUserId, nowIso);
          recordModerationAction(db, {
            actionType: normalizedActionType,
            targetType: "user",
            targetId: normalizedUserId,
            actorUserId: context.viewer.id,
            reason: bannedUntil ? `Suspension por ${banHours} horas` : (normalizedReason || "Ban permanente"),
            createdAt: nowIso
          });

          return buildFrontendPayload(db, context, selectedTopicId);
        }

        if (normalizedActionType === "approve_avatar") {
          const userRow = assertExistingUser(db, targetId);
          if (userRow.type !== "registered" || !userRow.avatar_pending_url) {
            throw new ApiError(409, "INVALID_MODERATION_TARGET", "Este usuario no tiene una foto pendiente.");
          }

          db.prepare(`
            UPDATE users
            SET avatar_url = ?, avatar_pending_url = NULL, avatar_review_status = 'approved', updated_at = ?
            WHERE id = ?
          `).run(userRow.avatar_pending_url, nowIso, userRow.id);
          scheduleStoredAvatarCleanup(
            afterCommit,
            db,
            avatarStorageDir,
            userRow.avatar_url && userRow.avatar_url !== userRow.avatar_pending_url ? [userRow.avatar_url] : []
          );
          recordModerationAction(db, {
            actionType: normalizedActionType,
            targetType: "user",
            targetId: userRow.id,
            actorUserId: context.viewer.id,
            reason: normalizedReason,
            createdAt: nowIso
          });

          return buildFrontendPayload(db, context, selectedTopicId);
        }

        if (normalizedActionType === "reject_avatar") {
          const userRow = assertExistingUser(db, targetId);
          if (userRow.type !== "registered" || !userRow.avatar_pending_url) {
            throw new ApiError(409, "INVALID_MODERATION_TARGET", "Este usuario no tiene una foto pendiente.");
          }

          db.prepare(`
            UPDATE users
            SET avatar_pending_url = NULL, avatar_review_status = 'rejected', updated_at = ?
            WHERE id = ?
          `).run(nowIso, userRow.id);
          scheduleStoredAvatarCleanup(afterCommit, db, avatarStorageDir, [userRow.avatar_pending_url]);
          recordModerationAction(db, {
            actionType: normalizedActionType,
            targetType: "user",
            targetId: userRow.id,
            actorUserId: context.viewer.id,
            reason: normalizedReason,
            createdAt: nowIso
          });

          return buildFrontendPayload(db, context, selectedTopicId);
        }
        if (normalizedActionType === "block_session") {
          const normalizedSessionId = String(targetId || "").trim();
          if (!normalizedSessionId) {
            throw new ApiError(400, "INVALID_MODERATION_TARGET", "La sesion objetivo es obligatoria.");
          }

          const sessionRow = readSessionRow(db, normalizedSessionId);
          if (!sessionRow) {
            throw new ApiError(404, "NOT_FOUND", "Sesion no encontrada.");
          }

          insertOrUpdateBlockedSession(db, {
            sessionId: normalizedSessionId,
            actorUserId: context.viewer.id,
            reason: normalizedReason,
            createdAt: nowIso
          });
          recordModerationAction(db, {
            actionType: normalizedActionType,
            targetType: "session",
            targetId: normalizedSessionId,
            actorUserId: context.viewer.id,
            reason: normalizedReason,
            createdAt: nowIso
          });

          return buildFrontendPayload(db, context, selectedTopicId);
        }

        if (normalizedActionType === "block_ip") {
          const normalizedIpAddress = normalizeIpAddress(targetId);
          if (!normalizedIpAddress) {
            throw new ApiError(400, "INVALID_MODERATION_TARGET", "La IP objetivo es obligatoria.");
          }

          insertOrUpdateBlockedIp(db, {
            ipAddress: normalizedIpAddress,
            actorUserId: context.viewer.id,
            reason: normalizedReason,
            createdAt: nowIso
          });
          recordModerationAction(db, {
            actionType: normalizedActionType,
            targetType: "ip",
            targetId: normalizedIpAddress,
            actorUserId: context.viewer.id,
            reason: normalizedReason,
            createdAt: nowIso
          });

          return buildFrontendPayload(db, context, selectedTopicId);
        }

        if (normalizedActionType === "mark_problematic") {
          const normalizedTargetType = String(targetType || "").trim();
          const target = assertReportableEntity(db, normalizedTargetType, targetId);
          const reportReason = validateReportReason(normalizedReason, target.entityType);
          const existingModeratorReport = db.prepare(`
            SELECT id
            FROM reports
            WHERE reporter_session_id IS NULL AND reporter_user_id = ? AND entity_type = ? AND entity_id = ? AND status = ?
            LIMIT 1
          `).get(context.viewer.id, target.entityType, target.entityId, REPORT_STATUS_OPEN);

          if (!existingModeratorReport) {
            db.prepare(`
              INSERT INTO reports (
                entity_type, entity_id, reason, reporter_session_id, reporter_user_id, status, resolved_at, created_at
              ) VALUES (?, ?, ?, NULL, ?, ?, NULL, ?)
            `).run(
              target.entityType,
              target.entityId,
              reportReason,
              context.viewer.id,
              REPORT_STATUS_OPEN,
              nowIso
            );
          }

          recordModerationAction(db, {
            actionType: normalizedActionType,
            targetType: target.entityType,
            targetId: target.entityId,
            actorUserId: context.viewer.id,
            reason: reportReason,
            createdAt: nowIso
          });

          const nextSelectedTopicId = target.entityType === "topic"
            ? target.entityId
            : target.entityType === "message"
              ? selectedTopicId || target.topicId
              : selectedTopicId;
          return buildFrontendPayload(db, context, nextSelectedTopicId);
        }

        throw new ApiError(400, "INVALID_MODERATION_ACTION", "Accion de moderacion no soportada.");
      });
    },
    // Lecturas para las páginas SEO server-rendered: nunca crean sesiones ni escriben.
    getSeoTopicEntries() {
      return db.prepare(`
        SELECT
          topics.id,
          topics.title,
          topics.last_activity_at,
          (
            SELECT COUNT(*)
            FROM messages
            WHERE messages.topic_id = topics.id
              AND messages.kind = 'user'
              AND messages.is_root = 0
          ) AS comment_count
        FROM topics
        WHERE topics.status IN (?, ?)
        ORDER BY topics.active_rank ASC
        LIMIT ?
      `).all(TOPIC_STATUS_ACTIVE, TOPIC_STATUS_PINNED, ACTIVE_TOPIC_LIMIT).map((row) => ({
        id: row.id,
        title: row.title,
        lastActivityAt: row.last_activity_at,
        commentCount: Number(row.comment_count ?? 0),
        isThin: Number(row.comment_count ?? 0) < SEO_THIN_TOPIC_COMMENT_COUNT
      }));
    },
    getTopicPageData(topicId) {
      const normalizedId = String(topicId || "").trim();
      const topicRow = normalizedId
        ? db.prepare("SELECT * FROM topics WHERE id = ?").get(normalizedId)
        : null;
      if (!topicRow || topicRow.status === TOPIC_STATUS_BLOCKED) {
        throw new ApiError(404, "TOPIC_NOT_FOUND", "Tema no encontrado.");
      }

      const authorRow = db.prepare("SELECT name, nickname, type FROM users WHERE id = ?")
        .get(topicRow.author_id);
      const messages = db.prepare(`
        SELECT
          messages.text,
          messages.kind,
          messages.likes,
          messages.is_root,
          messages.created_at,
          users.name AS author_name,
          users.nickname AS author_nickname,
          users.type AS author_type
        FROM messages
        JOIN users ON users.id = messages.author_id
        WHERE messages.topic_id = ?
        ORDER BY messages.id ASC
      `).all(normalizedId).map((row) => ({
        text: row.text,
        kind: row.kind,
        likes: Number(row.likes ?? 0),
        isRoot: Boolean(row.is_root),
        createdAt: row.created_at,
        authorName: row.author_name,
        authorNickname: row.author_nickname ?? null,
        authorType: row.author_type
      }));
      const commentCount = messages.filter((message) => message.kind === "user" && !message.isRoot).length;
      const likeCount = messages.reduce((total, message) => total + message.likes, 0);
      const relatedTopics = getActiveTopicsForFrontend(db)
        .filter((row) => row.id !== normalizedId)
        .slice(0, 5)
        .map((row) => ({ id: row.id, title: row.title }));

      return {
        id: topicRow.id,
        title: topicRow.title,
        createdAt: topicRow.created_at,
        lastActivityAt: topicRow.last_activity_at,
        isExpelled: topicRow.status === TOPIC_STATUS_EXPELLED,
        isBlocked: false,
        isThin: commentCount < SEO_THIN_TOPIC_COMMENT_COUNT,
        author: {
          name: authorRow?.name || "Usuario de TOPYKLY",
          nickname: authorRow?.nickname ?? null,
          type: authorRow?.type || "guest"
        },
        messages,
        relatedTopics,
        commentCount,
        likeCount
      };
    },
    getPublicProfileByNickname(nickname) {
      const key = normalizeUniqueNameKey(nickname);
      const row = key
        ? db.prepare(`
          SELECT id, name, nickname, description, created_at, updated_at, avatar_url,
                 profile_show_description, profile_show_joined_at, profile_indexable
          FROM users
          WHERE nickname_norm = ? AND type = 'registered' AND status = 'active'
        `).get(key)
        : null;
      if (!row) {
        throw new ApiError(404, "PROFILE_NOT_FOUND", "Perfil no encontrado.");
      }

      const stats = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM topics WHERE author_id = ? AND status != 'blocked') AS post_count,
          (SELECT COUNT(*) FROM messages WHERE author_id = ? AND kind = 'user' AND is_root = 0) AS comment_count,
          (SELECT COALESCE(SUM(likes), 0) FROM messages WHERE author_id = ? AND kind = 'user') AS like_count
      `).get(row.id, row.id, row.id);
      const recentTopics = db.prepare(`
        SELECT id, title
        FROM topics
        WHERE author_id = ? AND status IN (?, ?)
        ORDER BY created_at DESC
        LIMIT 5
      `).all(row.id, TOPIC_STATUS_ACTIVE, TOPIC_STATUS_PINNED);
      const postCount = Number(stats?.post_count ?? 0);
      const commentCount = Number(stats?.comment_count ?? 0);
      const hasActivity = postCount > 0 || commentCount > 0;

      return {
        name: row.name,
        nickname: row.nickname,
        avatarUrl: row.avatar_url ?? null,
        description: row.profile_show_description !== 0 ? row.description || "" : "",
        joinedAt: row.profile_show_joined_at !== 0 ? row.created_at : null,
        postCount,
        commentCount,
        likeCount: Number(stats?.like_count ?? 0),
        recentTopics,
        indexable: row.profile_indexable !== 0 && hasActivity,
        lastmod: row.updated_at ?? row.created_at ?? null
      };
    },
    getSeoProfileEntries() {
      return db.prepare(`
        SELECT users.nickname, users.updated_at, users.created_at
        FROM users
        WHERE users.type = 'registered'
          AND users.status = 'active'
          AND users.nickname IS NOT NULL
          AND users.profile_indexable != 0
          AND (
            EXISTS (
              SELECT 1 FROM topics
              WHERE topics.author_id = users.id AND topics.status != 'blocked'
            )
            OR EXISTS (
              SELECT 1 FROM messages
              WHERE messages.author_id = users.id AND messages.kind = 'user' AND messages.is_root = 0
            )
          )
        ORDER BY users.created_at ASC
        LIMIT 500
      `).all().map((row) => ({
        nickname: row.nickname,
        lastmod: row.updated_at ?? row.created_at ?? null
      }));
    },
    getDiagnosticsForViewer({ sessionId, authMode, ipAddress = "" } = {}) {
      return withTransaction(db, () => {
        const context = resolveViewer(db, { sessionId, authMode, ipAddress });
        assertModerator(context.viewerRow);
        return this.getDiagnostics();
      });
    },
    getDiagnostics() {
      const topics = db.prepare("SELECT COUNT(*) AS count FROM topics").get()?.count ?? 0;
      const messages = db.prepare("SELECT COUNT(*) AS count FROM messages").get()?.count ?? 0;
      const users = db.prepare("SELECT COUNT(*) AS count FROM users").get()?.count ?? 0;
      const sessions = db.prepare("SELECT COUNT(*) AS count FROM sessions").get()?.count ?? 0;
      const reports = db.prepare("SELECT COUNT(*) AS count FROM reports WHERE status = ?").get(REPORT_STATUS_OPEN)?.count ?? 0;
      const blockedSessions = db.prepare("SELECT COUNT(*) AS count FROM blocked_sessions").get()?.count ?? 0;
      const blockedIps = db.prepare("SELECT COUNT(*) AS count FROM blocked_ips").get()?.count ?? 0;
      return {
        dbPath: resolvedDbPath,
        dbPathSource: dbConfig.dbPathSource,
        storageConfigured: dbConfig.storageConfigured,
        storageWarning: dbConfig.storageWarning,
        topics,
        messages,
        users,
        sessions,
        reports,
        blockedSessions,
        blockedIps
      };
    }
  };
}

export { ApiError, DEFAULT_DB_PATH, resolveDbConfig, shouldSeedDemoData };
