# Accounts + Cloud Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a learner sign in with Google so their progress is stored in the cloud and syncs across devices, while the app still works locally without signing in.

**Architecture:** Upgrade the existing static-assets Cloudflare Worker to a Worker *script* that serves the assets (via the `ASSETS` binding) and exposes a tiny JSON API backed by **Cloudflare D1** (SQLite). Auth uses **Google Identity Services** client-side → the Worker verifies the Google ID token (`jose`) and issues a signed **HttpOnly session cookie**. Progress is a JSON blob per user; the **frontend** does an item-level merge on sign-in and debounced saves on change (the server is dumb storage).

**Tech Stack:** Cloudflare Workers + D1, `jose` (JWT), Google Identity Services, vanilla JS frontend, `node --test` for pure-logic unit tests, `wrangler dev` + curl for route verification.

**Design spec:** [docs/superpowers/specs/2026-06-15-accounts-sync-design.md](../specs/2026-06-15-accounts-sync-design.md)

---

## File Structure

```
russian-learn/
├── package.json                 # NEW — worker deps (jose) + scripts
├── wrangler.jsonc               # MODIFY — add main, ASSETS binding, D1, GOOGLE_CLIENT_ID
├── migrations/
│   └── 0001_init.sql            # NEW — D1 schema (user, progress)
├── worker/
│   ├── index.js                 # NEW — fetch router: /api/* else static assets
│   ├── auth.js                  # NEW — Google token verify, session sign/verify, requireUser
│   └── db.js                    # NEW — D1 helpers (upsertUser, getProgress, putProgress)
├── site/
│   ├── index.html               # MODIFY — load GIS script + sign-in container
│   ├── app.js                   # MODIFY — sign-in UI, mergeProgress, sync (load+save)
│   └── style.css                # MODIFY — sign-in/account UI styles
└── tests/worker/
    ├── session.test.mjs         # NEW — session sign/verify round-trip
    └── merge.test.mjs           # NEW — progress merge logic
```

**Boundaries:** `worker/auth.js` is the only file touching JWTs/cookies. `worker/db.js` is the only file touching D1 SQL. `worker/index.js` is pure routing. The merge logic lives in the **frontend** (`site/app.js`) since merge happens on load; the server only stores/returns the blob.

---

## Task 1: Worker toolchain + bindings + one-time cloud setup

**Files:**
- Create: `package.json`
- Modify: `wrangler.jsonc`
- Create: `migrations/0001_init.sql`
- Create: `worker/index.js` (minimal, just `/api/health` + assets passthrough)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "russian-app",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/worker/",
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "db:local": "wrangler d1 execute russian-app --local --file=migrations/0001_init.sql",
    "db:remote": "wrangler d1 execute russian-app --remote --file=migrations/0001_init.sql"
  },
  "dependencies": { "jose": "^5.9.0" },
  "devDependencies": { "wrangler": "^3.80.0" }
}
```

- [ ] **Step 2: Create `migrations/0001_init.sql`**

```sql
CREATE TABLE IF NOT EXISTS user (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub TEXT UNIQUE NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS progress (
  user_id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id)
);
```

- [ ] **Step 3: Install deps**

Run:
```bash
cd /Users/orsymonitz/PycharmProjects/russian-learn
npm install
```
Expected: creates `node_modules/` + `package-lock.json`, installs `jose` and `wrangler`.

- [ ] **Step 4: USER ACTION — create the D1 database**

Run (requires the user's Cloudflare login; no credit card needed for D1 free tier):
```bash
npx wrangler d1 create russian-app
```
Expected output includes a `database_id`. Copy it for Step 6. If `wrangler` reports you're not logged in, run `npx wrangler login` first (opens a browser).

- [ ] **Step 5: USER ACTION — create a Google OAuth Client ID**

In [console.cloud.google.com](https://console.cloud.google.com): create/select a project → **APIs & Services → Credentials → Create Credentials → OAuth client ID** → Application type **Web application**. Under **Authorized JavaScript origins** add your site origin (e.g. `https://russian-app.<account>.workers.dev` and `http://localhost:8787` for local dev). Copy the **Client ID** (`...apps.googleusercontent.com`) for Step 6.

- [ ] **Step 6: Modify `wrangler.jsonc`** — add `main`, the `ASSETS` binding, D1, and the client id (replace the two `<...>` placeholders with the real values from Steps 4–5)

```jsonc
{
  "name": "russian-app",
  "compatibility_date": "2024-11-01",
  "main": "worker/index.js",
  "assets": { "directory": "./site", "binding": "ASSETS" },
  "d1_databases": [
    { "binding": "DB", "database_name": "russian-app", "database_id": "<DATABASE_ID_FROM_STEP_4>" }
  ],
  "vars": { "GOOGLE_CLIENT_ID": "<CLIENT_ID_FROM_STEP_5>.apps.googleusercontent.com" }
}
```

- [ ] **Step 7: USER ACTION — set the session-signing secret**

Run (enter any long random string when prompted):
```bash
npx wrangler secret put SESSION_SECRET
```
For local dev, also create `.dev.vars` (gitignored) with `SESSION_SECRET=<same-or-any-dev-string>`.

- [ ] **Step 8: Create minimal `worker/index.js`**

```javascript
function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/health") return json({ ok: true });
    return env.ASSETS.fetch(request); // static site
  },
};

export { json };
```

- [ ] **Step 9: Append to `.gitignore`**

```
node_modules/
.dev.vars
.wrangler/
```

- [ ] **Step 10: Apply schema locally + run the dev server**

Run:
```bash
npm run db:local
npx wrangler dev
```
In another shell: `curl -s http://localhost:8787/api/health` → expect `{"ok":true}`. And `curl -s http://localhost:8787/` → returns the app's HTML (assets still served). Stop with Ctrl+C.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json wrangler.jsonc migrations/ worker/index.js .gitignore
git commit -m "feat: worker backend skeleton + D1 bindings (assets still served)"
```

---

## Task 2: D1 access helpers (`worker/db.js`)

**Files:**
- Create: `worker/db.js`

> D1 only exists in the Workers runtime, so these are verified with `wrangler dev` + curl in later tasks rather than node unit tests. This task just writes the helpers and sanity-checks SQL against local D1.

- [ ] **Step 1: Create `worker/db.js`**

```javascript
// All D1 access lives here. Each function takes the Worker `env`.

export async function upsertUser(env, googleSub, email) {
  await env.DB.prepare(
    `INSERT INTO user (google_sub, email, created_at) VALUES (?, ?, ?)
     ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email`
  )
    .bind(googleSub, email ?? null, new Date().toISOString())
    .run();
  const row = await env.DB.prepare("SELECT id FROM user WHERE google_sub = ?")
    .bind(googleSub)
    .first();
  return { id: row.id };
}

export async function getProgress(env, userId) {
  const row = await env.DB.prepare("SELECT data FROM progress WHERE user_id = ?")
    .bind(userId)
    .first();
  return row ? JSON.parse(row.data) : null;
}

export async function putProgress(env, userId, data) {
  await env.DB.prepare(
    `INSERT INTO progress (user_id, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  )
    .bind(userId, JSON.stringify(data), new Date().toISOString())
    .run();
}
```

- [ ] **Step 2: Sanity-check the SQL against local D1**

Run:
```bash
npx wrangler d1 execute russian-app --local --command \
  "INSERT INTO user (google_sub,email,created_at) VALUES ('test','a@b.c','now'); SELECT * FROM user;"
```
Expected: prints one row with `google_sub=test`. (Confirms the schema + columns match the helpers.)

- [ ] **Step 3: Commit**

```bash
git add worker/db.js
git commit -m "feat: D1 access helpers (user + progress)"
```

---

## Task 3: Session sign/verify (`worker/auth.js`, part 1)

**Files:**
- Create: `worker/auth.js`
- Test: `tests/worker/session.test.mjs`

- [ ] **Step 1: Write the failing test** in `tests/worker/session.test.mjs`

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { signSession, readSession } from "../../worker/auth.js";

const SECRET = "test-secret-please-change";

test("signSession then readSession round-trips the user id", async () => {
  const cookie = await signSession(123, SECRET);
  const req = new Request("https://x/", { headers: { cookie: `session=${cookie}` } });
  const user = await readSession(req, SECRET);
  assert.equal(user.id, 123);
});

test("readSession returns null when no cookie", async () => {
  const req = new Request("https://x/");
  assert.equal(await readSession(req, SECRET), null);
});

test("readSession returns null for a tampered token", async () => {
  const req = new Request("https://x/", { headers: { cookie: "session=not.a.jwt" } });
  assert.equal(await readSession(req, SECRET), null);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/worker/session.test.mjs`
Expected: FAIL — cannot import `signSession`/`readSession` (file doesn't exist).

- [ ] **Step 3: Create `worker/auth.js`** with the session helpers

```javascript
import { SignJWT, jwtVerify } from "jose";

const enc = (secret) => new TextEncoder().encode(secret);
const MAX_AGE = 30 * 24 * 3600; // 30 days

export async function signSession(userId, secret) {
  return new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(enc(secret));
}

export async function readSession(request, secret) {
  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  if (!m) return null;
  try {
    const { payload } = await jwtVerify(m[1], enc(secret));
    return { id: payload.uid };
  } catch {
    return null;
  }
}

export function sessionCookie(token) {
  return `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}`;
}

export function clearCookie() {
  return `session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/worker/session.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/auth.js tests/worker/session.test.mjs
git commit -m "feat: signed-cookie sessions (HS256 via jose)"
```

---

## Task 4: Google sign-in route (`worker/auth.js` part 2 + router)

**Files:**
- Modify: `worker/auth.js`
- Modify: `worker/index.js`

- [ ] **Step 1: Append the Google-auth handler to `worker/auth.js`**

```javascript
import { createRemoteJWKSet } from "jose";
import { upsertUser } from "./db.js";

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs")
);

// Verify a Google ID token (JWT) and return { sub, email }.
export async function verifyGoogleToken(idToken, clientId) {
  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: clientId,
  });
  return { sub: payload.sub, email: payload.email };
}

export async function handleGoogleAuth(request, env) {
  const { credential } = await request.json();
  const { sub, email } = await verifyGoogleToken(credential, env.GOOGLE_CLIENT_ID);
  const user = await upsertUser(env, sub, email);
  const token = await signSession(user.id, env.SESSION_SECRET);
  return new Response(JSON.stringify({ ok: true, email }), {
    headers: { "content-type": "application/json", "set-cookie": sessionCookie(token) },
  });
}
```

- [ ] **Step 2: Wire routes into `worker/index.js`** (replace the file)

```javascript
import { handleGoogleAuth, readSession, clearCookie } from "./auth.js";

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    try {
      if (p === "/api/health") return json({ ok: true });
      if (p === "/api/auth/google" && request.method === "POST")
        return await handleGoogleAuth(request, env);
      if (p === "/api/auth/signout" && request.method === "POST")
        return json({ ok: true }, 200, { "set-cookie": clearCookie() });
      if (p === "/api/me") {
        const user = await readSession(request, env.SESSION_SECRET);
        return json({ signedIn: !!user });
      }
    } catch (e) {
      return json({ error: String(e?.message || e) }, 400);
    }
    return env.ASSETS.fetch(request);
  },
};

export { json };
```

- [ ] **Step 3: Verify `/api/me` unauthenticated**

Run: `npx wrangler dev` then `curl -s http://localhost:8787/api/me`
Expected: `{"signedIn":false}`. (Full Google sign-in is verified on real deploy in Task 9, since it needs a real Google token from the browser.)

- [ ] **Step 4: Commit**

```bash
git add worker/auth.js worker/index.js
git commit -m "feat: /api/auth/google (verify Google token -> session) + /api/me + signout"
```

---

## Task 5: Progress API (`/api/progress` GET/PUT)

**Files:**
- Modify: `worker/index.js`

- [ ] **Step 1: Add the progress routes to `worker/index.js`** — insert before the `return env.ASSETS.fetch(request);` line, inside the `try`

```javascript
      if (p === "/api/progress") {
        const user = await readSession(request, env.SESSION_SECRET);
        if (!user) return json({ error: "unauthorized" }, 401);
        const { getProgress, putProgress } = await import("./db.js");
        if (request.method === "GET") return json({ progress: await getProgress(env, user.id) });
        if (request.method === "PUT") {
          const body = await request.json();
          await putProgress(env, user.id, body);
          return json({ ok: true });
        }
      }
```

- [ ] **Step 2: Verify unauthorized + authorized round-trip with a minted session**

Run `npx wrangler dev`, then in a node REPL mint a test cookie with the same dev secret:
```bash
node -e 'import("jose").then(async({SignJWT})=>{const t=await new SignJWT({uid:1}).setProtectedHeader({alg:"HS256"}).setExpirationTime("1d").sign(new TextEncoder().encode(process.env.SESSION_SECRET||"dev"));console.log(t)})'
```
Then (using that token as `$T`, and ensuring the user row id=1 exists from Task 2's sanity insert or insert one):
```bash
curl -s http://localhost:8787/api/progress                                   # -> {"error":"unauthorized"} (401)
curl -s -X PUT http://localhost:8787/api/progress -H "cookie: session=$T" \
     -H 'content-type: application/json' -d '{"vocab":{"1":{"due":0,"reps":2,"state":"known"}},"letters":{},"counter":5}'
curl -s http://localhost:8787/api/progress -H "cookie: session=$T"           # -> {"progress":{...the blob...}}
```
Expected: unauthorized without cookie; after PUT, GET returns the stored blob. (Use the same `SESSION_SECRET` value in `.dev.vars` as in the node command.)

- [ ] **Step 3: Commit**

```bash
git add worker/index.js
git commit -m "feat: /api/progress GET/PUT (session-gated, D1-backed)"
```

---

## Task 6: Frontend progress-merge logic

**Files:**
- Modify: `site/app.js` (add `mergeProgress` + `pickCard`)
- Test: `tests/worker/merge.test.mjs`

> The merge function is pure and must be importable by the test. Put it near the top of the progress section of `app.js` and also `export` a copy for tests via a tiny shim, OR (chosen here) keep the functions pure and duplicate them in the test file is NOT allowed — instead we define them in a way `node --test` can import. Simplest: define them in `site/app.js` as module-scope functions and add `globalThis.__mergeProgress` hooks is over-engineering. We instead keep `mergeProgress`/`pickCard` as the first lines of a new file `site/sync.js` imported by `app.js`, so the test can import it directly.

- [ ] **Step 1: Write the failing test** in `tests/worker/merge.test.mjs`

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeProgress, pickCard } from "../../site/sync.js";

test("server null -> returns local", () => {
  const local = { vocab: { 1: { reps: 1, due: 0, state: "learning" } }, letters: {}, counter: 3 };
  assert.deepEqual(mergeProgress(local, null), local);
});

test("counter takes the max", () => {
  const a = { vocab: {}, letters: {}, counter: 5 };
  const b = { vocab: {}, letters: {}, counter: 9 };
  assert.equal(mergeProgress(a, b).counter, 9);
});

test("known beats learning; higher reps wins; later due breaks ties", () => {
  assert.equal(pickCard({ state: "known", reps: 1, due: 0 }, { state: "learning", reps: 9, due: 0 }).state, "known");
  assert.equal(pickCard({ state: "learning", reps: 2, due: 0 }, { state: "learning", reps: 5, due: 0 }).reps, 5);
  assert.equal(pickCard({ state: "learning", reps: 2, due: 10 }, { state: "learning", reps: 2, due: 99 }).due, 99);
});

test("union of word ids across local and server", () => {
  const local = { vocab: { 1: { reps: 1, due: 0, state: "learning" } }, letters: {}, counter: 0 };
  const server = { vocab: { 2: { reps: 1, due: 0, state: "learning" } }, letters: {}, counter: 0 };
  const m = mergeProgress(local, server);
  assert.deepEqual(Object.keys(m.vocab).sort(), ["1", "2"]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/worker/merge.test.mjs`
Expected: FAIL — `site/sync.js` doesn't exist.

- [ ] **Step 3: Create `site/sync.js`**

```javascript
// Pure progress-merge logic, shared by the app and unit tests.
export function pickCard(x, y) {
  if (!x) return y;
  if (!y) return x;
  const xk = x.state === "known", yk = y.state === "known";
  if (xk !== yk) return xk ? x : y;
  const xr = x.reps || 0, yr = y.reps || 0;
  if (xr !== yr) return xr > yr ? x : y;
  return (x.due || 0) >= (y.due || 0) ? x : y;
}

export function mergeProgress(local, server) {
  if (!server) return local;
  if (!local) return server;
  const out = {
    vocab: {},
    letters: {},
    counter: Math.max(local.counter || 0, server.counter || 0),
  };
  for (const key of ["vocab", "letters"]) {
    const a = local[key] || {}, b = server[key] || {};
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
      out[key][id] = pickCard(a[id], b[id]);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/worker/merge.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Import it in `site/app.js`** — add to the top of the file (the app is an ES module already)

```javascript
import { mergeProgress } from "./sync.js";
```

- [ ] **Step 6: Verify the app still loads (no regression)**

Run: `python3 -m http.server 8099 --directory site` and open `http://localhost:8099`; confirm the home screen renders (the import resolves). Stop the server.

- [ ] **Step 7: Commit**

```bash
git add site/sync.js site/app.js tests/worker/merge.test.mjs
git commit -m "feat: progress merge logic (item-level, more-advanced-wins)"
```

---

## Task 7: Sign-in UI (Google Identity Services)

**Files:**
- Modify: `site/index.html`
- Modify: `site/app.js`
- Modify: `site/style.css`

- [ ] **Step 1: Add the GIS script + a sign-in slot to `site/index.html`** — in `<head>` add the script, and in the `topbar` (after the title's spacer) add a container

In `<head>` (after the manifest link):
```html
  <script src="https://accounts.google.com/gsi/client" async></script>
```
In the `.topbar`, replace `<div class="spacer"></div>` with:
```html
      <div class="spacer"></div>
      <div id="account"></div>
```

- [ ] **Step 2: Add the auth wiring to `site/app.js`** — append near the boot section (before `init()`)

```javascript
// ---- account (Google sign-in) ----
const GOOGLE_CLIENT_ID = "<CLIENT_ID_FROM_STEP_5>.apps.googleusercontent.com";
let signedIn = false;

async function onGoogleCredential(resp) {
  try {
    const r = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: resp.credential }),
    });
    if (!r.ok) throw new Error("auth failed");
    const { email } = await r.json();
    signedIn = true;
    await pullAndMerge();         // defined in Task 8
    renderAccount(email);
    toast(`Signed in as ${email}`);
  } catch {
    toast("Sign-in failed");
  }
}

function renderAccount(email) {
  const el = $("#account");
  if (signedIn) {
    el.innerHTML = `<button class="acct" id="signout" title="${email || ""}">Sign out</button>`;
    $("#signout").onclick = async () => {
      await fetch("/api/auth/signout", { method: "POST" });
      signedIn = false;
      renderAccount();
    };
  } else {
    el.innerHTML = `<div id="gbtn"></div>`;
    if (window.google?.accounts?.id) {
      google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onGoogleCredential });
      google.accounts.id.renderButton($("#gbtn"), { type: "icon", shape: "circle", theme: "filled_black" });
    }
  }
}

async function initAccount() {
  try {
    const me = await fetch("/api/me").then((r) => r.json());
    signedIn = !!me.signedIn;
  } catch {
    signedIn = false;
  }
  // GIS loads async; retry render until the library is present
  const tryRender = (n) => {
    renderAccount();
    if (!signedIn && !window.google?.accounts?.id && n > 0) setTimeout(() => tryRender(n - 1), 400);
  };
  tryRender(10);
}
```

- [ ] **Step 3: Call `initAccount()` from `init()`** — in `site/app.js`, inside the `init` IIFE after `show("home")`, add:

```javascript
  initAccount();
```

- [ ] **Step 4: Add account-button styles to `site/style.css`**

```css
.acct { background:var(--glass); border:1px solid var(--line); color:var(--ink);
  border-radius:999px; padding:6px 12px; font-size:12px; cursor:pointer; }
#account #gbtn { display:flex; }
```

- [ ] **Step 5: Syntax check**

Run: `node --check site/app.js`
Expected: no output (valid).

- [ ] **Step 6: Commit**

```bash
git add site/index.html site/app.js site/style.css
git commit -m "feat: Google sign-in button + account UI (sign in / sign out)"
```

---

## Task 8: Sync (pull+merge on sign-in, debounced push on change)

**Files:**
- Modify: `site/app.js`

- [ ] **Step 1: Add pull + debounced push to `site/app.js`** — append near the account section

```javascript
async function pullAndMerge() {
  if (!signedIn) return;
  try {
    const { progress } = await fetch("/api/progress").then((r) => r.json());
    const merged = mergeProgress(
      { vocab: P.vocab, letters: P.letters, counter: P.counter },
      progress
    );
    P.vocab = merged.vocab;
    P.letters = merged.letters;
    P.counter = merged.counter;
    localStorage.setItem(KEY, JSON.stringify(merged)); // local cache
    await pushProgress(); // write the merged result back up
    refreshHome();
  } catch {
    /* offline — keep local */
  }
}

let pushTimer = null;
function pushProgress() {
  if (!signedIn) return Promise.resolve();
  return fetch("/api/progress", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vocab: P.vocab, letters: P.letters, counter: P.counter }),
  }).catch(() => {});
}
function schedulePush() {
  if (!signedIn) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushProgress, 3000);
}
```

- [ ] **Step 2: Hook `schedulePush()` into `saveProgress()`** — modify the existing `saveProgress` in `site/app.js`

```javascript
function saveProgress() {
  localStorage.setItem(
    KEY,
    JSON.stringify({ vocab: P.vocab, letters: P.letters, counter: P.counter })
  );
  schedulePush();
}
```

- [ ] **Step 3: Syntax check**

Run: `node --check site/app.js`
Expected: no output.

- [ ] **Step 4: Verify end-to-end locally with `wrangler dev`**

Run `npm run db:local` then `npx wrangler dev` (serves assets + API on `:8787`). Open `http://localhost:8787`, do a couple of reviews (creates local progress), then in DevTools confirm `PUT /api/progress` fires ~3s after answering (Network tab). (Real Google sign-in needs the deployed origin; verified in Task 9.)

- [ ] **Step 5: Commit**

```bash
git add site/app.js
git commit -m "feat: cloud sync — pull+merge on sign-in, debounced push on change"
```

---

## Task 9: Deploy, real sign-in, iOS PWA check, privacy note

**Files:**
- Modify: `site/index.html` (privacy note)
- Modify: `site/app.js` (iOS redirect fallback note/flag)

- [ ] **Step 1: Apply remote schema + deploy**

Run:
```bash
npm run db:remote
npx wrangler deploy
```
Expected: deploys the Worker; prints the `workers.dev` URL.

- [ ] **Step 2: Real Google sign-in on desktop**

Open the deployed URL in a desktop browser → the Google button appears → sign in → expect a "Signed in as …" toast and `Sign out` button. Do a review, then open the URL in a **different browser/profile**, sign in with the same Google account → your progress (known/due counts) should appear. This verifies verify→session→store→fetch→merge end-to-end.

- [ ] **Step 3: iOS installed-PWA check**

On the iPhone home-screen app: tap the Google button and sign in. **Known risk:** in iOS standalone PWAs the GIS popup can be blocked. If sign-in does not complete:
- Add `ux_mode: "redirect"` + `login_uri: "<deployed-origin>/api/auth/google-redirect"` to the `google.accounts.id.initialize(...)` call, and add a Worker route `GET/POST /api/auth/google-redirect` that reads the `credential` form field, runs `verifyGoogleToken` + `signSession`, sets the cookie, and 302-redirects to `/`.
- Re-deploy and retest on the installed PWA.
Document whichever path works in the README.

- [ ] **Step 4: Add a privacy note to `site/index.html`** — inside `#view-home`, after the stats, add:

```html
      <p class="privacy">Sign-in is optional. If you sign in, we store your email and your learning progress to sync across devices — nothing else.</p>
```
And in `site/style.css`:
```css
.privacy { font-size:11px; color:var(--muted); margin-top:18px; line-height:1.5; }
```

- [ ] **Step 5: Run all unit tests + commit**

Run: `node --test tests/worker/`
Expected: PASS (session + merge tests).

```bash
git add site/index.html site/app.js site/style.css
git commit -m "feat: deploy accounts+sync; privacy note; iOS PWA sign-in handling"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- Optional Google sign-in, app works locally without it → Tasks 7, 8 (sign-in optional; localStorage unchanged when signed out). ✓
- Worker serves assets + API → Tasks 1, 4, 5. ✓
- D1 storage (user, progress) → Tasks 1, 2. ✓
- Google ID token verify (sig/aud/exp/issuer) → Task 4 (`verifyGoogleToken`). ✓
- Signed HttpOnly session cookie, no session table → Task 3. ✓
- `/api/auth/google`, `/api/auth/signout`, `/api/me`, `/api/progress` GET/PUT → Tasks 4, 5. ✓
- Item-level merge (counter max, more-advanced card wins) → Task 6. ✓
- Debounced push, pull+merge on sign-in, offline-safe → Task 8. ✓
- One-time setup (Google OAuth client, D1, secret) → Task 1 steps 4–7. ✓
- Security (HttpOnly/Secure/SameSite, secret as Worker secret) → Tasks 1, 3. ✓
- iOS PWA sign-in + privacy note → Task 9. ✓

**Placeholder scan:** The only intentional `<...>` placeholders are real values the user supplies (D1 `database_id`, Google client id) — each flagged with the step that produces it. No TBD/handwaving steps.

**Type/name consistency:** `signSession(userId, secret)`, `readSession(request, secret)`, `sessionCookie/clearCookie`, `verifyGoogleToken(idToken, clientId)`, `handleGoogleAuth(request, env)`, `upsertUser/getProgress/putProgress(env, ...)`, `mergeProgress/pickCard`, and the progress blob shape `{vocab, letters, counter}` are used identically across worker, frontend, and tests. The session payload key is `uid` everywhere.

**Note:** This adds a JS/Worker toolchain alongside the existing Python dev app; the Worker is the production backend, the FastAPI app remains a local dev convenience for the original build pipeline.
