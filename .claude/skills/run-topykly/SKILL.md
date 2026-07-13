---
name: run-topykly
description: Launch and verify the TOPYKLY app (this repo) locally — starting local-server.cjs/dev-server.cjs, resetting the SQLite dev database, and logging in as a regular user or as admin to exercise chat, rankings, notifications, friends, and the moderation panel. Use this whenever asked to run/start/preview the app, reproduce a bug interactively, or verify a change end-to-end in the browser instead of only running tests.
---

# Run TOPYKLY locally

TOPYKLY has no build step and no required env vars for basic local development — it boots with real auth/backend behavior out of the box because external providers (Google OIDC, Turnstile, Resend) silently no-op when unconfigured.

## Start the server

```
node local-server.cjs
```

Serves at `http://127.0.0.1:4173`. Use `node dev-server.cjs` instead if you need two independent instances at once (`4173` and `4174`) — e.g. to compare before/after a change side by side.

Run it with `run_in_background: true` (or `-Background`) since it's a long-lived server; stop it when done rather than leaving it running across unrelated tasks.

## Database

First run auto-creates a SQLite file at `.data/topykly.sqlite` (via `services/backend-store.js`, `TOPYKLY_DB_PATH` not required locally). To start from a clean slate (e.g. to retest onboarding/registration), stop the server and delete that file — it will reseed demo topics/users from `data.js` on next boot.

## Logging in

- **Quick "logged in as a demo user" path**: click the auth button in the topbar and use the plain login action with no provider configured — the backend falls back to a fixed seeded registered user (`u1`, "Coco Mora") via `store.login()`. No env vars needed. Good for chat/ranking/notifications/friends flows that don't depend on a specific identity.
- **Real registered account (own email/password)**: use the auth modal's email+password register form. Works locally with no env vars — Turnstile and Resend are both no-ops when their keys are unset, so this path is fully usable offline.
- **Testing as admin**: before starting the server, set `TOPYKLY_ADMIN_EMAILS=you@example.com` (env var, or in a local `.env` loaded by however you run Node). Then register/login with that exact email via the password flow above — `isAdminEmail()` auto-promotes it to `ADMIN_ROLE` on login, independent of any stored role. The admin icon then appears in the topbar; opening it calls `/api/admin/dashboard` (gated server-side by `assertModerator`).
- Google OIDC and email-code login require real credentials (`TOPYKLY_OIDC_CLIENT_ID/SECRET`, `TOPYKLY_RESEND_API_KEY`) — skip these locally unless the task specifically concerns that flow.

## Verifying moderation/admin actions

To see the admin panel populated, first generate real state to review: report a message/user/topic from the UI (or via `POST /api/reports`), or trigger an avatar upload pending review. Then, as an admin user, open the admin panel (`ui/admin-panel.js`) — `delete_message` and `expel_user` require a second confirming click within `ADMIN_CONFIRM_WINDOW_MS`, so a single click is expected to just arm the confirmation, not execute the action.

## After making changes

Run the test suite before calling a change done:

```
node tests/run.mjs
npm run qa   # run.mjs + smoke.mjs, same as CI (.github/workflows/qa.yml)
```

If the change is UI-visible, drive it in a real browser against the running server rather than relying on tests alone — this repo already accumulates verification screenshots under `output/playwright/`; follow that existing convention (descriptive filename per feature/state) if you capture new ones.

## Stopping

Kill the background server process when the task is done — don't leave stray Node processes bound to 4173/4174 across unrelated work.
