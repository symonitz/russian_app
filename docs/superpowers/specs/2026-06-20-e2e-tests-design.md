# E2E Functional Test Suite — Design

**Date:** 2026-06-20
**Status:** Approved (design); pending spec review
**Branch:** `feat-e2e-tests`

## Goal

The pure logic (worker session/merge/body/feedback, the accent converters) is unit-tested, but the **actual app behavior** — every learning mode in `site/app.js` — is verified only by manual browser previews. Add automated **end-to-end functional tests** that drive the real app through user journeys, so regressions in the daily-use core are caught automatically, plus cheap dataset-integrity guards.

## Scope

- **In scope:** the five learning modes — Alphabet, Reviews, Listen, Reading, Patterns — which run entirely off the static site + `localStorage` (no backend).
- **Out of scope (non-goals):** accounts/Google sign-in, cross-device sync, and feedback submission. They depend on Google Identity, Cloudflare Turnstile, and the D1 worker; automating them means mocking three external services — brittle and high-effort for flows that change rarely. Those stay covered by the existing worker unit tests + manual checks.

## Tooling

- **Playwright** (`@playwright/test`, headless Chromium), added as a devDependency. Tests written in plain **JS** (`.spec.js`) to match the repo (no TypeScript).
- **`playwright.config.js`**: a `webServer` block runs `python3 -m http.server <port> --directory site` and sets `baseURL` to it, so tests hit the real static app. `reuseExistingServer` locally; `retries: 1` in CI.
- The existing `pytest` suite and `node --test` worker suite stay as-is; this adds a parallel layer.

## Determinism strategy (the key to non-flaky E2E)

- **Seed state, don't click through setup.** Each test seeds `localStorage["ruslearn.v2"]` via `page.addInitScript(...)` *before* navigation, to put the app in a known state (e.g. mark word ids 1–15 "known" so Reading unlocks). This is the same technique used to verify the stress feature manually.
- **Derive expectations from real data, not hardcoded strings.** A helper reads `site/data/*.json` (words, reading, patterns) in Node, so the test knows the actual word ids, glosses, passage tokens, and correct pattern tile order. Assertions look up the right answer from the data, so they survive content changes.
- **Randomness:** the app uses `Math.random` for tile shuffle and "all-met" pattern pick. Tests find tiles/words by their text (read from the DOM/data) rather than by position, so shuffle order doesn't matter. No need to stub `Math.random`.

## Journeys (each guards a specific regression)

Each spec drives the real UI and asserts observable outcomes:

1. **`alphabet.spec.js`** — open Alphabet; a letter card renders; reveal shows the romanization/example; "mark known" updates the `0 / 33` badge and home progress.
2. **`reviews.spec.js`** — seed a due word; the card shows its `stressed` form; type the **correct** English meaning → `✓` verdict + Next appears; restart, type a **wrong** meaning → `✗` verdict + "I was right" + Next both present; tapping Next advances to a different card (scheduler moved the answered card's `due`).
3. **`reading.spec.js`** — with empty progress, Reading shows the **"learn a few words first" gate**; seed known words → a passage renders; assert **at least one combining-acute stress mark is present** in the passage; **tap a word → the gloss popup shows the correct meaning** (guards the `stripAccent` glossary lookup shipped in the accents feature); "Got it — next" advances to a new passage.
4. **`listen.spec.js`** — seed a word; the Listen card renders; after pressing play, an `<audio>` element exists with a non-empty `src` under `audio/` (guards audio-key/`stripAccent` resolution); typing the correct meaning validates.
5. **`patterns.spec.js`** — open Patterns; a frame header + English prompt render; read the expected answer from `patterns.json`, tap the answer tiles **in order** (found by text); assert the `✓` reveal with the spoken form + super-literal gloss appears; Next/Done advances.

## Dataset-integrity guards (the cheap complement)

`tests/test_dataset_integrity.py` (pytest) asserts invariants over the built `site/data/*.json`, so a future build can't silently break them:

- For every word, `strip_acute(word["stressed"]).lower()` (or its cased form) **resolves to a clip** present in `audio.json`.
- **No `audio.json` key contains the combining acute** U+0301.
- Every reading-passage word token (markers stripped, accents stripped, lowercased) resolves to **either a glossary entry or an audio clip**.
- Every pattern item's `answer` is a non-empty list, and each answer word has an audio clip.
- (These reuse `strip_acute`/`audio_key` from `src/ruslearn/accent.py`.)

## CI

`.github/workflows/test.yml` runs on push + PR:
1. Python (the build/data logic that feeds the PWA): `pytest tests/test_accent.py tests/test_accent_dataset.py tests/test_dataset_integrity.py`. The legacy M1 FastAPI-backend tests (`test_lexicon`/`test_srs`/`test_seed`/`test_tts`/`test_gemini`/`test_api`/`test_reader`/`test_alphabet`) cover a backend that is **not deployed** (the product is the static PWA + Cloudflare worker), so they are out of CI scope — keeping CI hermetic and fast.
2. Node: `npm ci`, `npm test` (worker unit tests).
3. Playwright: `npx playwright install --with-deps chromium`, then `npx playwright test`.

So the suite actually guards the repo, not just sits there. (If local-only is preferred, drop this file; everything else stands.)

## File structure
```
playwright.config.js
tests/e2e/helpers.js          # seedProgress(page, vocabIds), loadData()
tests/e2e/alphabet.spec.js
tests/e2e/reviews.spec.js
tests/e2e/reading.spec.js
tests/e2e/listen.spec.js
tests/e2e/patterns.spec.js
tests/test_dataset_integrity.py
.github/workflows/test.yml
package.json                  # +@playwright/test devDep, +"test:e2e" script
```

## Risks / mitigations
- **Flaky audio in headless:** don't assert audio *plays*; assert the `<audio>` element has a resolved `src` (the lookup succeeded). Audio playback itself is browser-driven and out of scope.
- **Data drift breaking seeds:** seeds reference word *ids* (stable, freq-rank based) and derive everything else from data, so content regeneration won't break tests.
- **CI Playwright weight:** pin to chromium-only with `--with-deps` to keep CI install bounded.

## Testing strategy (for the tests themselves)
The E2E specs ARE the verification; we confirm the harness works by running the full suite locally green before merge, and by intentionally checking one spec fails if a known invariant is violated (e.g. temporarily break a gloss key) during development.
