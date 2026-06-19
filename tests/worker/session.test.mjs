import { test } from "node:test";
import assert from "node:assert/strict";
import { signSession, readSession } from "../../worker/auth.js";

const SECRET = "test-secret-please-change-0123456789"; // >= 32 chars

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

test("signSession rejects a missing or too-short secret", async () => {
  await assert.rejects(() => signSession(1, "short"));
  await assert.rejects(() => signSession(1, ""));
});

test("readSession returns null when the secret is too short", async () => {
  const cookie = await signSession(1, SECRET);
  const req = new Request("https://x/", { headers: { cookie: `session=${cookie}` } });
  assert.equal(await readSession(req, "short"), null);
});
