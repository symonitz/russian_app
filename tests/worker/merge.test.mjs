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
