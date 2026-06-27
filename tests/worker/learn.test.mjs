import { test } from "node:test";
import assert from "node:assert/strict";
import { readableWords, miniTest } from "../../site/learn.js";

const WORDS = [
  { ru: "кот", emoji: "🐱" },
  { ru: "мама", emoji: "👩" },
  { ru: "вино", emoji: "🍷" }, // needs в,и,н,о
];

test("readableWords keeps only words whose letters are all introduced", () => {
  const intro = new Set(["к", "о", "т", "м", "а"]);
  const got = readableWords(WORDS, intro).map((w) => w.ru);
  assert.deepEqual(got, ["кот", "мама"]); // "вино" excluded (и,в,н missing)
});

test("readableWords is case-insensitive on letters", () => {
  const intro = new Set(["К", "О", "Т"]); // uppercase
  assert.deepEqual(readableWords([{ ru: "кот" }], intro).map((w) => w.ru), ["кот"]);
});

test("miniTest returns up to n words", () => {
  assert.equal(miniTest(WORDS, 2).length, 2);
  assert.equal(miniTest(WORDS, 10).length, 3);
});
