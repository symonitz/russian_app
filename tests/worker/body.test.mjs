import { test } from "node:test";
import assert from "node:assert/strict";
import { readJsonBody } from "../../worker/index.js";

test("readJsonBody parses a normal JSON body", async () => {
  const req = new Request("https://x/", { method: "PUT", body: JSON.stringify({ a: 1 }) });
  assert.deepEqual(await readJsonBody(req), { a: 1 });
});

test("readJsonBody rejects a body over the cap with a 413", async () => {
  const big = JSON.stringify({ s: "x".repeat(5000) });
  const req = new Request("https://x/", { method: "PUT", body: big });
  await assert.rejects(
    () => readJsonBody(req, 1000),
    (e) => e.status === 413
  );
});

test("readJsonBody rejects an oversized declared content-length", async () => {
  const req = new Request("https://x/", {
    method: "PUT",
    headers: { "content-length": String(2000) },
    body: "{}",
  });
  await assert.rejects(
    () => readJsonBody(req, 1000),
    (e) => e.status === 413
  );
});

test("readJsonBody throws on malformed JSON", async () => {
  const req = new Request("https://x/", { method: "PUT", body: "{not json" });
  await assert.rejects(() => readJsonBody(req));
});
