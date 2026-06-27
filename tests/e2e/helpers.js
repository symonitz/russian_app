import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "site", "data");

export function loadData() {
  const read = (n) => JSON.parse(readFileSync(join(DATA, n), "utf8"));
  return {
    words: read("words.json"),
    reading: read("reading.json"),
    patterns: read("patterns.json"),
    alphabet: read("alphabet.json"),
  };
}

export function knownVocab(ids) {
  const v = {};
  for (const id of ids) v[id] = { due: 100000, reps: 3, state: "known" };
  return v;
}

export async function seedProgress(page, state) {
  const full = { vocab: {}, letters: {}, patterns: {}, counter: 0, ...state };
  await page.addInitScript((s) => localStorage.setItem("ruslearn.v2", JSON.stringify(s)), full);
}

// Navigate + wait until the dataset has loaded. #s-left ("to learn") is "0" in
// static HTML and gets the real word count once data loads + refreshHome runs.
export async function gotoApp(page) {
  await page.goto("/");
  await page.waitForFunction(() => {
    const t = document.querySelector("#s-left")?.textContent;
    return t && t !== "0";
  });
}

// The first English alternate of a gloss (the app accepts comma/slash alternates).
export function firstGloss(gloss) {
  return gloss.split(/[,/;]| or /)[0].trim();
}
