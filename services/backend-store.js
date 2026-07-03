import crypto from "node:crypto";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { initialUsers, topicSeedData } from "../data.js";

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
const PASSWORD_MIN_LENGTH = 8;
const AVATAR_UPLOAD_MAX_BYTES = 256 * 1024;
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
  if (row?.type === "registered" && isAdminEmail(row.email)) {
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

function normalizeNickname(value) {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  if (normalized.length < NICKNAME_MIN_LENGTH || normalized.length > NICKNAME_MAX_LENGTH) {
    throw new ApiError(400, "VALIDATION_ERROR", `El nickname debe tener entre ${NICKNAME_MIN_LENGTH} y ${NICKNAME_MAX_LENGTH} caracteres.`);
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(normalized)) {
    throw new ApiError(400, "VALIDATION_ERROR", "El nickname solo puede usar letras, numeros, punto, guion y guion bajo.");
  }

  return normalized;
}

function normalizeNicknameKey(value) {
  return normalizeNickname(value).toLowerCase();
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
    throw new ApiError(400, "VALIDATION_ERROR", "La foto no puede superar 256 KB.");
  }

  if (!AVATAR_UPLOAD_MIME_TYPES.has(mimeType)) {
    throw new ApiError(400, "VALIDATION_ERROR", "El tipo de imagen no esta permitido.");
  }

  const avatarBuffer = Buffer.from(payload, "base64");
  if (avatarBuffer.byteLength > AVATAR_UPLOAD_MAX_BYTES) {
    throw new ApiError(400, "VALIDATION_ERROR", "La foto no puede superar 256 KB.");
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
      avatar_url TEXT,
      avatar_pending_url TEXT,
      avatar_review_status TEXT,
      profile_pending INTEGER NOT NULL DEFAULT 0,
      profile_suggested_name TEXT,
      profile_suggested_avatar_url TEXT,
      last_topic_at TEXT,
      last_message_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
  `);

  ensureColumn(db, "users", "last_topic_at", "TEXT");
  ensureColumn(db, "users", "last_message_at", "TEXT");
  ensureColumn(db, "users", "auth_provider", "TEXT");
  ensureColumn(db, "users", "auth_subject", "TEXT");
  ensureColumn(db, "users", "email", "TEXT");
  ensureColumn(db, "users", "nickname", "TEXT");
  ensureColumn(db, "users", "nickname_norm", "TEXT");
  ensureColumn(db, "users", "password_hash", "TEXT");
  ensureColumn(db, "users", "avatar_url", "TEXT");
  ensureColumn(db, "users", "avatar_pending_url", "TEXT");
  ensureColumn(db, "users", "avatar_review_status", "TEXT");
  ensureColumn(db, "users", "profile_pending", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "users", "profile_suggested_name", "TEXT");
  ensureColumn(db, "users", "profile_suggested_avatar_url", "TEXT");
  ensureColumn(db, "reports", "reporter_session_id", "TEXT");
  ensureColumn(db, "reports", "reporter_user_id", "TEXT");
  ensureColumn(db, "reports", "status", `TEXT NOT NULL DEFAULT '${REPORT_STATUS_OPEN}'`);
  ensureColumn(db, "reports", "resolved_at", "TEXT");
  ensureColumn(db, "moderation_actions", "actor_user_id", "TEXT");
  ensureColumn(db, "moderation_actions", "reason", "TEXT NOT NULL DEFAULT ''");
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_auth_identity_idx
    ON users(auth_provider, auth_subject)
    WHERE auth_provider IS NOT NULL AND auth_subject IS NOT NULL;

    CREATE INDEX IF NOT EXISTS users_email_idx
    ON users(email)
    WHERE email IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS users_nickname_norm_idx
    ON users(nickname_norm)
    WHERE nickname_norm IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS users_password_email_idx
    ON users(email)
    WHERE email IS NOT NULL AND password_hash IS NOT NULL;
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

    CREATE INDEX IF NOT EXISTS topics_status_rank_idx
    ON topics(status, active_rank ASC);

    CREATE INDEX IF NOT EXISTS topics_status_activity_idx
    ON topics(status, last_message_id DESC, created_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS messages_topic_id_idx
    ON messages(topic_id, id ASC);

    CREATE INDEX IF NOT EXISTS messages_topic_reply_trim_idx
    ON messages(topic_id, is_root, id DESC);

    CREATE INDEX IF NOT EXISTS reports_session_open_idx
    ON reports(reporter_session_id, status, id DESC);

    CREATE INDEX IF NOT EXISTS reports_user_open_idx
    ON reports(reporter_user_id, entity_type, entity_id, status);

    CREATE INDEX IF NOT EXISTS reports_entity_open_idx
    ON reports(entity_type, entity_id, status);

    CREATE INDEX IF NOT EXISTS reports_status_created_idx
    ON reports(status, created_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS guest_ip_rate_limits_updated_idx
    ON guest_ip_rate_limits(updated_at);

    CREATE INDEX IF NOT EXISTS moderation_actions_target_idx
    ON moderation_actions(target_type, target_id, created_at DESC);
  `);
}

function ensureColumn(db, tableName, columnName, columnDefinition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
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
function seedDatabase(db) {
  seedUsers(db);
  seedTopics(db);
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
    avatarUrl: row.avatar_url ?? null,
    avatarPendingUrl: row.avatar_pending_url ?? null,
    avatarReviewStatus: row.avatar_review_status ?? null,
    profilePending: Boolean(row.profile_pending),
    profileSuggestedName: row.profile_suggested_name ?? null,
    profileSuggestedAvatarUrl: row.profile_suggested_avatar_url ?? null,
    authProvider: row.auth_provider ?? null,
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

  if (existingSessionRow) {
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

function getFrontendUsers(db, viewerId) {
  return db.prepare(`
    SELECT id, name, nickname, type, role, score, email, avatar_url AS avatarUrl, avatar_pending_url AS avatarPendingUrl, avatar_review_status AS avatarReviewStatus, profile_pending AS profilePending
    FROM users
    WHERE status = 'active' AND (type = 'registered' OR id = ?)
    ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, score DESC, created_at ASC
    LIMIT 12
  `).all(viewerId, viewerId);
}

function hydrateTopicMessages(db, topicId) {
  return db.prepare(`
    SELECT id, topic_id, author_id, text, kind, likes, is_root, created_at
    FROM messages
    WHERE topic_id = ?
    ORDER BY id ASC
  `).all(topicId).map((row) => ({
    id: `message-${row.id}`,
    topicId: row.topic_id,
    authorId: row.author_id,
    text: row.text,
    kind: row.kind,
    likes: row.likes,
    isRoot: Boolean(row.is_root),
    createdAt: row.created_at,
    timestamp: row.created_at
  }));
}

function hydrateTopic(db, row, { forceVisible = null } = {}) {
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
    messages: hydrateTopicMessages(db, row.id)
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

function buildFrontendPayload(db, context, selectedTopicId = null) {
  rebuildActiveTopicRanks(db);

  const activeTopicRows = getActiveTopicsForFrontend(db);
  const topicIds = new Set(activeTopicRows.map((row) => row.id));
  const topics = activeTopicRows.map((row) => hydrateTopic(db, row));
  const reportSnapshot = getReportSnapshot(db, context.sessionId);
  let resolvedSelectedTopicId = selectedTopicId && topicIds.has(selectedTopicId) ? selectedTopicId : null;

  if (selectedTopicId && !topicIds.has(selectedTopicId)) {
    const selectedRow = db.prepare("SELECT * FROM topics WHERE id = ?").get(selectedTopicId);
    if (selectedRow) {
      topics.push(hydrateTopic(db, selectedRow, { forceVisible: false }));
      resolvedSelectedTopicId = selectedTopicId;
    }
  }

  return {
    sessionId: context.sessionId,
    viewer: context.viewer,
    users: getFrontendUsers(db, context.viewer.id),
    topics,
    selectedTopicId: resolvedSelectedTopicId,
    reportedTopicIds: reportSnapshot.reportedTopicIds,
    reportedMessageIds: reportSnapshot.reportedMessageIds
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
  if (!viewerRow || viewerRow.status === USER_STATUS_ACTIVE) {
    return;
  }

  throw new ApiError(403, "USER_EXPELLED", "Este usuario no puede participar en esta etapa.");
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

function getPasswordUserByEmail(db, email) {
  return db.prepare(`
    SELECT *
    FROM users
    WHERE email = ? AND password_hash IS NOT NULL
    LIMIT 1
  `).get(email);
}

function createPasswordUser(db, { email, password, nickname, nowIso }) {
  const normalizedEmail = normalizeRequiredEmail(email);
  const normalizedNickname = normalizeNickname(nickname);
  const nicknameKey = normalizeNicknameKey(normalizedNickname);
  const existingEmail = getPasswordUserByEmail(db, normalizedEmail);
  if (existingEmail) {
    throw new ApiError(409, "EMAIL_TAKEN", "Ese email ya tiene una cuenta.");
  }
  assertNicknameAvailable(db, nicknameKey);

  const userId = `user-${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO users (
      id, name, nickname, nickname_norm, type, role, score, status, email, password_hash,
      profile_pending, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'registered', ?, 0, 'active', ?, ?, 0, ?, ?)
  `).run(
    userId,
    normalizedNickname,
    normalizedNickname,
    nicknameKey,
    isAdminEmail(normalizedEmail) ? ADMIN_ROLE : DEFAULT_REGISTERED_ROLE,
    normalizedEmail,
    hashPassword(validatePassword(password)),
    nowIso,
    nowIso
  );

  return db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
}

function getAuthenticatedPasswordUser(db, { email, password }) {
  const normalizedEmail = normalizeRequiredEmail(email);
  const userRow = getPasswordUserByEmail(db, normalizedEmail);
  if (!userRow || !verifyPassword(password, userRow.password_hash)) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Email o contrasena incorrectos.");
  }

  return userRow;
}
function getOrCreateAuthenticatedUser(db, {
  authProvider,
  authSubject,
  email,
  displayName,
  avatarUrl,
  nowIso
}) {
  const normalizedProvider = String(authProvider || "").trim();
  const normalizedSubject = String(authSubject || "").trim();
  const normalizedEmail = normalizeOptionalEmail(email);
  const normalizedSuggestedAvatarUrl = normalizeAvatarUrl(avatarUrl, { discardInvalid: true });
  const normalizedSuggestedDisplayName = normalizeUserDisplayName(
    displayName,
    normalizedEmail ? normalizedEmail.split("@")[0] : "Usuario"
  );
  const resolvedRole = isAdminEmail(normalizedEmail) ? ADMIN_ROLE : DEFAULT_REGISTERED_ROLE;

  if (!normalizedProvider || !normalizedSubject) {
    throw new ApiError(400, "INVALID_AUTH_IDENTITY", "La identidad autenticada no es valida.");
  }

  const existingUser = db.prepare(`
    SELECT *
    FROM users
    WHERE auth_provider = ? AND auth_subject = ?
    LIMIT 1
  `).get(normalizedProvider, normalizedSubject);

  if (existingUser) {
    const nextRole = resolvedRole === ADMIN_ROLE || isModeratorRole(existingUser.role || "")
      ? (resolvedRole === ADMIN_ROLE ? ADMIN_ROLE : existingUser.role)
      : DEFAULT_REGISTERED_ROLE;
    db.prepare(`
      UPDATE users
      SET role = ?, email = ?, profile_suggested_name = ?, profile_suggested_avatar_url = ?, updated_at = ?
      WHERE id = ?
    `).run(
      nextRole,
      normalizedEmail,
      normalizedSuggestedDisplayName,
      normalizedSuggestedAvatarUrl,
      nowIso,
      existingUser.id
    );
    return db.prepare("SELECT * FROM users WHERE id = ?").get(existingUser.id);
  }

  const userId = `user-${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO users (
      id, name, type, role, score, status, auth_provider, auth_subject, email, avatar_url,
      profile_pending, profile_suggested_name, profile_suggested_avatar_url, created_at, updated_at
    ) VALUES (?, 'Usuario', 'registered', ?, 0, 'active', ?, ?, ?, NULL, 1, ?, ?, ?, ?)
  `).run(
    userId,
    resolvedRole,
    normalizedProvider,
    normalizedSubject,
    normalizedEmail,
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
    avatarPendingUrl: row.avatar_pending_url,
    avatarReviewStatus: row.avatar_review_status || "pending",
    updatedAt: row.updated_at
  }));

  return {
    items,
    pagination: createPaginationMeta(total, pagination)
  };
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
    items,
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
  }

  return {
    dbPath: resolvedDbPath,
    avatarStorageDir,
    close() {
      db.close();
    },
    cleanupInactiveGuests({ nowMs = Date.now() } = {}) {
      return withTransaction(db, () => pruneGuestSessions(db, "", nowMs, ""));
    },
    registerWithPassword({ sessionId, selectedTopicId = null, ipAddress = "", email, password, nickname } = {}) {
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
        const context = createRegisteredSession(db, normalizedSessionId, ipAddress, nowIso, existingSessionRow, viewerRow.id);
        return buildFrontendPayload(db, context, selectedTopicId);
      });
    },
    loginWithPassword({ sessionId, selectedTopicId = null, ipAddress = "", email, password } = {}) {
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
        const context = createRegisteredSession(db, normalizedSessionId, ipAddress, nowIso, existingSessionRow, viewerRow.id);
        return buildFrontendPayload(db, context, selectedTopicId);
      });
    },    login({ sessionId, selectedTopicId = null, ipAddress = "", userId = REGISTERED_USER_ID } = {}) {
      return withTransaction(db, () => {
        const normalizedSessionId = ensureViewerSessionId(sessionId);
        const nowIso = new Date().toISOString();
        const existingSessionRow = readSessionRow(db, normalizedSessionId);
        assertContextNotBlocked(db, {
          sessionId: normalizedSessionId,
          sessionRow: existingSessionRow,
          ipAddress: normalizeIpAddress(ipAddress || existingSessionRow?.last_ip || "")
        });
        const context = createRegisteredSession(db, normalizedSessionId, ipAddress, nowIso, existingSessionRow, userId);
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
          displayName,
          avatarUrl,
          nowIso
        });
        const existingSessionRow = readSessionRow(db, normalizedSessionId);
        const context = createRegisteredSession(db, normalizedSessionId, ipAddress, nowIso, existingSessionRow, viewerRow.id);
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
    updateProfile({ sessionId, authMode, displayName = null, avatarDataUrl = null, removeAvatar = false, selectedTopicId = null, ipAddress = "" } = {}) {
      return withTransaction(db, (afterCommit) => {
        const context = resolveViewer(db, { sessionId, authMode, ipAddress });
        assertViewerCanParticipate(context.viewerRow);
        assertContextNotBlocked(db, context);
        if (context.viewer.type !== "registered") {
          throw new ApiError(403, "LOGIN_REQUIRED", "Hace falta iniciar sesion para editar el perfil.");
        }

        const normalizedDisplayName = normalizeUserDisplayName(displayName, context.viewer.displayName || "Usuario");
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

        db.prepare(`
          UPDATE users
          SET name = ?, avatar_url = ?, avatar_pending_url = ?, avatar_review_status = ?, profile_pending = 0,
              profile_suggested_name = NULL, profile_suggested_avatar_url = NULL, updated_at = ?
          WHERE id = ?
        `).run(normalizedDisplayName, nextAvatarUrl, nextPendingUrl, nextReviewStatus, nowIso, context.viewer.id);

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
    bootstrap({ sessionId, authMode, selectedTopicId = null, ipAddress = "" } = {}) {
      return withTransaction(db, () => {
        const context = resolveViewer(db, { sessionId, authMode, ipAddress });
        return buildFrontendPayload(db, context, selectedTopicId);
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
        const context = resolveViewer(db, { sessionId, authMode, ipAddress, persistGuest: true });
        assertContextCanParticipate(db, context);
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
        const context = resolveViewer(db, { sessionId, authMode, ipAddress, persistGuest: true });
        assertContextCanParticipate(db, context);
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
    reportEntity(entityType, entityId, { sessionId, authMode, reason = "", selectedTopicId = null, ipAddress = "" } = {}) {
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

          db.prepare(`
            UPDATE users
            SET status = ?, updated_at = ?
            WHERE id = ?
          `).run(USER_STATUS_EXPELLED, nowIso, normalizedUserId);
          resolveReportsForEntity(db, "user", normalizedUserId, nowIso);
          recordModerationAction(db, {
            actionType: normalizedActionType,
            targetType: "user",
            targetId: normalizedUserId,
            actorUserId: context.viewer.id,
            reason: normalizedReason,
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
