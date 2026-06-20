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
