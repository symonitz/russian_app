# "Learn to Read" Module — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the core vertical slice of the "Learn to Read" module — a new home section that runs Lesson 1 (friend-grouped letters → emoji-illustrated word-decoding → mini-test).

**Architecture:** A new `learn` view in the static PWA (`site/app.js` + `index.html` + `style.css`), driven by upgraded `alphabet.json` (per-letter pronunciation hints) + a new `reading_lessons.json` (letters + emoji words). Pure readable-word logic lives in `site/learn.js` (imported by app.js, unit-tested via node:test, mirroring `sync.js`). Audio for the new content is pre-rendered by a standalone edge-tts runner. Reuses the existing count-based scheduler.

**Tech Stack:** vanilla-JS PWA (ESM), `node --test`, Python edge-tts build, Playwright E2E.

## Global Constraints

- **No translations in the module — emoji only.** Reading words show a Russian word; tapping reveals the **emoji + audio**.
- **Reading words never autoplay.** Audio fires only on tap. (Letter-intro and numbers cards may play on reveal.)
- **Friend groups (verbatim):** true `А О К М Т`; false `С Р У В Х Е Н`; new `Б И Л Г П Д Ф З Э`; stranger `Ж Ч Ц Ш Щ Ю Я Ё Й ъ ы ь`.
- **Lesson 1 letters:** `А О К М Т С Р У В Х Е Н` (true + false). **Lesson 1 words (21):** `мама, кот, атом, томат, нос, сон, ухо, сок, море, носок, комар, корона, ворона, ракета, торт, ресторан, метро, космос, нота, карта, окно`.
- **Pronunciation hints** come from the spec (`docs/superpowers/specs/2026-06-26-learn-to-read-design.md`), `hint_en`/`hint_word` per letter.
- Progress: letters → `P.letters` (exists); reading words → new `P.reading` map keyed by the word string. Self-grade reuses `answer(card, correct)` (reps≥2 → "known").
- The repo is `"type": "module"`; ESM throughout. Run node tests with `npm test` (`node --test tests/worker/*.mjs`); python with `.venv/bin/python`; E2E with `npx playwright test`.
- **Phase 1 only** — Lessons 2–3, Numbers, Find-the-Word, and Mixed Review are later phases. Build the slice, then validate.

---

### Task 1: Data — alphabet hints + `reading_lessons.json` (Lesson 1)

**Files:**
- Modify: `site/data/alphabet.json` (add `group`, `hint_en`, `hint_word` to all 33 letters)
- Create: `site/data/reading_lessons.json` (Lesson 1)

**Interfaces:**
- Produces: `alphabet.json` letters each with `group` (`true|false|new|stranger`), `hint_en`, `hint_word`; `reading_lessons.json` = `[{ id, title, letters: [...], words: [{ ru, emoji }] }]`.

- [ ] **Step 1: Add `group`/`hint_en`/`hint_word` to every letter in `site/data/alphabet.json`**

For each existing letter object (keyed by `cyrillic`), add the three fields using this map (cyrillic → group, hint_en, hint_word):
```
А true bar бар        Б new bank банк      В false video видео   Г new guitar гитара
Д new dollar доллар   Е false Vietnam Вьетнам  Ё stranger surfing сёрфинг
Ж stranger pleasure журнал  З new zebra зебра  И new video видео   Й stranger yogurt йогурт
К true coffee кофе    Л new lamp лампа     М true mother мама    Н false nose нос
О true metro метро    П new park парк      Р false Russia Россия  С false sport спорт
Т true taxi такси     У false football футбол  Ф new photo фото   Х false hockey хоккей
Ц stranger pizza пицца  Ч stranger Chili Чили  Ш stranger show шоу  Щ stranger borsch борщ
Ъ stranger silent объект  Ы stranger none музыка  Ь stranger silent фильм
Э new Edinburgh Эдинбург  Ю stranger producer продюсер  Я stranger Yandex Яндекс
```
(Keep all existing fields. For Ъ/Ы/Ь use `hint_en` values `"(silent)"`, `"(no English sound)"`, `"(silent)"` respectively.)

- [ ] **Step 2: Create `site/data/reading_lessons.json`**

```json
[
  {
    "id": 1,
    "title": "True & False friends",
    "letters": ["А", "О", "К", "М", "Т", "С", "Р", "У", "В", "Х", "Е", "Н"],
    "words": [
      { "ru": "мама", "emoji": "👩" },
      { "ru": "кот", "emoji": "🐱" },
      { "ru": "атом", "emoji": "⚛️" },
      { "ru": "томат", "emoji": "🍅" },
      { "ru": "нос", "emoji": "👃" },
      { "ru": "сон", "emoji": "😴" },
      { "ru": "ухо", "emoji": "👂" },
      { "ru": "сок", "emoji": "🧃" },
      { "ru": "море", "emoji": "🌊" },
      { "ru": "носок", "emoji": "🧦" },
      { "ru": "комар", "emoji": "🦟" },
      { "ru": "корона", "emoji": "👑" },
      { "ru": "ворона", "emoji": "🐦‍⬛" },
      { "ru": "ракета", "emoji": "🚀" },
      { "ru": "торт", "emoji": "🎂" },
      { "ru": "ресторан", "emoji": "🍽️" },
      { "ru": "метро", "emoji": "🚇" },
      { "ru": "космос", "emoji": "🌌" },
      { "ru": "нота", "emoji": "🎵" },
      { "ru": "карта", "emoji": "🗺️" },
      { "ru": "окно", "emoji": "🪟" }
    ]
  }
]
```

- [ ] **Step 3: Validate**

Run:
```bash
cd /Users/orsymonitz/PycharmProjects/russian-learn && .venv/bin/python -c "import json; a=json.load(open('site/data/alphabet.json')); assert all('hint_en' in l and 'group' in l for l in a), 'missing hint/group'; r=json.load(open('site/data/reading_lessons.json')); assert all(w.get('emoji') and w.get('ru') for w in r[0]['words']), 'word missing emoji'; print('ok', len(a), 'letters,', len(r[0]['words']), 'words')"
```
Expected: `ok 33 letters, 21 words`

- [ ] **Step 4: Commit**

```bash
git add site/data/alphabet.json site/data/reading_lessons.json
git commit -m "feat(learn): alphabet pronunciation hints + Lesson 1 reading data"
```

---

### Task 2: Pure logic — `site/learn.js` (readable words + mini-test)

**Files:**
- Create: `site/learn.js`
- Test: `tests/worker/learn.test.mjs`

**Interfaces:**
- Produces: `readableWords(words, introduced)` → the subset whose every Cyrillic letter is in the `introduced` Set (lowercased); `miniTest(words, n = 6)` → first `min(n, words.length)` words (a deterministic checkpoint subset).

- [ ] **Step 1: Write the failing test**

`tests/worker/learn.test.mjs`:
```javascript
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/worker/learn.test.mjs`
Expected: FAIL (`site/learn.js` not found).

- [ ] **Step 3: Implement `site/learn.js`**

```javascript
// Pure logic for the Learn-to-Read module (imported by app.js + unit-tested).

// Words whose every Cyrillic letter is in the introduced set (case-insensitive).
export function readableWords(words, introduced) {
  const have = new Set([...introduced].map((c) => c.toLowerCase()));
  return words.filter((w) =>
    [...w.ru.toLowerCase()].every((ch) => !/\p{L}/u.test(ch) || have.has(ch))
  );
}

// A focused checkpoint subset (first n words).
export function miniTest(words, n = 6) {
  return words.slice(0, Math.max(0, n));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/worker/learn.test.mjs`
Expected: PASS (3 tests). Then `npm test` → whole worker suite still green.

- [ ] **Step 5: Commit**

```bash
git add site/learn.js tests/worker/learn.test.mjs
git commit -m "feat(learn): readableWords + miniTest pure logic"
```

---

### Task 3: Audio — pre-render Lesson 1 words + letter example words

**Files:**
- Create: `tools/build_learn_audio.py`
- (Updates `site/data/audio.json` + new `site/audio/*.mp3`)

**Interfaces:**
- Consumes: `reading_lessons.json`, `alphabet.json`; reuses `tools/build_dataset.py` `render_audio` + `audio_key` (`ruslearn.accent`).

- [ ] **Step 1: Write the runner**

`tools/build_learn_audio.py`:
```python
"""Pre-render audio for the Learn-to-Read module: Lesson reading words + each
letter's example word (hint_word). Incremental (TTS caches by content). No Gemini.

Run: .venv/bin/python tools/build_learn_audio.py
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tools"))

from ruslearn.accent import strip_acute  # noqa: E402
import build_dataset as bd  # noqa: E402

SD = bd.SITE_DATA


async def main():
    lessons = json.loads((SD / "reading_lessons.json").read_text(encoding="utf-8"))
    alphabet = json.loads((SD / "alphabet.json").read_text(encoding="utf-8"))
    audio = json.loads((SD / "audio.json").read_text(encoding="utf-8"))

    texts = set()
    for lesson in lessons:
        for w in lesson["words"]:
            texts.add(strip_acute(w["ru"]))
    for letter in alphabet:
        if letter.get("hint_word"):
            texts.add(strip_acute(letter["hint_word"]))
    texts = {t for t in texts if t.strip()}

    print(f"rendering/caching {len(texts)} learn-module clips...")
    manifest = await bd.render_audio(texts)   # writes mp3s, returns {text: path}
    audio.update(manifest)
    bd._write(SD / "audio.json", audio)
    print(f"-> audio.json now {len(audio)} clips")


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Run it**

Run: `.venv/bin/python tools/build_learn_audio.py 2>&1 | grep -vE 'Warning|warn'`
Expected: prints the clip count and the new audio.json size (most words may already exist from the main dataset; only new ones synthesize — needs network).

- [ ] **Step 3: Validate Lesson 1 words + letter words have clips**

Run:
```bash
.venv/bin/python -c "import json; a=json.load(open('site/data/audio.json')); r=json.load(open('site/data/reading_lessons.json')); miss=[w['ru'] for w in r[0]['words'] if w['ru'] not in a]; print('missing word audio:', miss)"
```
Expected: `missing word audio: []`

- [ ] **Step 4: Commit**

```bash
git add tools/build_learn_audio.py site/data/audio.json site/audio/
git commit -m "feat(learn): pre-render audio for Lesson 1 words + letter examples"
```

---

### Task 4: Frontend — module shell (home tile + view + lesson list)

**Files:**
- Modify: `site/index.html` (home tile + `#view-learn`)
- Modify: `site/app.js` (load data, `show()` wiring, `loadLearn` lesson list)
- Modify: `site/style.css` (lesson-list styles)

**Interfaces:**
- Consumes: `reading_lessons.json` (loaded into `LESSONS`), `readableWords`/`miniTest` from `./learn.js`.
- Produces: `loadLearn()` renders the lesson list into `#learn-stage`; clicking a lesson calls `startLesson(lesson)` (defined in Task 5).

- [ ] **Step 1: Add the home tile + view to `site/index.html`**

As the FIRST `.mode` button inside `#view-home` (before the Alphabet tile):
```html
      <button class="mode primary" data-go="learn">
        <span class="ic">📖</span>
        <span class="m-txt"><b>Learn to Read</b><i>Start here — the alphabet, by reading</i></span>
        <span class="badge" id="b-learn">Lesson 1</span>
      </button>
```
And add the view section alongside the others:
```html
    <section class="view" id="view-learn" hidden><div class="card-stage" id="learn-stage"></div></section>
```

- [ ] **Step 2: Load the lessons data + import learn.js in `site/app.js`**

At the top imports, add:
```javascript
import { readableWords, miniTest } from "./learn.js";
```
Add `let LESSONS = [];` near the other dataset `let` declarations. In `loadData()`'s `Promise.all`, add a fetch and assign:
```javascript
    fetch("data/reading_lessons.json").then((x) => x.json()).catch(() => []),
```
(append as the last array element, and add `, les` to the destructured names, then `LESSONS = les || [];`).

Add `"learn"` to the `show()` view-id list (line ~97):
```javascript
  for (const id of ["home", "reviews", "alphabet", "listen", "reading", "patterns", "learn"]) {
```
And in `show()`'s dispatch, add: `if (view === "learn") loadLearn();`

- [ ] **Step 3: Add `loadLearn` (lesson list) to `site/app.js`**

Add near the other mode loaders:
```javascript
// ---------- Learn to Read ----------
const ALPHA = {}; // cyrillic -> letter object, built on first use
function alphaIndex() {
  if (!Object.keys(ALPHA).length) for (const l of ALPHABET) ALPHA[l.cyrillic] = l;
  return ALPHA;
}

function lettersKnownIn(lesson) {
  return lesson.letters.filter((c) => isKnown(P.letters[c])).length;
}

function loadLearn() {
  const stage = $("#learn-stage");
  if (!LESSONS.length) {
    stage.innerHTML = `<div class="empty">No lessons available yet.</div>`;
    return;
  }
  stage.innerHTML =
    `<h2 class="learn-h">Learn to Read</h2>` +
    LESSONS.map((les) => {
      const known = lettersKnownIn(les);
      return `<button class="lesson-row" data-lesson="${les.id}">
        <span class="lesson-ttl"><b>Lesson ${les.id}</b><i>${les.title}</i></span>
        <span class="lesson-prog">${known}/${les.letters.length} letters</span>
      </button>`;
    }).join("");
  stage.querySelectorAll(".lesson-row").forEach((b) => {
    b.onclick = () => startLesson(LESSONS.find((l) => l.id === Number(b.dataset.lesson)));
  });
}
```

- [ ] **Step 4: Add styles to `site/style.css`**

Append:
```css
/* Learn to Read */
.learn-h { font-size:22px; margin:6px 0 14px; }
.lesson-row { display:flex; align-items:center; width:100%; text-align:left; gap:12px;
  background:var(--glass); border:1px solid var(--line); color:var(--ink);
  border-radius:16px; padding:16px; margin:10px 0; cursor:pointer; }
.lesson-ttl { display:flex; flex-direction:column; }
.lesson-ttl i { font-style:normal; font-size:12px; color:var(--muted); }
.lesson-prog { margin-left:auto; font-size:12px; color:var(--muted); }
.letter-card .big { font-size:72px; }
.letter-group { font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:var(--amber); }
.letter-hint { font-size:16px; margin-top:10px; }
.letter-hint b { color:var(--ink); }
.word-card .big { font-size:52px; letter-spacing:.04em; }
.word-emoji { font-size:64px; margin:10px 0; }
.mini-flag { font-size:12px; color:var(--amber); text-transform:uppercase; letter-spacing:.08em; margin-bottom:8px; }
```

- [ ] **Step 5: Syntax check**

Run: `node --check site/app.js`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add site/index.html site/app.js site/style.css
git commit -m "feat(learn): module shell — home tile, view, lesson list"
```

---

### Task 5: Frontend — letter-intro, word-decoding cards + mini-test flow

**Files:**
- Modify: `site/app.js` (the lesson runner)

**Interfaces:**
- Consumes: `loadLearn` (back target), `readableWords`/`miniTest`, `alphaIndex`, the scheduler (`newCard`/`answer`/`isKnown`), `play`.
- Produces: `startLesson(lesson)` — runs letters → words → mini-test.

- [ ] **Step 1: Add the lesson runner to `site/app.js`**

Add after `loadLearn`:
```javascript
let learnSession = null;

function startLesson(lesson) {
  // queue: all letters (intro), then readable words, then a mini-test subset
  const words = readableWords(lesson.words, new Set(lesson.letters));
  learnSession = {
    lesson,
    queue: [
      ...lesson.letters.map((c) => ({ kind: "letter", cyrillic: c })),
      ...words.map((w) => ({ kind: "word", word: w })),
      ...miniTest(words, 6).map((w) => ({ kind: "word", word: w, mini: true })),
    ],
    i: 0,
  };
  nextLearn();
}

function nextLearn() {
  const s = learnSession;
  if (!s || s.i >= s.queue.length) {
    $("#learn-stage").innerHTML =
      `<div class="empty">Lesson complete! 🎉<div class="add"><button class="btn reveal" id="learn-done">Back to lessons</button></div></div>`;
    $("#learn-done").onclick = loadLearn;
    return;
  }
  const item = s.queue[s.i];
  if (item.kind === "letter") renderLetterCard(item.cyrillic);
  else renderWordCard(item.word, item.mini);
}

function advanceLearn() {
  learnSession.i += 1;
  nextLearn();
}

function renderLetterCard(cyrillic) {
  const l = alphaIndex()[cyrillic] || { cyrillic, hint_en: "", hint_word: "", group: "" };
  const groupLabel = { true: "True friend", false: "False friend", new: "New friend", stranger: "Stranger" }[l.group] || "";
  const stage = $("#learn-stage");
  stage.innerHTML = `
    <div class="qcard letter-card">
      <div class="letter-group">${groupLabel}</div>
      <div class="big">${l.cyrillic}${l.cyrillic.toLowerCase()}</div>
      <button class="speak" id="lc-speak" aria-label="Play audio">🔊</button>
      <div class="letter-hint">like the sound in <b>${l.hint_en}</b> — ${l.hint_word}</div>
    </div>
    <div class="btn-row">
      <button class="btn r-again" id="lc-again">Again</button>
      <button class="btn r-good" id="lc-got">Got it ✓</button>
    </div>`;
  play(l.hint_word); // letters DO play on intro
  $("#lc-speak").onclick = () => play(l.hint_word);
  const grade = (ok) => {
    if (!P.letters[cyrillic]) P.letters[cyrillic] = newCard();
    answer(P.letters[cyrillic], ok);
    saveProgress();
    advanceLearn();
  };
  $("#lc-again").onclick = () => grade(false);
  $("#lc-got").onclick = () => grade(true);
}

function renderWordCard(word, mini) {
  const stage = $("#learn-stage");
  stage.innerHTML = `
    ${mini ? `<div class="mini-flag">Mini-test</div>` : ""}
    <div class="qcard word-card">
      <div class="big">${word.ru}</div>
      <div class="hint">Read it out loud, then tap to check.</div>
      <div class="word-reveal" id="word-reveal" hidden>
        <div class="word-emoji">${word.emoji}</div>
      </div>
      <button class="btn reveal" id="wc-check">Tap to check</button>
    </div>
    <div class="btn-row" id="wc-actions" hidden>
      <button class="btn r-again" id="wc-again">Again</button>
      <button class="btn r-good" id="wc-got">Got it ✓</button>
    </div>`;
  // NO autoplay. Audio + emoji only after the learner taps.
  $("#wc-check").onclick = () => {
    $("#word-reveal").hidden = false;
    $("#wc-check").hidden = true;
    $("#wc-actions").hidden = false;
    play(word.ru);
  };
  const grade = (ok) => {
    if (!P.reading[word.ru]) P.reading[word.ru] = newCard();
    answer(P.reading[word.ru], ok);
    saveProgress();
    advanceLearn();
  };
  $("#wc-again").onclick = () => grade(false);
  $("#wc-got").onclick = () => grade(true);
}
```

- [ ] **Step 2: Add `reading` to the progress object + persistence**

In `site/app.js`, the progress object `const P = { vocab: {}, letters: {}, patterns: {}, counter: 0 };` → add `reading: {}`:
```javascript
const P = { vocab: {}, letters: {}, patterns: {}, reading: {}, counter: 0 };
```
In `loadProgress()`, add `P.reading = s.reading || {};`. In `saveProgress()`'s `JSON.stringify`, add `reading: P.reading`.

- [ ] **Step 3: Syntax check**

Run: `node --check site/app.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add site/app.js
git commit -m "feat(learn): letter-intro + word-decoding cards + mini-test flow"
```

---

### Task 6: Remove the standalone Alphabet tile + retire its E2E

**Files:**
- Modify: `site/index.html` (remove the alphabet home tile)
- Modify: `tests/e2e/smoke.spec.js` (it asserts the alphabet tile — swap to `learn`)
- Delete: `tests/e2e/alphabet.spec.js`

**Interfaces:** none.

- [ ] **Step 1: Remove the Alphabet home tile**

In `site/index.html`, delete the `<button class="mode" data-go="alphabet">…</button>` block (its letter-learning is now in the Learn to Read module). Leave the `#view-alphabet` section and the app.js alphabet code in place (dormant, harmless).

- [ ] **Step 2: Update `smoke.spec.js` (it checks for the alphabet tile)**

In `tests/e2e/smoke.spec.js`, the loop asserts each mode tile is visible. Change the list from `["alphabet", "reviews", "listen", "reading", "patterns"]` to:
```javascript
  for (const m of ["learn", "reviews", "listen", "reading", "patterns"]) {
```
(The home now has the `learn` tile instead of `alphabet`.)

- [ ] **Step 3: Delete the now-invalid alphabet E2E**

```bash
git rm tests/e2e/alphabet.spec.js
```
(The new module's letter cards are covered by `learn-to-read.spec.js` in Task 7.)

- [ ] **Step 4: Confirm + verify the home no longer references alphabet**

Run: `grep -c 'data-go="alphabet"' site/index.html` → expect `0`.
Run: `npx playwright test smoke` → expect 1 passed (now checks the `learn` tile).

- [ ] **Step 5: Commit**

```bash
git add site/index.html tests/e2e/smoke.spec.js
git commit -m "feat(learn): retire standalone Alphabet tile (folded into module)"
```

---

### Task 7: E2E — `learn-to-read.spec.js`

**Files:**
- Create: `tests/e2e/learn-to-read.spec.js`

**Interfaces:**
- Consumes: `gotoApp` (helpers). Reads `reading_lessons.json` via `loadData` for expected values.

- [ ] **Step 1: Write the spec**

`tests/e2e/learn-to-read.spec.js`:
```javascript
import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const LESSONS = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "site", "data", "reading_lessons.json"), "utf8")
);

test("Learn to Read: letter card, then word card reveals emoji + audio ONLY on tap", async ({ page }) => {
  await gotoApp(page);
  await page.locator('[data-go="learn"]').click();
  await page.locator('.lesson-row[data-lesson="1"]').click();

  // First card is a letter intro (the lesson's first letter).
  await expect(page.locator(".letter-card .big")).toContainText(LESSONS[0].letters[0]);
  await expect(page.locator(".letter-hint")).toBeVisible();
  await page.locator("#lc-got").click();

  // Step through remaining letters to reach the first word card.
  for (let i = 0; i < LESSONS[0].letters.length; i++) {
    const got = page.locator("#lc-got");
    if (await got.count()) await got.click();
    else break;
  }

  // Word card: NO audio request before tapping.
  const wordBig = page.locator(".word-card .big");
  await expect(wordBig).toBeVisible();
  let audioFired = false;
  page.on("request", (r) => { if (/\/audio\/.*\.mp3/.test(r.url())) audioFired = true; });
  await page.waitForTimeout(400);
  expect(audioFired, "reading word must not autoplay").toBeFalsy();

  // Tap to check -> emoji reveals AND an audio request fires.
  const audioReq = page.waitForRequest(/\/audio\/.*\.mp3/, { timeout: 5000 });
  await page.locator("#wc-check").click();
  await expect(page.locator(".word-emoji")).toBeVisible();
  await audioReq;
});
```

- [ ] **Step 2: Run it**

Run: `npx playwright test learn-to-read`
Expected: 1 passed. (If the "no autoplay" assertion fails, the word card is autoplaying — a real bug.)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/learn-to-read.spec.js
git commit -m "test(e2e): Learn to Read — letter card + tap-to-reveal (no autoplay)"
```

---

### Task 8: Service worker + integrity guards

**Files:**
- Modify: `site/sw.js` (cache bump + add lessons data)
- Modify: `tests/test_dataset_integrity.py` (guards for the new data)

**Interfaces:** none.

- [ ] **Step 1: Bump the SW cache + precache the lessons file**

In `site/sw.js`: change `const CACHE = "ruslearn-v5";` to `"ruslearn-v6";`, and add `"./data/reading_lessons.json",` to the `SHELL` array.

- [ ] **Step 2: Add integrity guards**

Append to `tests/test_dataset_integrity.py`:
```python
def test_reading_lesson_words_have_emoji_and_audio():
    audio = _load("audio.json")
    lessons = _load("reading_lessons.json")
    for lesson in lessons:
        for w in lesson["words"]:
            assert w.get("emoji"), f"word missing emoji: {w}"
            assert w["ru"] in audio, f"word missing audio: {w['ru']}"


def test_every_letter_has_a_pronunciation_hint():
    alphabet = _load("alphabet.json")
    for l in alphabet:
        assert l.get("hint_en") is not None and l.get("group"), f"letter missing hint/group: {l['cyrillic']}"
```

- [ ] **Step 3: Run the integrity tests**

Run: `.venv/bin/python -m pytest tests/test_dataset_integrity.py -q`
Expected: 8 passed.

- [ ] **Step 4: Commit**

```bash
git add site/sw.js tests/test_dataset_integrity.py
git commit -m "feat(learn): sw cache v6 + integrity guards for lesson data"
```

---

## Self-review notes
- **Spec coverage (Phase 1 slice):** module shell + home placement (T4); alphabet hints + Lesson 1 data with emoji (T1); letter-intro card with hint+audio (T5); word-decoding card read→tap→emoji+audio, no autoplay (T5, guarded by T7); mini-test (T5 via `miniTest`); audio pre-render, tap-only (T3); remove Alphabet tile (T6); integrity + E2E (T7, T8). Lessons 2–3 / Numbers / Find-the-Word / Mixed Review are explicitly later phases.
- **Determinism / no-autoplay:** the E2E asserts no `/audio/*.mp3` request before tapping the word card — the direct guard for her key rule.
- **Scheduler reuse:** letters → `P.letters`, words → `P.reading`, both via `answer()`; no new scheduler.
- **No translations:** word card shows only the Russian word + emoji; no English gloss anywhere in the module.
