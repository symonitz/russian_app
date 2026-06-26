# Accurate Stress + ё Restoration — Design

**Date:** 2026-06-20
**Status:** Approved (design); pending spec review
**Branch:** `feat-accents`

## Goal

Real-user feedback (first Reddit post) named **unpredictable stress** and **ё-written-as-е** as top beginner pains. Our own data confirms the defect: only ~12 of 500 words contain ё, and reading passages carry no stress at all. Fix both by running every Russian string through **RUAccent** (validated working via spike, no torch needed — runs on onnxruntime) to produce stress-marked, ё-restored text, displayed across vocab, reading, and patterns.

## Key primitives

RUAccent outputs stress as `+` *before* the vowel (`магаз+ин`, `вс+ё`). We need two derived forms from each input string:

- **`accentize(text)`** → display form with a combining acute (U+0301) *after* the stressed vowel, ё restored. Conversion rule:
  - `+` before ё → drop the `+` (ё is inherently stressed; no acute). `вс+ё` → `всё`.
  - `+` before any other vowel → vowel + U+0301. `магаз+ин` → `магази́н`.
  - single-syllable words get no `+` from RUAccent → unchanged.
- **`audio_key(text)`** = `accentize(text)` with all combining-acute marks stripped (ё kept). This is the canonical key for audio and glossary lookups.

Both are built on one pure, tested converter; `audio_key` = `strip_acute(accentize(text))`.

## Why this is contained (the audio insight)

Audio is keyed by raw text today (`collect_audio_texts` keys by `w["stressed"]`, passage, `say`, tokens). Because **`audio_key` strips the acute**, a non-ё word's key is unchanged (`раб+о́та` → `работа`, same as today) → **its existing clip is reused**. Only words whose **ё** was restored get a new key (`все`→`всё`) and thus a freshly generated clip — a few dozen, handled automatically by the incremental TTS build. (Also the ~12 words that already carried an acute in `stressed` get re-keyed to their stripped form; trivial.)

## Components

### Build pipeline (`src/ruslearn/` + `tools/build_dataset.py`)
- New module `accent.py`: `accentize(text)`, `strip_acute(text)`, `audio_key(text)`, holding a single lazily-loaded RUAccent instance.
- **Words:** `stressed` = `accentize(cyrillic-or-current-form)`. (The `cyrillic` id field stays as-is.)
- **Reading:** `passage` → accentize the words but **preserve the `[[ ]]` new-word markers**; rebuild `glossary` keys via `audio_key` (ё-restored, accent-stripped, lowercased) so taps still resolve.
- **Patterns:** `say` = accentize (display). `answer` tiles + `prompt` matching stay **plain text but ё-restored** (so tile-vs-answer comparison stays consistent); no acute on tiles.
- **Audio:** `collect_audio_texts` keys everything by `audio_key`. Re-run build → only ё-changed (and the ~12 re-keyed) texts generate new clips; the other ~750 are reused from cache.

### Frontend (`site/app.js`)
- Add `stripAccent(s)` (remove U+0301).
- `play(text)`: look up `AUDIO[stripAccent(text)]` (ё preserved). All existing `play(word.stressed)` / `play(token)` callers then work unchanged.
- Reading tap-to-gloss: `glossary[stripAccent(w).toLowerCase()]`.
- Reading render shows the accentized `passage` (stress visible to the learner, as requested). The existing tokenizer already keeps combining marks inside tokens (`[\p{L}\p{M}]+`), so rendering + tap targets are unaffected.

## Non-goals (YAGNI)
- Perfect homograph disambiguation (за́мок/замо́к) — rare in beginner content; teacher spot-checks. Add torch later only if errors show up.
- Switching TTS to Piper (separate, deferred decision).
- Cursive mode, minimal-pair drills, vocab pictures — backlog from the same feedback round.

## Error handling
- `accentize` failure on a string → fall back to the original text (never crash the build); log it.
- RUAccent load happens once per build run.

## Testing
- **Pure converter (TDD):** `+`→acute conversion, ё special-case (drop `+`, no acute), multi-`+` strings, strip_acute round-trip, audio_key = ё-kept/acute-removed. Use fixed RUAccent-style inputs (no model needed in tests).
- **Manual after build:** spot-check ё restored (всё/ещё/её/идёт), stress correct on a sample; confirm in the live preview that audio still plays for a non-ё word and a ё word, tap-to-gloss still resolves, and reading shows stress marks.

## Validation gate (data-first)
Before the full run, accentize a 20-item sample and eyeball it (the spike already did this once and passed). Then run all, and have the teacher review the output as part of her phrase-check.
