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
