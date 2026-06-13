# Russian Learning Platform — Design Spec

**Date:** 2026-06-13
**Status:** Approved design, pending implementation plan
**Research backing:** [docs/research/learning-principles-brief.md](../../research/learning-principles-brief.md) (13-agent web-sourced, fact-checked brief)

---

## 1. Goal

A **personal, local, single-user web app** for learning Russian **from zero**. The core idea: the app tracks exactly which Russian words I know, and everything it shows me is built almost entirely from those known words plus a few new ones — true comprehensible input. Spaced repetition introduces and locks in vocabulary; reading consolidates it. English explanations throughout, audio on every word, and a dark "Midnight" interface.

This is a tool I use **while figuring out the best principles for learning** — so the learning parameters (coverage threshold, new-words/day, retention target) are tunable knobs, and the app logs enough to let me tune them against my own data.

## 2. Non-goals (YAGNI)

- **No accounts / auth / multi-user.** Single learner, one local profile.
- **No cloud database.** Local SQLite file.
- **No native mobile app.** Responsive web, runs locally.
- **No speaking/pronunciation scoring (ASR)** in the initial product.
- **No automated prompt/parameter optimization** that changes things behind my back — knobs are explicit.
- **No social/gamification beyond a simple streak.**

## 3. Learning principles baked in (the "why")

Sourced from the research brief; the brief has citations.

- **Comprehensible input at ~98% known-word coverage** (≈1 new word per ~50). Below ~95% comprehension degrades. This is a *tunable default*, not gospel.
- **SRS introduces, reading consolidates.** Incidental reading alone is slow and decays; flashcards front-load vocab, reading reinforces. → Build **Reviews before Reading**.
- **Words need many spaced encounters** (~8–18+). "Introducing" a word means engineering its recurrence in future passages.
- **Pair text with audio always.** Reading-while-listening beats reading-only.
- **Stress marks on all Russian from day one** (stress is lexically unpredictable and drives vowel reduction), then *wean off* per word as it's mastered.
- **Personalize difficulty per word, not by one global level.** A known word in a new grammatical form can itself be a new step (deferred to later phase).
- **Light output + explicit explanation help** — short type-the-word / cloze tasks and one-line English grammar notes.

## 4. Architecture

```
┌────────────────────────── Browser (Midnight UI, vanilla JS) ──────────────────────────┐
│   Alphabet trainer   │   Reviews (flashcards)   │   Reading (generated passages)        │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                             │ HTTP (JSON)
┌────────────────────────────────────────────▼───────────────────────────────────────────┐
│                              FastAPI app (local, localhost)                              │
│  API routes  ─────────────────────────────────────────────────────────────────────────  │
│                                                                                          │
│   LexiconStore    SRSService      ContentGenerator     NLPService     TTSService         │
│   (words +        (py-fsrs        (LLM + hard          (pymorphy3     (edge-tts +        │
│    knowledge)      wrapper)        coverage filter)     lemmatize,     disk cache)        │
│                                    │                    RUAccent)      │                  │
│                                    └── LLMProvider ◄─ Anthropic (default), pluggable      │
│   AlphabetModule   SeedImporter (frequency list, cognates, stress data)                  │
└────────────────────────────────────────────┬───────────────────────────────────────────┘
                                              │
                                   SQLite (data/russian.db)  +  data/tts/*.mp3 cache
```

**Tech stack:** Python 3.11+, FastAPI + uvicorn, Pydantic v2, SQLite (via SQLAlchemy), `structlog`, `pytest`. Frontend: plain HTML/CSS/JS (no heavy framework, no build step required) with a single Midnight theme stylesheet. `async/await` throughout; type hints everywhere; `pathlib` for paths.

### Components (each one purpose, testable in isolation)

| Component | Responsibility | Key deps |
|---|---|---|
| **LexiconStore** | CRUD for lemmas + per-lemma knowledge state | SQLAlchemy |
| **SRSService** | Wrap FSRS: schedule, review, due-query | `fsrs` (py-fsrs) |
| **NLPService** | Tokenize + lemmatize Russian; annotate stress; freq score | `pymorphy3`, `ruaccent`, `wordfreq` |
| **ContentGenerator** | Generate a passage at target coverage; enforce constraint via NLP; cap retries | LLMProvider + NLPService |
| **LLMProvider** | Model-agnostic `complete()`; default Anthropic Claude | `anthropic` |
| **TTSService** | Synthesize Russian audio for a (stressed) string; cache to disk | `edge-tts` (Google Cloud TTS fallback) |
| **AlphabetModule** | Cyrillic curriculum (4 buckets) + letter knowledge | LexiconStore/SRSService |
| **SeedImporter** | Import frequency list, cognates, stress data into the lexicon | `wordfreq`, static data files |
| **API layer** | FastAPI routes wiring the above to the UI | FastAPI |

## 5. Data model (SQLite)

- **lemma** — `id, cyrillic, stressed_form, translit, gloss_en, pos, aspect (verbs), zipf_freq, cefr, is_cognate, notes`
- **knowledge** — `lemma_id, state (new|learning|known|mastered), fsrs_card (json: stability, difficulty, due, last_review, reps, lapses), times_seen_reading, added_at`
- **review_log** — `id, lemma_id, rating (again|hard|good|easy), reviewed_at, elapsed_days, fsrs_state_snapshot` *(required for the FSRS optimizer later — never discard)*
- **passage** — `id, text_stressed, lemma_ids (json), new_lemma_ids (json), coverage (float), created_at, comprehension_rating (nullable)`
- **letter** — `id, cyrillic, ipa, bucket (1-4), friend_type (true|false|new), latin_lookalike, example_word`
- **letter_knowledge** — `letter_id, state, fsrs_card (json)`
- **settings** — `key, value` (desired_retention, new_words_per_day, coverage_target, voice, etc.)
- TTS cache lives on disk: `data/tts/<sha1(text|voice|rate)>.mp3`

**Known-set is keyed on lemma.** Russian is heavily inflected, so all coverage math lemmatizes first (книга/книги/книгу → книга). Treating a known lemma in an unseen case/aspect as its own new step is a **Phase-3** refinement.

## 6. Core flows

### 6a. Alphabet trainer (M1)
Teach Cyrillic in four research-backed buckets, recognition-first:
1. **True friends** (А К М О Т) — immediately spell real words (КОТ, МАК, ТОМ).
2. **False friends** (В Н Р С У Х, Е) — taught as explicit "looks like X, sounds like Y" contrast cards, given extra SRS exposure (biggest source of decoding errors).
3. **Unfamiliar shape / familiar sound** (Б Г Д З И Й Л П Ф Э).
4. **New sounds + signs** (Ж Ц Ч Ш Щ Ы, iotated Ё Ю Я, Ъ Ь).

Drills: letter→sound and sound→letter, FSRS-scheduled, with contrast cards for false friends. Transliteration is a crutch that is **sunset within the first ~3–7 days**, replaced by stress marks + audio.

### 6b. Reviews — flashcards (M1)
- SRSService surfaces due lemmas. Card front: stressed Russian word + audio → recall English meaning → flip → rate **Again / Hard / Good / Easy** (a 2-button Again/Good mode is acceptable for a beginner).
- New words enter from a **frequency-ordered seed list**, throttled by `new_words_per_day` (default 5), seeded first with ~30–50 transparent **cognates** (ресторан, телефон) for instant early wins.
- Every review writes a `review_log` row.

### 6c. Reading — generated passages (M2) — the "smart" core
Generation pipeline (each step isolated and testable):
1. **Select targets:** pick 1–3 new lemmas due for introduction (from SRS queue / next frequency words) + the current known-set.
2. **Generate:** LLMProvider writes a short passage instructed to use ~98% known words + the chosen new ones.
3. **Enforce (don't trust the prompt):** NLPService tokenizes → lemmatizes → diffs against known-set. If a sentence exceeds the new-word budget, **regenerate or post-edit** (cap at N=3 attempts; then serve best attempt and log the coverage shortfall).
4. **Annotate stress** with RUAccent (~0.97 acc); spot-check rare words/names.
5. **Synthesize audio** with edge-tts (cached on disk); word-boundary timings enable karaoke-style highlighting.
6. **Render:** tap any word → hear it + see gloss; tap a new/unknown word → it's added to the SRS queue. Rate comprehension (feeds tuning).
- Words seen while reading are logged as a **light exposure signal** that can gently nudge due dates — never silently graduate a word to "mastered."

## 7. LLM generation detail

- `LLMProvider.complete(system, user, model=None, temperature=0.0) -> LLMResponse` (content, tokens, latency, model). Default provider: **Anthropic Claude** (latest model id, e.g. `claude-opus-4-8` / a fast model for generation — chosen at config time). Pluggable for GPT/Gemini.
- Prompt carries: the new target word(s) with glosses, a representative slice of the known-set, hard constraints, and a requested output shape (passage + the new words it used). The **NLP coverage filter is the source of truth**, not the model's self-report.

## 8. TTS detail

- **Primary:** `edge-tts`, voices **ru-RU-SvetlanaNeural** / **ru-RU-DmitryNeural** (alternate). Free, no key, neural quality, word-boundary timings. Feed it the **stressed** form.
- **Cache** every clip on disk keyed by `sha1(text|voice|rate)` → removes latency and dodges rate limits.
- **Fallback:** Google Cloud TTS (official, SSML `<phoneme>` IPA to force stress on ambiguous words) — optional, config-gated.
- The browser Web Speech API is **not** used (inconsistent Russian voices) except as a last-resort emergency path. Playback speed (~0.75× for shadowing) is controlled in the client, not by re-synthesizing.

## 9. Seed data & import

- **Frequency spine:** hermitdave OpenSubtitles `ru_50k` (non-commercial — fine for a personal app; keep an attribution/license file). Lemmatize on import; attach `zipf_freq` via `wordfreq`; map CEFR via the **Kelly** list (CC BY-NC-SA) where available.
- **Cognates:** harvest Wiktionary "Russian terms borrowed from English" + "internationalisms" categories, intersect with top ~3,000 frequency entries; encode suffix rules (-ция↔-tion, -ика↔-ics) so the engine can explain *why* a word is guessable.
- **Stress data:** OpenRussian/Badestrand dataset (CC BY-SA) for accented forms where available, else RUAccent at runtime.
- A `LICENSES.md` records each source's license. All sources used are non-commercial-OK; swap before any monetization.

## 10. Error handling & offline

- **LLM failure:** retry with backoff; if exhausted, serve a pre-generated/seed passage and surface a gentle notice.
- **Coverage unmet after N retries:** serve best attempt, log the shortfall (data for tuning), flag passage.
- **TTS failure:** try fallback voice/provider; last resort, show text without audio.
- **Unknown lemma from morph analyzer:** treat surface form as its own lemma, flag for review.
- **Offline:** Alphabet trainer + Reviews work **fully offline**. Reading needs network for new generation/audio (cached passages/audio still work offline).

## 11. Settings (defaults)

| Setting | Default | Range |
|---|---|---|
| `desired_retention` | 0.90 | 0.80–0.95 slider |
| `new_words_per_day` | 5 | configurable |
| `coverage_target` | 0.98 | 0.95 in deliberate-learning mode; never < 0.90 |
| `voice` | ru-RU-SvetlanaNeural | Svetlana / Dmitry |
| `stress_weaning` | on | per-word, after mastery |

## 12. Milestones (build order)

- **M1 — Offline core (no LLM, no network):** LexiconStore, SRSService (py-fsrs), AlphabetModule + trainer UI, Reviews UI, SeedImporter (frequency list + cognates), Midnight UI shell. *Fully usable: learn the alphabet and drill seeded vocab.*
- **M2 — Smart reading:** NLPService (lemmatize + stress), ContentGenerator + hard coverage filter, LLMProvider (Anthropic), TTSService (edge-tts + cache), Reading UI with tap-to-hear / tap-to-add.
- **M3 — Polish:** stats/streak dashboard, settings UI, stress-weaning, one-line grammar notes, comprehension logging + tuning view, FSRS optimizer run (after enough review logs), case-as-i+1 refinement.

## 13. Testing strategy

- **Unit:** LexiconStore CRUD; SRSService scheduling (deterministic, fixed clock); NLPService coverage filter (known-set + text → correct new-word set, lemmatization of inflected forms); SeedImporter parsing; AlphabetModule bucket ordering.
- **Mocked LLM + TTS** for ContentGenerator/Reading: provider returns a canned passage; assert the coverage filter accepts/regenerates correctly.
- **Integration:** generate → filter → stress-annotate pipeline end-to-end with a mocked LLM and a small fixed known-set.
- TDD per project conventions; small focused files; no `print` (structlog).

## 14. Decisions deferred / open

- **Frontend:** plain HTML/CSS/JS recommended (no build). Revisit only if interactions outgrow it.
- **Lemma-vs-form known-set:** lemma-level first; form-level (case/aspect as i+1) in M3.
- **Google Cloud TTS fallback:** wire the interface in M2, enable only if edge-tts quality/stability disappoints.
