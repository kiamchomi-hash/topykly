# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

TOPYKLY (formerly "chetrend" — the name still appears in legacy env vars, cookies, and file names) is a vanilla-JS, no-build-framework social app: topic-based chat/threads with per-message likes/dislikes, a ranking/leaderboard system, notifications, and a friends system. There is a real Node backend behind it — this is not a frontend-only demo.

## Commands

- `node local-server.cjs` — start the local preview/dev server at `http://127.0.0.1:4173` (this is also the real app server; there's no separate build step, files are served directly from source).
- `node dev-server.cjs` — same server started twice, on `4173` and `4174`, for side-by-side comparison.
- `node tests/run.mjs` — main test suite (plain Node `assert`, no framework). Run after any change touching rendering, ranking, state transitions, or auth/admin logic.
- `node tests/smoke.mjs` — smoke test.
- `npm run qa` — runs both `tests/run.mjs` and `tests/smoke.mjs`; this is what CI (`.github/workflows/qa.yml`) runs on every push/PR.
- `npm run format` / `npm run format:check` — Prettier.
- `npm run hooks:install` — points git at `.githooks`.
- `npm run backup:sqlite` — runs `scripts/backup-sqlite.mjs`.

There's no per-test filtering flag; `tests/run.mjs` is a single script of named assertion blocks — to iterate on one behavior, temporarily comment out unrelated blocks or grep the file for the relevant `console.log`/description string.

## Architecture

### Boot and data flow

`app.js` → `controller.js` (thin re-export) → `controller-app.js`'s `bootstrap()`, which wires DOM caching, action handlers, renderers, and event binding, hydrates initial state from the backend, and starts a **1s live-polling loop** (`createLiveTopicSync`) that calls `api.refreshTopics()` and merges results into state. There is no websocket — "live" updates are polling-based.

Flow for any user action: **UI event → action in `controller-actions.js` / `controller-chat-actions.js` / `controller-ranking-actions.js` → `services/api.js` (real HTTP call) → backend response → `dispatch(state, reducers.hydrateFromBackend, payload)` → `render()`**.

- **State**: `state-store.js` holds one mutable `state` object (viewer, topics, users, rankings, notifications, UI flags). `store-logic.js` defines pure reducers `(state, payload) => nextState`; `dispatch()` `Object.assign`s the result back onto the shared object.
- **Rendering**: `controller-render.js` composes a single `render()` from per-section functions in `ui/*.js`. `ui/render-utils.js` provides DOM diffing/reconciliation (`renderIntoTargets`/`reconcile`/`patchNode`) instead of `innerHTML` clears, used by every list renderer (topics, messages, users, rankings, notifications).
- **Low-level DOM builders** shared across `ui/` renderers live in `components.js` (`createTopicItem`, `createMessageItem`, `createUserItem`, `createRankingItem`, skeletons, empty states). `ui/dom.js` holds `REQUIRED_DOM_KEYS`, the registry mapping every relevant `index.html` element ID.

Note: a parallel `features/` directory (chat, rankings, topics, users, titles, palette, navigation, shared) exists implementing a Redux/Flux-style selectors+state+render pattern. It is **not** the active path wired from `app.js`/`controller-app.js` — treat it as an alternate/in-progress architecture, not the one to extend by default. `GEMINI.md` documents `features/` as if it were the primary architecture and describes `services/api.js` as "simulating" data loading — this is stale/aspirational; the real backend (below) is live and `api.js` makes real HTTP calls to it.

### Backend

`services/backend-store.js` (~3300 lines) is the actual backend: SQLite via `node:sqlite` (`DatabaseSync`), with tables for `users`, `sessions`, `topics`, `messages`, `message_likes/dislikes`, `reports`, `friend_requests`, `moderation_actions`, `blocked_sessions/ips`, `auth_email_challenges`, `guest_ip_rate_limits`, `app_metadata`. It can seed demo topics/users from `data.js`.

`services/preview-server.js` is a plain `node:http` server (no framework) that routes `/api/*` to `backend-store.js`, serves static files, handles avatar uploads under `/avatars/*`, enforces per-IP rate limiting, sets CSP/security headers, and runs periodic guest-session cleanup + a daily like/dislike reset job. This is both the local dev server and the production server (`local-server.cjs`/`dev-server.cjs` start it).

Key REST endpoints (`/api/...`): `bootstrap`, `topics`, `topics/:id`, `topics/:id/messages`, `messages/:id/like|dislike`, `reports`, `friends/:id/request|accept|reject`, `profile` (PATCH), `auth/status|login|logout|password/login|password/register|email/request-code|email/verify-code`, `admin/dashboard`, `moderation/reports|actions`, `diagnostics`, plus `/auth/oidc/callback`.

### Auth

Cookie-based sessions (`topykly_sid`, HttpOnly, 30-day TTL), three mechanisms:
1. **Guest**: anonymous `*topyNN` identities, auto-created, more rate-limited than registered users.
2. **Google OIDC**: PKCE flow via `services/auth-service.js`, signed HMAC flow cookie (`topykly_auth_flow`), backend exchange in `/auth/oidc/callback`.
3. **Email + password**: `loginWithPassword` (email/password, no code) and registration via `requestEmailAuthCode`/`verifyEmailAuthCode` — the register form collects nickname/email/age/password/terms, `requestEmailAuthCode` stores a scrypt-hashed password on the pending challenge (10-min TTL, SHA-256 hashed codes, delivered via Resend, 5-attempt max) and only creates the account once `verifyEmailAuthCode` confirms the code; the email code is a one-time registration confirmation, not a login mechanism. `registerWithPassword` (direct, no email confirmation) still exists on the backend/API for lower-level use but isn't called by the auth modal. Cloudflare Turnstile gates login/register-request when configured.

All auth actions end by dispatching `reducers.hydrateFromBackend` and re-rendering.

### Admin / moderation

Role resolution is server-side in `backend-store.js`: `TOPYKLY_ADMIN_EMAILS` (comma-separated env var; legacy alias `CHETREND_ADMIN_EMAILS`) auto-promotes matching registered emails to `ADMIN_ROLE = "Admin"` regardless of stored role; there's also `MODERATOR_ROLE = "Moderacion"`. Every admin/moderation endpoint is gated by `assertModerator(viewerRow)` (throws `403 MODERATOR_REQUIRED`). Actions — `block_topic`, `pin_topic`, `delete_message`, `expel_user`, `approve_avatar`/`reject_avatar`, `block_session` — are all recorded via `recordModerationAction` for audit.

Frontend: `ui/admin-panel.js` renders pending-avatar review and open-report queues. `controller-actions.js` (`openAdminPanel`/`applyAdminAction`) requires a second confirming click within a time window (`ADMIN_CONFIRM_WINDOW_MS`) for destructive actions (`delete_message`, `expel_user`) — see `DESTRUCTIVE_ADMIN_ACTIONS`.

### Page sections (index.html) and their files

- **Topbar** — profile/palette/theme controls on the left; on the right, three icon **buttons that open their own panel/modal** (admin, friend requests, notifications) plus the auth button and the mobile drawer toggle. Wired by `ui/topbar.js` aggregating `ui/topbar-action-events.js` (auth modal, profile modal, avatar crop, palette), `ui/topbar-ranking-events.js`, `ui/topbar-drawer-events.js`.
- **Workspace — 3 side-by-side panels** (`panel--topics`, `panel--chat`, `panel--users-rankings` in `index.html`):
  1. **Topics panel** — the list of topics/threads plus "create topic" button. Rendered by `ui/topics.js` / `ui/topic-renderers.js`.
  2. **Chat panel** — header, active topic title, message stream, composer form. Rendered by `ui/chat.js`.
  3. **Users + rankings panel** — two stacked sub-sections in the same panel: a **connected users list** (`ui/users.js`) and a **rankings carousel** with scope tabs (global/topic) and mode list (`ui/rankings.js`, backed by `ui/ranking-data.js`, `ui/ranking-labels.js`, `ui/ranking-icons.js`, `ui/ranking-panel-state.js`).
- **Button-triggered panels/modals** (opened from the topbar icons, not part of the 3-panel workspace):
  - **Notifications** — toast list + panel, `ui/notifications.js`.
  - **Friend requests** — incoming/outgoing popover panel, `ui/friend-requests.js`.
  - **Admin** — moderation panel (pending avatars, open reports), `ui/admin-panel.js`.
  - Other modals opened from elsewhere in the topbar: palette (`ui/palette-modal.js`, `ui/palette-picker-events.js`), report (`ui/report-modal.js`, `report-reasons.js`), auth (email/Google/Turnstile forms), own profile (`ui/profile-modal.js`), public profile (`ui/public-profile-modal.js`).
- **Drawers (mobile)** — collapse the topics panel and the users/rankings panel into slide-out drawers; `ui/drawers.js` handles open/close + focus management.
- Shared helpers: `ui/icons.js` (SVG factory), `ui/date-utils.js`, `ui/transition-utils.js`, `ui/events.js` (focus-trap/delegation).

`styles.css` (~9400 lines) has no section banners — find rules by class prefix matching the area above (`.topbar*`, `.panel*`, `.ranking-*`, `.message*`, `.drawer*`, `.admin-modal*`/`.admin-panel*`, etc.).

### Key user flows

- **Chat**: `submitMessage()` in `controller-chat-actions.js` calls `api.createTopic`/`api.submitMessage`; enforces `TOPIC_REPLY_LIMIT = 29` and rate limits (stricter for guests); `toggleMessageLike`/`toggleMessageDislike` update optimistically and roll back on error; likes/dislikes reset daily (America/New_York TZ).
- **Ranking**: `rankingScope` toggles `"global"`/`"topic"`; pagination state tracked per scope in `ranking-state.js`.
- **Notifications**: kinds `post-like`, `comment-like`, `post-comment`, `quote`; diffed from backend payloads in `controller-app.js`; optional browser Notification API integration.
- **Friends**: `sendFriendRequest`/`acceptFriendRequest`/`rejectFriendRequest` re-hydrate `friendships: {incoming, outgoing, friends}`.

## Coding conventions (from AGENTS.md)

- ES modules, 2-space indent, semicolons, double quotes.
- Naming: `controller-*.js` for orchestration, `ui/*.js` for presentation/DOM, `*-store.js` for shared state holders.
- Prefer small, focused modules; avoid new abstraction layers or new tooling unless necessary — extend existing root modules and `ui/` helpers.
- When changing behavior, extend `tests/run.mjs` accordingly.
- Commits: short, imperative, often in Spanish, one logical change per commit (e.g. `Separar render de topics`). Keep PRs narrow; include screenshots for UI changes and note affected views/validation commands for layout/mobile changes.

## Environment

Config is documented in `.env.example`: `TOPYKLY_SESSION_SECRET`; Google OIDC (`TOPYKLY_AUTH_PROVIDER_NAME`, `TOPYKLY_OIDC_ISSUER/CLIENT_ID/CLIENT_SECRET/SCOPE`); Cloudflare Turnstile (`TOPYKLY_TURNSTILE_SITE_KEY/SECRET_KEY`); Resend email (`TOPYKLY_RESEND_API_KEY`, `TOPYKLY_RESEND_FROM`); `TOPYKLY_ADMIN_EMAILS` (admin allowlist); `TOPYKLY_DB_PATH` (persistent SQLite path); `TOPYKLY_TRUST_PROXY`; `TOPYKLY_ALLOW_LOCAL_LOGIN` (must stay off in production); `TOPYKLY_PUBLIC_ORIGIN`; `TOPYKLY_COOKIE_SECURE`.
