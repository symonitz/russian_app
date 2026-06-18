# Phase 1 — Accounts + Cloud Sync — Design Spec

**Date:** 2026-06-15
**Status:** Draft for review
**Context:** Turn the per-device PWA into an account-backed product: sign in with Google → progress saved to the cloud, synced across devices, and surviving a browser wipe. All on Cloudflare's free tier.

---

## 1. Goal

A learner taps **"Sign in with Google"**, and from then on their progress (known words, due schedule, alphabet, counter) is stored server-side and follows them to any device. Signing in is **optional** — the app still works locally without it (as today) — but signing in makes progress durable and portable.

## 2. Non-goals (for this phase)

- No payments (free for now).
- No passwords / email-magic-link (Google sign-in only in v1; other methods later).
- No social features, leaderboards, friends.
- Don't break offline use — `localStorage` stays the local cache; sync layers on top.

## 3. Architecture

The app is currently a **static-assets-only Cloudflare Worker**. This phase upgrades it to a **Worker with a script** (`main`) that:

- Serves the static assets (unchanged), **and**
- Exposes a small API:
  - `POST /api/auth/google` — verify a Google ID token, create/lookup the user, issue a session.
  - `POST /api/auth/signout` — clear the session.
  - `GET /api/progress` — return the signed-in user's progress.
  - `PUT /api/progress` — overwrite the signed-in user's progress.

**Storage:** **Cloudflare D1** (their managed SQLite), bound to the Worker. Free tier is ample for this.

**Auth:** **Google Identity Services (GIS)** renders the sign-in button in the browser and returns a Google **ID token (JWT)**. The Worker verifies it against Google's public keys and issues its **own session cookie** (HttpOnly).

```
Browser (PWA)                      Worker (russian-app)              D1
  "Sign in with Google"
        │ GIS popup → ID token (JWT)
        ├──── POST /api/auth/google ────▶ verify JWT (Google JWKS,
        │                                  aud, exp) → upsert user ──▶ user
        ◀──── Set-Cookie: session ───────  issue session
        │
   progress changes (debounced)
        ├──── PUT /api/progress ────────▶ auth via cookie ─────────▶ progress
        │ on load / new device
        ├──── GET /api/progress ────────▶ ─────────────────────────  progress
        ◀──── merge with local, save ────
```

## 4. Auth flow (detail)

1. User taps the GIS **Sign in with Google** button → Google returns an **ID token** to the page.
2. Page `POST`s the token to `/api/auth/google`.
3. Worker fetches Google's **JWKS**, verifies the token's **signature**, **`aud`** (our OAuth client ID), and **`exp`**; extracts `sub` (stable Google user id) + `email`.
4. Worker **upserts** the user (keyed by `google_sub`) and issues a **session** — a signed token in an **HttpOnly, Secure, SameSite=Lax** cookie (so no session table needed; the cookie is a short signed JWT containing `user_id` + expiry).
5. `/api/progress` requests authenticate by validating that cookie.

## 5. Data model (D1)

- **user**: `id` (pk), `google_sub` (unique), `email`, `created_at`
- **progress**: `user_id` (pk → user.id), `data` (TEXT — the JSON blob `{vocab, letters, counter}`, same shape as localStorage today), `updated_at`

No session table (signed-cookie sessions). Schema is tiny and migrates cleanly.

## 6. Sync strategy

The hard part is not clobbering progress across devices. Rules:

- **On sign-in / app load (if signed in):** `GET /api/progress`.
  - **Server empty** → push local up (`PUT`).
  - **Server has data** → **item-level merge** with local, then save merged both locally and to server:
    - `counter` = max(local, server)
    - per word/letter: keep the **more-advanced** card (higher `reps`; if tied, later `due`); `known` beats `learning` beats absent.
  - This makes first-time linking (local progress → account) safe, and reconciles two devices sensibly.
- **On change while signed in:** debounced (~3s) `PUT` of the full blob.
- **Offline:** changes save locally; pushed on next load/online.
- v1 accepts that two devices editing *simultaneously* could lose a little (blob-level PUT between merges) — rare for a single learner; revisit if needed.

## 7. What you set up once (free, no credit card)

- **Google OAuth Client ID** — Google Cloud Console → APIs & Services → Credentials → *Create OAuth client ID* → **Web application** → add your site origin(s) as authorized JavaScript origins. (I'll give exact steps.)
- **Cloudflare D1 database** — created via `wrangler d1 create russian-app` (or the dashboard); I add the binding to `wrangler.jsonc`. D1 free tier needs no card.

## 8. Security & privacy

- Session cookie: **HttpOnly, Secure, SameSite=Lax**; signed; ~30-day expiry.
- Verify the Google token fully (signature + `aud` + `exp` + issuer).
- We store only **email** + **learning progress** — add a one-line privacy note in the UI.
- Secrets (cookie-signing key) stored as a Worker secret, never in the repo.

## 9. Milestones

- **M1** — Worker backend skeleton: `main` script serving assets + `/api/health`; D1 schema + `wrangler.jsonc` bindings; deploy still green.
- **M2** — Google sign-in: GIS button in the UI; `/api/auth/google` (verify + upsert + session cookie); `/api/auth/signout`; UI shows signed-in state.
- **M3** — Progress sync: `/api/progress` GET/PUT; frontend load+merge on sign-in; debounced save on change.
- **M4** — Polish: sign-out, "synced ✓" indicator, error/offline handling, privacy note.

## 10. Testing

- **Unit:** Google-token verification (mock JWKS), the merge function (local vs server → expected merged), session cookie sign/verify.
- **Integration:** sign-in → PUT progress → GET from a fresh "session" → matches; merge scenario (local-ahead vs server-ahead).
- Frontend smoke in a headless browser (sign-in stubbed).

## 11. Risks / notes

- **Architectural shift:** the app is no longer pure-static — it gains a backend (still 100% Cloudflare free tier).
- **Merge logic** is the riskiest piece; it gets dedicated unit tests.
- **Licensing:** the seed frequency data is non-commercial — fine while the product is free; **must be revisited before charging money**.
- Google sign-in requires the one-time OAuth client setup (yours); everything else is in-repo.
