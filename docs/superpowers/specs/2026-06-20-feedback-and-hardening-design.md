# Feedback Capture + Abuse Hardening — Design

**Date:** 2026-06-20
**Status:** Approved (design); pending spec review
**Branch:** `feat-feedback`

## Goal

The app is public at https://russian-app.ruslearn.workers.dev. We want a first
round of real-user feedback covering four things: (1) is it useful, (2) what's
broken/confusing, (3) does the learning method work, (4) what's missing. To do
that without users leaving the app, add an in-app feedback widget. Because the
app is now a public write surface, harden the API against spam and abuse at the
same time.

## Non-goals (YAGNI)

- No analytics/retention dashboard (a feedback box, not a metrics product).
- No admin UI for reading feedback — D1 query + GitHub Issues are enough.
- No feedback threading/replies. One-way submission.
- No login requirement to submit.
- Distribution/outreach is advice, not code (see Appendix).

## Components

### 1. Feedback widget (frontend — `site/`)

A small **"💬 Feedback"** trigger on the home screen. Tapping opens a lightweight
panel (same Midnight styling as the rest):

- **Textarea** — placeholder "What's working? What's confusing? What's missing?"
- **Optional mood** — one tap: 🙂 / 😐 / 🙁 (stored as `good`/`ok`/`bad`, nullable)
- **Optional contact** — email field, so the user can opt in to follow-up
- **Turnstile** — Cloudflare's invisible bot check (renders into the panel)
- **Submit** + a Cancel/close

On submit the frontend collects a **context** object automatically:
`{ mode: <current view>, version: <app/cache version>, ua: navigator.userAgent }`
— so "what's broken" reports are debuggable. It then POSTs to `/api/feedback`.

Success → a toast ("Thanks! 🙏") and the panel closes. Failure → a toast asking
to try again. The widget never blocks the rest of the app.

### 2. Endpoint — `POST /api/feedback` (`worker/`)

Order of operations:

1. **Rate-limit** by client IP (`CF-Connecting-IP`). Strict bucket for feedback
   (e.g. 5 requests / minute / IP) → `429` when exceeded.
2. **Verify Turnstile** token via Cloudflare siteverify
   (`https://challenges.cloudflare.com/turnstile/v0/siteverify`) with the
   `TURNSTILE_SECRET`. Invalid/missing → `400`.
3. **Validate** payload: `text` required, trimmed, length 1–2000; `mood` in
   the allowed set or null; `contact` optional, length-capped, light email
   shape check; `context` object, size-capped.
4. **Persist to D1** — insert a row into `feedback`. This is the durable record.
5. **Best-effort GitHub Issue** — `POST` to
   `https://api.github.com/repos/symonitz/russian_app/issues` with
   `GITHUB_TOKEN`, title = first ~60 chars of text, body = full text + context
   + mood + timestamp, label `user-feedback`. On any failure: log it, store
   nothing extra, and still return success (D1 already has the row). On success:
   write the issue number back onto the D1 row.
6. Return `{ ok: true }`.

The endpoint is **unauthenticated** (anyone can submit) but attaches `user_id`
if a valid session cookie is present.

### 3. Abuse hardening (cross-cutting)

- **Rate limiting on `/api/*`** — strict on `/api/feedback`, looser default on
  the other routes (`/api/auth/google`, `/api/progress`). Implemented with a
  Cloudflare Workers rate-limit binding if available; otherwise a small
  KV/D1-backed counter keyed by IP+route. (Exact mechanism finalized in the
  plan.)
- **Turnstile** — the primary defense against automated feedback spam reaching
  GitHub Issues.
- **Length caps** — feedback text ≤ 2000 chars and context object size-capped,
  in addition to the existing global 256 KB body cap.
- **Already covered, no work:** Cloudflare edge DDoS absorption (automatic,
  free) and the free-plan ~100k req/day ceiling that throttles (429s) rather
  than billing. Reconfirm the account has no paid auto-scaling enabled.

### 4. Data model

New migration `migrations/0002_feedback.sql`:

```sql
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  mood TEXT,                 -- 'good' | 'ok' | 'bad' | NULL
  contact TEXT,              -- optional email
  context TEXT,              -- JSON: mode, version, ua
  user_id INTEGER,           -- nullable; set if signed in
  github_issue INTEGER,      -- nullable; issue number once created
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id)
);
```

### 5. Secrets / prerequisites (user creates, we wire in)

- **`GITHUB_TOKEN`** — a GitHub fine-grained PAT scoped to **only** the
  `russian_app` repo with **Issues: read & write**. Set via
  `wrangler secret put GITHUB_TOKEN`. (Fine-grained + single-repo + issues-only
  = minimal blast radius if ever leaked.)
- **Turnstile keys** — create a Turnstile widget in the Cloudflare dashboard for
  the `russian-app.ruslearn.workers.dev` domain. Site key → frontend (public,
  committed). Secret key → `wrangler secret put TURNSTILE_SECRET`.

Both follow the same placeholder→wire-in pattern used for `GOOGLE_CLIENT_ID`.

## Error handling

- D1 insert failure → `500`, generic message to client, real error logged
  (consistent with existing hardening).
- GitHub failure → swallowed (logged), submission still succeeds.
- Turnstile failure / rate-limit → explicit `400` / `429` so the frontend can
  show the right toast.
- All client-facing errors stay generic (no internal detail leakage).

## Testing strategy

Unit tests (Node `node --test`, matching the existing `tests/worker/` setup):

- **Validation:** rejects empty/oversized text; clamps/cleans contact; coerces
  bad mood to null. (Extract a pure `validateFeedback(payload)` helper.)
- **Rate limiter:** pure helper — allows under the limit, blocks over it.
- **GitHub issue body builder:** pure function that formats title/body/labels
  from a feedback row — assert structure without hitting the network.
- Turnstile verification and the GitHub/D1 network calls are mocked/injected so
  tests stay offline.

Manual: submit from the live site, confirm a D1 row + a GitHub Issue appear,
confirm a bot-shaped request (bad Turnstile token) is rejected.

## Appendix: Distribution plan (advice, not built)

Target **English-speaking beginner Russian learners** (the app teaches in
English). Suggested first channels, each with the feedback type it surfaces:

- **Reddit r/russian** (learners; check self-promo rules) — usefulness, method,
  what's missing.
- **r/languagelearning** — usefulness, comparisons to Anki/Duolingo.
- **Language-learning Discords / Telegram groups** — quick reactions, bugs.
- **Show HN (Hacker News)** — usefulness, what's missing, bugs (tech crowd; won't
  judge the teaching method).
- **Friends / a Russian tutor** — native/teaching perspective on the method.

Ship the widget first so every visitor has a one-tap way to respond, then post a
short pitch + link + explicit ask ("try 5 minutes, tap Feedback, tell me what
confused you").
