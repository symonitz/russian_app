# Patterns ("Speak") Mode — Design Spec

**Date:** 2026-06-15
**Status:** Draft for review
**Context:** Add a fifth practice mode that teaches the way *Russian Made Easy* does — **production through sentence patterns**. The learner is prompted in English, builds the Russian by tapping word-tiles into order, then drills the same frame via substitutions, with audio + a super-literal word-by-word gloss. Sits beside Alphabet · Reviews · Listen · Reading; nothing is replaced.

---

## 1. Goal

Flip the learner from *understanding* Russian to *producing* it. A session:
1. Show a **frame** (`Я хочу ___` = "I want ___").
2. Prompt: *"Say: I want coffee"* → learner **taps word-tiles** to build `Я хочу кофе` → check.
3. Reveal: **audio** + super-literal gloss (`Я` I · `хочу` want · `кофе` coffee).
4. **Substitution rounds** on the same frame (*"now: I want tea"*) so the structure sticks without grammar tables.

Production via tap-build (not speech, not multiple-choice meaning): phone-friendly, no Cyrillic keyboard, and it teaches word order.

## 2. Non-goals (this phase)

- No speech recognition / spoken production (tap-build only).
- No new backend — it's a baked static dataset like the sentences (works with the current static PWA *and* the accounts branch, independently).
- No grammar tables / explicit case drills — patterns only.
- Not replacing any mode.

## 3. Architecture

A new **`Patterns` mode** in the static app (Midnight theme), driven by a baked dataset:

- **`site/data/patterns.json`** — generated at build time (Gemini for frames + substitutions + super-literal glosses; edge-tts for audio), exactly like `reading.json`.
- Audio reuses the existing `audio.json` manifest + `play()` — each substitution sentence gets a clip.
- **Scheduling reuses the count-based engine** (`P.counter`, `newCard`, `answer`, `dueNow`): patterns are cards in a new `P.patterns` map, so "no points, just flow" applies here too.
- New frontend view + a fifth home tile; tap-build interaction; shared `tokenizeHTML`/`play` where useful.

## 4. Data shape (`patterns.json`)

An array of pattern lessons:

```json
[
  {
    "id": 1,
    "frame": "Я хочу ___",
    "frame_gloss": "I want ___",
    "distractors": ["это", "нет"],
    "items": [
      {
        "prompt": "I want coffee",
        "answer": ["Я", "хочу", "кофе"],
        "say": "Я хочу кофе",
        "gloss": [["Я", "I"], ["хочу", "want"], ["кофе", "coffee"]]
      },
      { "prompt": "I want tea",   "answer": ["Я","хочу","чай"],  "say": "Я хочу чай",   "gloss": [["Я","I"],["хочу","want"],["чай","tea"]] },
      { "prompt": "I want water", "answer": ["Я","хочу","воду"], "say": "Я хочу воду", "gloss": [["Я","I"],["хочу","want"],["воду","water"]] }
    ]
  }
]
```

- `answer` is the **target word order** the tap-build must match.
- `distractors` are 1–2 plausible extra tiles mixed into the bank (so it isn't "use every tile").
- Fixed phrases with no slot (e.g. *"Я не понимаю"* = "I don't understand") are a pattern with a single item and no substitutions — still valid.
- `say` is the audio-manifest key (rendered to a clip).

## 5. Session flow (frontend)

- Pick the next **due** pattern (or introduce the next new one) via the count-based scheduler.
- Show the frame header (`Я хочу ___` · "I want ___") for a beat.
- For up to **3 items** of that pattern (substitution rounds): prompt → tap-build → **Check**.
  - **Correct** (built order === `answer`): show ✓, the sentence, a 🔊 (auto-plays once), the super-literal gloss, then **Next**.
  - **Wrong**: "not quite — tap to rearrange" (let them fix; no penalty beyond the count).
- After the items, the pattern is graded once (count-based: completed → `good` → resurfaces ~100 cards later; struggled → sooner). Then the next pattern.
- Tiles: tap a bank tile → moves to the answer line (in order); tap an answer tile → returns it to the bank.

## 6. Seed frames (starter set, ~12)

Curated high-value beginner frames; Gemini fills 4–6 substitutions + glosses each, using common/known words:

`Я хочу ___` (I want) · `Это ___` (this is) · `Где ___?` (where is) · `У меня есть ___` (I have) · `Я люблю ___` (I like) · `Мне нужно ___` (I need) · `Можно ___?` (may I) · `Сколько стоит ___?` (how much is) · `Я из ___` (I'm from) · `Я не понимаю` (fixed) · `Как сказать ___?` (how do you say) · `Я хочу пойти в ___` (I want to go to).

Expandable later (one list in the builder).

## 7. Build pipeline (`tools/build_dataset.py` extension)

- A `FRAMES` seed list (the frames above).
- For each frame, Gemini generates the substitution `items` (prompt, answer word-array, say, super-literal gloss) using common words; returns JSON; resumable + checkpointed like reading.
- Collect each item's `say` into the audio texts; render with edge-tts (reuses the cache/manifest).
- Write `site/data/patterns.json`.

## 8. Frontend integration

- **`site/index.html`** — add a `Patterns` tile to the home grid and a `#view-patterns` section.
- **`site/app.js`** — `loadPatterns` / `renderPattern` / tap-build + check + reveal + substitution; `P.patterns` in load/save; add `"patterns"` to `show()`.
- **`site/style.css`** — word-tile + answer-line styles (Midnight); reuse `.btn`, `.qcard`, `.speak`.
- **`site/sw.js`** — add `patterns.json` to the precache shell.

## 9. Testing

- **Unit (`node --test`):** the tap-build check (built order vs target), bank/answer move logic, and a small "patterns dataset is well-formed" check (every item's `answer` joined ≈ `say` minus spaces; gloss covers each answer word).
- Pattern scheduling reuses the already-tested count-based `answer`/`dueNow`.
- **Browser smoke:** build a sentence, check, reveal, substitution round, no console errors (headless preview).

## 10. Milestones

- **M1 — Patterns dataset:** `FRAMES` + builder extension → `patterns.json` + audio (generated, spot-checked for quality).
- **M2 — Patterns mode UI:** home tile + view + tap-build + check + reveal + substitution + count-based scheduling.
- **M3 — Polish:** frame intro, "pattern complete" transition, progress, error/empty states.

## 11. Risks / notes

- **Content quality:** Gemini substitutions/glosses need a spot-check (same as sentences) — wrong word order or a bad gloss is worse here since it's what the learner produces.
- **Distractor quality:** distractors should be plausible (real words), not gibberish — generated alongside.
- **Independence:** this is purely frontend + static data; it layers cleanly on top of the current app and does not depend on (or block) the accounts+sync branch.
