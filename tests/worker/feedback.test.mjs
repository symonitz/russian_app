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
