# Feedback Capture + Abuse Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app feedback widget that saves to D1 and opens a GitHub Issue, plus rate limiting and Cloudflare Turnstile to protect the now-public API.

**Architecture:** A new `/api/feedback` POST endpoint on the existing Cloudflare Worker validates input, verifies a Turnstile token, writes a row to D1, then best-effort creates a GitHub Issue. A small front-end panel collects the feedback. Rate limiting is enforced with Cloudflare's native Workers rate-limit binding. Pure logic (validation, issue formatting, Turnstile/GitHub calls with an injected `fetch`) is unit-tested with `node --test`, matching the existing `tests/worker/` setup.

**Tech Stack:** Cloudflare Workers (ESM), D1 (SQLite), Cloudflare Turnstile, GitHub REST API, vanilla JS front-end, `node --test`.

## Global Constraints

- **Repo slug for GitHub API:** `symonitz/russian_app` (exact).
- **GitHub Issue label:** `user-feedback` (exact).
- **Feedback text length:** 1–2000 chars after trim; reject outside this.
- **Mood values:** exactly `good` | `ok` | `bad` | null. Anything else → null.
- **Rate limits:** `/api/feedback` → 5 requests / 60s per IP (`FEEDBACK_RL`, namespace_id `1001`). All other `/api/*` → 100 / 60s per IP (`DEFAULT_RL`, namespace_id `1002`). `period` must be `10` or `60` (Cloudflare constraint).
- **Rate-limit binding config lives at top level** under `ratelimits` (NOT under `unsafe`). API: `const { success } = await env.BINDING.limit({ key })`.
- **Feedback request body cap:** 8 KB (`8 * 1024`) — separate from the global 256 KB cap.
- **Secrets (set via `wrangler secret put`, never committed):** `TURNSTILE_SECRET`, `GITHUB_TOKEN`.
- **Public config (committed):** Turnstile **site** key as a placeholder `<TURNSTILE_SITE_KEY>` in `site/app.js` (public, same pattern as `GOOGLE_CLIENT_ID`).
- **Client-facing errors stay generic** (no internal detail) — matches existing hardening in `worker/index.js`.
- **IP source:** `request.headers.get("CF-Connecting-IP")`.
- **Run tests with:** `npm test` (`node --test tests/worker/*.mjs`). Node 22.

---

### Task 1: Extract shared HTTP helpers into `worker/http.js`

Moves `json` and `readJsonBody` out of `index.js` so the new `feedback.js` can reuse them without a circular import. Behavior unchanged; existing tests must stay green.

**Files:**
- Create: `worker/http.js`
- Modify: `worker/index.js` (remove the two helpers, import + re-export them)
- Test: `tests/worker/body.test.mjs` (unchanged — it imports `readJsonBody` from `worker/index.js`, which will re-export)

**Interfaces:**
- Produces: `json(obj, status=200, headers={}) -> Response`; `readJsonBody(request, maxBytes=262144) -> Promise<any>` (throws `{status:413}` when oversized). Both exported from `worker/http.js` and re-exported from `worker/index.js`.

- [ ] **Step 1: Create `worker/http.js` with the two helpers**

```javascript
const MAX_BODY_BYTES = 256 * 1024; // 256 KB — progress payloads are a few KB

export function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

// Read + size-cap a JSON request body. Throws a 413 if it's too large,
// before we ever buffer or store an oversized payload.
export async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) {
    throw Object.assign(new Error("payload too large"), { status: 413 });
  }
  const text = await request.text();
  if (text.length > maxBytes) {
    throw Object.assign(new Error("payload too large"), { status: 413 });
  }
  return JSON.parse(text);
}
```

- [ ] **Step 2: Update `worker/index.js` to import + re-export from `http.js`**

Replace the top of the file (the `MAX_BODY_BYTES` const, `json`, and `readJsonBody` definitions) with an import, and replace the bottom `export { json, readJsonBody };` line with a re-export. Final `worker/index.js` head:

```javascript
import { handleGoogleAuth, readSession, clearCookie } from "./auth.js";
import { json, readJsonBody } from "./http.js";

export default {
  async fetch(request, env) {
    // ... unchanged body ...
  },
};

export { json, readJsonBody } from "./http.js";
```

(Keep the `fetch` handler body exactly as it is for this task — only the helper definitions move.)

- [ ] **Step 3: Run the suite to confirm nothing broke**

Run: `npm test`
Expected: PASS — all existing tests (14) still green, including `body.test.mjs`.

- [ ] **Step 4: Syntax check the worker entry**

Run: `node --check worker/index.js && node --check worker/http.js`
Expected: no output (both valid).

- [ ] **Step 5: Commit**

```bash
git add worker/http.js worker/index.js
git commit -m "refactor: extract json + readJsonBody into worker/http.js"
```

---

### Task 2: Feedback validation (pure function, TDD)

**Files:**
- Create: `worker/feedback.js`
- Test: `tests/worker/feedback.test.mjs`

**Interfaces:**
- Produces: `validateFeedback(payload) -> { ok: true, value: { text, mood, contact, context } } | { ok: false, error: string }`. `context` is `{ mode, version, ua }` with each field a capped string.

- [ ] **Step 1: Write the failing tests**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFeedback } from "../../worker/feedback.js";

test("rejects empty / whitespace-only text", () => {
  assert.equal(validateFeedback({ text: "   " }).ok, false);
  assert.equal(validateFeedback({}).ok, false);
});

test("rejects text over 2000 chars", () => {
  assert.equal(validateFeedback({ text: "x".repeat(2001) }).ok, false);
});

test("accepts valid text and trims it", () => {
  const r = validateFeedback({ text: "  great app  " });
  assert.equal(r.ok, true);
  assert.equal(r.value.text, "great app");
});

test("coerces an unknown mood to null, keeps a valid one", () => {
  assert.equal(validateFeedback({ text: "hi", mood: "meh" }).value.mood, null);
  assert.equal(validateFeedback({ text: "hi", mood: "bad" }).value.mood, "bad");
});

test("drops a malformed contact, keeps a valid email", () => {
  assert.equal(validateFeedback({ text: "hi", contact: "not-an-email" }).value.contact, null);
  assert.equal(validateFeedback({ text: "hi", contact: "a@b.co" }).value.contact, "a@b.co");
});

test("caps context fields and ignores junk", () => {
  const r = validateFeedback({ text: "hi", context: { mode: "reviews", ua: "z".repeat(500), extra: "drop" } });
  assert.equal(r.value.context.mode, "reviews");
  assert.equal(r.value.context.ua.length, 300);
  assert.equal(r.value.context.extra, undefined);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/worker/feedback.test.mjs`
Expected: FAIL — `validateFeedback` is not exported / file missing.

- [ ] **Step 3: Implement `validateFeedback` in `worker/feedback.js`**

```javascript
// Feedback endpoint logic: validation, GitHub/Turnstile calls, orchestration.

const MOODS = ["good", "ok", "bad"];

export function validateFeedback(payload) {
  if (!payload || typeof payload !== "object") return { ok: false, error: "invalid" };
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (text.length < 1) return { ok: false, error: "empty" };
  if (text.length > 2000) return { ok: false, error: "too long" };

  const mood = MOODS.includes(payload.mood) ? payload.mood : null;

  let contact = typeof payload.contact === "string" ? payload.contact.trim().slice(0, 200) : "";
  if (contact && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact)) contact = "";

  const c = payload.context && typeof payload.context === "object" ? payload.context : {};
  const context = {
    mode: typeof c.mode === "string" ? c.mode.slice(0, 40) : "",
    version: typeof c.version === "string" ? c.version.slice(0, 40) : "",
    ua: typeof c.ua === "string" ? c.ua.slice(0, 300) : "",
  };

  return { ok: true, value: { text, mood, contact: contact || null, context } };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/worker/feedback.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/feedback.js tests/worker/feedback.test.mjs
git commit -m "feat: feedback payload validation"
```

---

### Task 3: GitHub issue builder (pure function, TDD)

**Files:**
- Modify: `worker/feedback.js`
- Test: `tests/worker/feedback.test.mjs`

**Interfaces:**
- Consumes: a feedback `row` `{ text, mood, contact, context:{mode,version,ua}, user_id, created_at }`.
- Produces: `buildIssue(row) -> { title: string, body: string, labels: string[] }`.

- [ ] **Step 1: Add the failing tests**

Append to `tests/worker/feedback.test.mjs`:

```javascript
import { buildIssue } from "../../worker/feedback.js";

const ROW = {
  text: "The reviews mode is great but the audio is quiet",
  mood: "good",
  contact: "a@b.co",
  context: { mode: "reviews", version: "v4", ua: "iPhone" },
  user_id: 7,
  created_at: "2026-06-20T10:00:00.000Z",
};

test("buildIssue: title is prefixed and truncated to <= ~70 chars", () => {
  const issue = buildIssue(ROW);
  assert.ok(issue.title.startsWith("Feedback: "));
  assert.ok(issue.title.length <= 70);
});

test("buildIssue: body carries the text, mood and context; label is user-feedback", () => {
  const issue = buildIssue(ROW);
  assert.ok(issue.body.includes("The reviews mode is great"));
  assert.ok(issue.body.includes("reviews"));
  assert.ok(issue.body.toLowerCase().includes("good"));
  assert.deepEqual(issue.labels, ["user-feedback"]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/worker/feedback.test.mjs`
Expected: FAIL — `buildIssue` not exported.

- [ ] **Step 3: Implement `buildIssue` in `worker/feedback.js`**

```javascript
const MOOD_LABEL = { good: "🙂 good", ok: "😐 ok", bad: "🙁 bad" };

export function buildIssue(row) {
  const title = "Feedback: " + row.text.replace(/\s+/g, " ").slice(0, 60);
  const body = [
    row.text,
    "",
    "---",
    `**Mood:** ${row.mood ? MOOD_LABEL[row.mood] : "—"}`,
    `**Contact:** ${row.contact || "—"}`,
    `**Mode:** ${row.context?.mode || "—"}`,
    `**Version:** ${row.context?.version || "—"}`,
    `**User:** ${row.user_id ?? "anon"}`,
    `**UA:** ${row.context?.ua || "—"}`,
    `**At:** ${row.created_at}`,
  ].join("\n");
  return { title, body, labels: ["user-feedback"] };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/worker/feedback.test.mjs`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/feedback.js tests/worker/feedback.test.mjs
git commit -m "feat: format feedback as a GitHub issue"
```

---

### Task 4: Turnstile verify + GitHub create (network helpers, TDD with injected fetch)

**Files:**
- Modify: `worker/feedback.js`
- Test: `tests/worker/feedback.test.mjs`

**Interfaces:**
- Produces:
  - `verifyTurnstile(token, secret, ip, fetchImpl=fetch) -> Promise<boolean>`
  - `createIssue(repo, token, issue, fetchImpl=fetch) -> Promise<number>` (returns the new issue number; throws on non-2xx).

- [ ] **Step 1: Add the failing tests**

Append to `tests/worker/feedback.test.mjs`:

```javascript
import { verifyTurnstile, createIssue } from "../../worker/feedback.js";

test("verifyTurnstile: false with no token, true/false from siteverify", async () => {
  const ok = () => ({ json: async () => ({ success: true }) });
  const bad = () => ({ json: async () => ({ success: false }) });
  assert.equal(await verifyTurnstile("", "secret", "1.2.3.4", ok), false);
  assert.equal(await verifyTurnstile("tok", "secret", "1.2.3.4", ok), true);
  assert.equal(await verifyTurnstile("tok", "secret", "1.2.3.4", bad), false);
});

test("createIssue: posts to the repo issues URL with auth, returns the number", async () => {
  let seen = null;
  const fakeFetch = (url, opts) => {
    seen = { url, opts };
    return { ok: true, status: 201, json: async () => ({ number: 42 }) };
  };
  const n = await createIssue("symonitz/russian_app", "ghtok", { title: "t", body: "b", labels: ["user-feedback"] }, fakeFetch);
  assert.equal(n, 42);
  assert.equal(seen.url, "https://api.github.com/repos/symonitz/russian_app/issues");
  assert.match(seen.opts.headers.Authorization, /Bearer ghtok/);
});

test("createIssue: throws on a non-ok response", async () => {
  const fakeFetch = () => ({ ok: false, status: 403, json: async () => ({}) });
  await assert.rejects(() => createIssue("r/r", "t", { title: "t", body: "b", labels: [] }, fakeFetch));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/worker/feedback.test.mjs`
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Implement the two helpers in `worker/feedback.js`**

```javascript
export async function verifyTurnstile(token, secret, ip, fetchImpl = fetch) {
  if (!token || !secret) return false;
  const form = new URLSearchParams();
  form.set("secret", secret);
  form.set("response", token);
  if (ip) form.set("remoteip", ip);
  const res = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  const data = await res.json();
  return !!data.success;
}

export async function createIssue(repo, token, issue, fetchImpl = fetch) {
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "ruslearn-feedback",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(issue),
  });
  if (!res.ok) throw new Error(`github ${res.status}`);
  const data = await res.json();
  return data.number;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/worker/feedback.test.mjs`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/feedback.js tests/worker/feedback.test.mjs
git commit -m "feat: Turnstile verify + GitHub issue create helpers"
```

---

### Task 5: D1 feedback table + storage helpers

**Files:**
- Create: `migrations/0002_feedback.sql`
- Modify: `worker/db.js`

**Interfaces:**
- Produces:
  - `insertFeedback(env, row) -> Promise<number>` (returns new row id via `res.meta.last_row_id`). `row` = `{ text, mood, contact, context, user_id, created_at }`.
  - `setFeedbackIssue(env, id, issueNumber) -> Promise<void>`.

- [ ] **Step 1: Create the migration**

`migrations/0002_feedback.sql`:

```sql
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  mood TEXT,
  contact TEXT,
  context TEXT,
  user_id INTEGER,
  github_issue INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id)
);
```

- [ ] **Step 2: Add the helpers to `worker/db.js`**

Append:

```javascript
export async function insertFeedback(env, row) {
  const res = await env.DB.prepare(
    `INSERT INTO feedback (text, mood, contact, context, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      row.text,
      row.mood ?? null,
      row.contact ?? null,
      JSON.stringify(row.context ?? {}),
      row.user_id ?? null,
      row.created_at
    )
    .run();
  return res.meta.last_row_id;
}

export async function setFeedbackIssue(env, id, issueNumber) {
  await env.DB.prepare("UPDATE feedback SET github_issue = ? WHERE id = ?")
    .bind(issueNumber, id)
    .run();
}
```

- [ ] **Step 3: Syntax-check and apply the migration to the LOCAL D1**

Run: `node --check worker/db.js`
Expected: no output.

Run: `npx wrangler d1 migrations apply russian-app --local`
Expected: `0002_feedback.sql ✅`.

- [ ] **Step 4: Smoke-test the schema locally**

Run: `npx wrangler d1 execute russian-app --local --command "INSERT INTO feedback (text, created_at) VALUES ('hello', '2026-06-20'); SELECT id, text, github_issue FROM feedback;"`
Expected: one row, `text = hello`, `github_issue = NULL`.

- [ ] **Step 5: Commit**

```bash
git add migrations/0002_feedback.sql worker/db.js
git commit -m "feat: feedback D1 table + insert/update helpers"
```

---

### Task 6: Wire `/api/feedback` endpoint + rate limiting

**Files:**
- Modify: `worker/feedback.js` (add `handleFeedback`)
- Modify: `worker/index.js` (rate-limit gate + route)
- Modify: `wrangler.jsonc` (add `ratelimits`)

**Interfaces:**
- Consumes: `validateFeedback`, `verifyTurnstile`, `buildIssue`, `createIssue` (same file); `insertFeedback`, `setFeedbackIssue` (`db.js`); `readSession` (`auth.js`); `json` (`http.js`).
- Produces: `handleFeedback(body, env, request) -> Promise<Response>`. Bindings `env.FEEDBACK_RL`, `env.DEFAULT_RL` (rate limiters); secrets `env.TURNSTILE_SECRET`, `env.GITHUB_TOKEN`.

- [ ] **Step 1: Add `handleFeedback` to `worker/feedback.js`**

Add imports at the TOP of `worker/feedback.js` (above the existing code):

```javascript
import { json } from "./http.js";
import { readSession } from "./auth.js";
import { insertFeedback, setFeedbackIssue } from "./db.js";

const GITHUB_REPO = "symonitz/russian_app";
```

Add at the bottom of `worker/feedback.js`:

```javascript
export async function handleFeedback(body, env, request) {
  const v = validateFeedback(body);
  if (!v.ok) return json({ error: v.error }, 400);

  const ip = request.headers.get("CF-Connecting-IP") || "";
  const passed = await verifyTurnstile(body.turnstileToken, env.TURNSTILE_SECRET, ip);
  if (!passed) return json({ error: "verification failed" }, 400);

  const user = await readSession(request, env.SESSION_SECRET);
  const row = { ...v.value, user_id: user?.id ?? null, created_at: new Date().toISOString() };
  const id = await insertFeedback(env, row);

  // Best-effort: a GitHub hiccup must not lose the feedback (D1 already has it).
  try {
    const num = await createIssue(GITHUB_REPO, env.GITHUB_TOKEN, buildIssue(row));
    if (num) await setFeedbackIssue(env, id, num);
  } catch (e) {
    console.error("github issue failed:", e);
  }

  return json({ ok: true });
}
```

- [ ] **Step 2: Add the rate-limit gate + route to `worker/index.js`**

Add the import near the top:

```javascript
import { handleFeedback } from "./feedback.js";
```

Inside `fetch`, immediately after `const p = url.pathname;` and BEFORE the `try`-block routing (still inside `try` is fine; place it as the first thing inside `try`):

```javascript
      const ip = request.headers.get("CF-Connecting-IP") || "anon";
      if (p.startsWith("/api/")) {
        const limiter = p === "/api/feedback" ? env.FEEDBACK_RL : env.DEFAULT_RL;
        if (limiter) {
          const { success } = await limiter.limit({ key: ip });
          if (!success) return json({ error: "rate limited" }, 429);
        }
      }
```

Then add the feedback route alongside the others (e.g. after the `/api/auth/google` line):

```javascript
      if (p === "/api/feedback" && request.method === "POST")
        return await handleFeedback(await readJsonBody(request, 8 * 1024), env, request);
```

- [ ] **Step 3: Add the rate-limit bindings to `wrangler.jsonc`**

Add a top-level `ratelimits` key (sibling of `vars`):

```jsonc
  "ratelimits": [
    { "name": "FEEDBACK_RL", "namespace_id": "1001", "simple": { "limit": 5, "period": 60 } },
    { "name": "DEFAULT_RL", "namespace_id": "1002", "simple": { "limit": 100, "period": 60 } }
  ],
```

- [ ] **Step 4: Syntax-check and run the suite**

Run: `node --check worker/index.js && node --check worker/feedback.js`
Expected: no output.

Run: `npm test`
Expected: PASS — all tests (now 25) still green (this task adds no new unit tests; the endpoint wiring is verified manually at deploy, consistent with how `handleGoogleAuth` wiring is handled).

- [ ] **Step 5: Commit**

```bash
git add worker/feedback.js worker/index.js wrangler.jsonc
git commit -m "feat: /api/feedback endpoint with rate limiting"
```

---

### Task 7: Front-end feedback widget

**Files:**
- Modify: `site/index.html` (Turnstile script, home-screen button, panel root)
- Modify: `site/app.js` (widget logic, `currentView` tracking, `TURNSTILE_SITE_KEY` placeholder)
- Modify: `site/style.css` (panel styles)
- Modify: `site/sw.js` (bump cache to v4)

**Interfaces:**
- Consumes: `POST /api/feedback` with `{ text, mood, contact, turnstileToken, context:{mode,version,ua} }`.

- [ ] **Step 1: Add the Turnstile script, home button, and panel root to `site/index.html`**

In `<head>` (after the stylesheet link):

```html
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
```

At the end of `#view-home` (immediately before its closing `</section>`):

```html
      <button class="fb-open" id="fb-open">💬 Feedback</button>
```

Immediately before the closing `</div>` of `#app` (after the last `<section>`):

```html
    <div id="fb-root" hidden></div>
```

- [ ] **Step 2: Track the current view in `site/app.js`**

At module top (near the other `let` declarations), add:

```javascript
let currentView = "home";
const CACHE_VERSION = "v4";
const TURNSTILE_SITE_KEY = "<TURNSTILE_SITE_KEY>";
```

In `show(view)`, add `currentView = view;` as the first line of the function.

- [ ] **Step 3: Add the widget logic to `site/app.js`**

Add near the boot section (before the `// ---------- boot ----------` comment):

```javascript
// ---------- feedback ----------
let fbWidgetId = null;

function initFeedback() {
  const open = $("#fb-open");
  if (open) open.onclick = openFeedback;
}

function openFeedback() {
  const root = $("#fb-root");
  root.innerHTML = `
    <div class="fb-overlay" id="fb-overlay"></div>
    <div class="fb-panel" role="dialog" aria-label="Feedback">
      <h3 class="fb-title">Feedback</h3>
      <textarea id="fb-text" class="fb-text" maxlength="2000"
        placeholder="What's working? What's confusing? What's missing?"></textarea>
      <div class="fb-moods" id="fb-moods">
        <button type="button" data-mood="good">🙂</button>
        <button type="button" data-mood="ok">😐</button>
        <button type="button" data-mood="bad">🙁</button>
      </div>
      <input id="fb-contact" class="fb-contact" type="email" placeholder="Email (optional)" />
      <div id="fb-ts"></div>
      <div class="fb-actions">
        <button class="btn ghost" id="fb-cancel">Cancel</button>
        <button class="btn reveal" id="fb-send">Send</button>
      </div>
    </div>`;
  root.hidden = false;

  let mood = null;
  $("#fb-moods").querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      mood = b.dataset.mood;
      $("#fb-moods").querySelectorAll("button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
    };
  });

  fbWidgetId = null;
  if (window.turnstile) fbWidgetId = window.turnstile.render("#fb-ts", { sitekey: TURNSTILE_SITE_KEY });

  const close = () => {
    if (fbWidgetId != null && window.turnstile) window.turnstile.remove(fbWidgetId);
    root.hidden = true;
    root.innerHTML = "";
  };
  $("#fb-overlay").onclick = close;
  $("#fb-cancel").onclick = close;

  $("#fb-send").onclick = async () => {
    const text = $("#fb-text").value.trim();
    if (!text) return toast("Write something first");
    const token = window.turnstile && fbWidgetId != null ? window.turnstile.getResponse(fbWidgetId) : "";
    if (!token) return toast("Please complete the check");
    const payload = {
      text,
      mood,
      contact: $("#fb-contact").value.trim() || null,
      turnstileToken: token,
      context: { mode: currentView, version: CACHE_VERSION, ua: navigator.userAgent },
    };
    try {
      const r = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error();
      toast("Thanks! 🙏");
      close();
    } catch {
      toast("Couldn't send — try again");
    }
  };
}
```

In the `init()` IIFE, add `initFeedback();` right after the existing `initAccount();` line.

- [ ] **Step 4: Add styles to `site/style.css`**

Append:

```css
/* feedback widget */
.fb-open { display:block; margin:22px auto 0; background:var(--glass); border:1px solid var(--line);
  color:var(--muted); border-radius:999px; padding:9px 18px; font-size:13px; cursor:pointer; }
.fb-overlay { position:fixed; inset:0; background:rgba(0,0,0,.55); }
.fb-panel { position:fixed; left:50%; bottom:0; transform:translateX(-50%);
  width:100%; max-width:430px; background:var(--bg1); border:1px solid var(--line);
  border-radius:20px 20px 0 0; padding:20px; box-shadow:0 -20px 50px -20px #000; }
.fb-title { margin:0 0 12px; font-size:18px; }
.fb-text { width:100%; min-height:110px; resize:vertical; border-radius:12px; padding:12px;
  background:rgba(0,0,0,.25); border:1px solid var(--line); color:var(--ink); font-size:15px; outline:none; }
.fb-text:focus { border-color:var(--indigo); }
.fb-moods { display:flex; gap:8px; margin:12px 0; }
.fb-moods button { font-size:22px; width:48px; height:44px; border-radius:12px;
  background:var(--glass); border:1px solid var(--line); cursor:pointer; }
.fb-moods button.on { background:rgba(110,123,242,.20); border-color:rgba(110,123,242,.5); }
.fb-contact { width:100%; margin-bottom:12px; padding:11px 12px; border-radius:12px;
  background:rgba(0,0,0,.25); border:1px solid var(--line); color:var(--ink); font-size:14px; outline:none; }
.fb-contact:focus { border-color:var(--indigo); }
.fb-actions { display:flex; gap:10px; margin-top:12px; }
#fb-ts { min-height:0; }
```

- [ ] **Step 5: Bump the service-worker cache in `site/sw.js`**

Change `const CACHE = "ruslearn-v3";` to `const CACHE = "ruslearn-v4";`.

- [ ] **Step 6: Syntax-check the app JS**

Run: `node --check site/app.js`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add site/index.html site/app.js site/style.css site/sw.js
git commit -m "feat: in-app feedback widget (Turnstile + submit)"
```

---

## Deployment (manual checklist — after all tasks reviewed)

Not a code task. Do these with the user; the app keeps working without feedback until done.

1. **Create the GitHub token:** GitHub → Settings → Developer settings → Fine-grained tokens → new token, **Resource owner = symonitz**, **Only select repositories = russian_app**, **Repository permissions → Issues = Read and write**. Copy it.
2. **Set the GitHub secret:** `npx wrangler secret put GITHUB_TOKEN` (paste the token).
3. **Create the Turnstile widget:** Cloudflare dashboard → Turnstile → Add widget, hostname `russian-app.ruslearn.workers.dev`. Copy the **site key** and **secret key**.
4. **Wire the site key:** replace `<TURNSTILE_SITE_KEY>` in `site/app.js` with the real site key; commit.
5. **Set the Turnstile secret:** `npx wrangler secret put TURNSTILE_SECRET` (paste the secret key).
6. **Apply the migration to remote D1:** `npx wrangler d1 migrations apply russian-app --remote`.
7. **Deploy:** `npx wrangler deploy`.
8. **Verify:** open the live app, submit feedback → confirm a `feedback` row in D1 (`SELECT COUNT(*) FROM feedback`) and a new GitHub Issue labeled `user-feedback`. Confirm a request with a bad/no Turnstile token is rejected (400) and that >5 rapid submits from one IP get a 429.

---

## Notes / intentional decisions

- **Rate limiting scope:** the spec said "rate limit `/api/*`, strict on feedback, looser on others." This plan applies `FEEDBACK_RL` (5/60) to `/api/feedback` and `DEFAULT_RL` (100/60) to every other `/api/*` route (including `/api/progress`, whose pushes are debounced ~3s so 100/min is far above legitimate use). This satisfies the spec; the 100/60 number is chosen to avoid throttling legitimate progress sync, including some shared-IP/CGNAT headroom.
- **No unit test for the endpoint wiring / D1 helpers:** matches the existing codebase, which unit-tests pure logic (`session`, `merge`, `body`) and leaves network/D1 orchestration (`handleGoogleAuth`, `db.js`) to manual/integration verification. All extractable logic here (validation, issue formatting, Turnstile, GitHub) IS unit-tested via injected `fetch`.
- **Turnstile is the primary anti-spam layer**; rate limiting and the free-plan request ceiling are secondary. Volumetric DDoS is absorbed by Cloudflare's edge automatically.
```
