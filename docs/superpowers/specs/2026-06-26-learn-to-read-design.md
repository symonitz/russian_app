# "Learn to Read" Module — Design

**Date:** 2026-06-26
**Status:** Approved (design); pending spec review
**Branch:** `feat-learn-to-read`
**Source:** curriculum authored by a native Russian-as-a-foreign-language teacher (her two PDFs); content transcribed below is the source of truth.

## Goal

The app currently assumes the learner can already read Cyrillic — it jumps straight to vocabulary and sentences. Add the missing first step: a guided **"Learn to Read"** module that teaches the alphabet through *decoding* (read real words made only of letters learned so far), illustrated with **emoji instead of translations**. This is the on-ramp before the existing five modes.

## Structure & placement

- A new **📖 Learn to Read** section at the **top of home** ("Start here"), above the existing modes. It opens a **lesson list**; lessons unlock in order.
- The existing standalone **Alphabet tile is removed** — its job moves into this module. The `tests/e2e/alphabet.spec.js` test is updated to target the new module (or removed if the flow no longer matches).
- The existing five modes (Reviews/Listen/Reading/Patterns) are **untouched** and become "what's next" once the learner can read.

## Lessons

Four lessons, in order:

- **Lesson 1 — True & False friends**
  - True friends (look + sound like Latin): `А О К М Т`
  - False friends (look Latin, sound different): `С Р У В Х Е Н`
  - Words (use only these letters): `мама, кот, атом, томат, нос, сон, ухо, сок, море, носок, комар, корона, ворона, ракета, торт, ресторан, метро, космос, нота, карта, окно`
- **Lesson 2 — New friends**
  - New friends: `Б И Л Г П Д Ф З Э`
  - Words: `вино, гитара, банан, роза, лимон, стадион, радио, суп, кофе, экзамен, доктор, парк, футболист, собака, бегемот, хлеб, масло, салат, стол, лампа, дом, река, гора, лес, облако, снег, работа, спорт, банк, робот, телефон, театр`
- **Lesson 3 — Strangers (remaining letters)**
  - Strangers: `Ж Ч Ц Ш Щ Ю Я Ё Й ъ ы ь`
  - Words: `чай, пицца, сыр, яблоко, шоколад, яйцо, книга, машина, ключ, мяч, очки, карандаш, школа, музей, магазин, почта, женщина, мужчина, девочка, мальчик, семья, ёж, мышь, птица, студент, турист, такси, фотограф, музыка`
- **Lesson 4 — Numbers** (learner can read by now)
  - Learn `1–10`: `один, два, три, четыре, пять, шесть, семь, восемь, девять, десять`
  - Practice: show a digit sequence (e.g. `835`) → tap the number-words in order (`восемь → три → пять`). ≥10 sequences, lengths 3–6.

## Exercise types (within a reading lesson)

Each reading lesson runs through, in order:

1. **Letter-intro card** — big letter (`Аа`), its **group label** (True friend / False friend / New / Stranger), the **pronunciation hint** ("like the **a** in *bar*" + Russian example `бар`), and a 🔊 button (letters **do** play audio on intro). Self-grade *Got it / Again* (reuses the count-based scheduler, `P.letters`).
2. **Word-decoding card** (the core) — the Russian word shown large (`мама`), **no autoplay**. The learner reads silently, then **taps** → reveals the **emoji** (👩) **and** plays audio. Self-grade. **Cumulative**: a word appears only once all its letters are in introduced groups.
3. **Mini-test** — right after a letter block, a focused checkpoint of **5–7 words** from that block (same read→tap→reveal mechanic, framed as a quick check).
4. **"Find the Word" matching** — **4 emoji + 4 Russian words**, shuffled; tap an emoji then its word to connect them; correct pairs lock green, wrong pairs flash and reset. Recognition test + variety.

**Mixed Review (spaced repetition):** every word/letter is a card in the existing count-based scheduler, so due cards from earlier lessons resurface automatically. The module exposes a **"Mixed Review"** entry that pulls all *due* reading words/letters across lessons.

## Pronunciation hints (from her alphabet.pdf — into `alphabet.json`)

Each letter: `hint_en` (English keyword, sound bolded conceptually) + `hint_word` (Russian example). Full set:
`А→bar/бар, Б→bank/банк, В→video/видео, Г→guitar/гитара, Д→dollar/доллар, Е→Vietnam/Вьетнам, Ё→surfing/сёрфинг, Ж→pleasure/журнал, З→zebra/зебра, И→video/видео, Й→yogurt/йогурт, К→coffee/кофе, Л→lamp/лампа, М→mother/мама, Н→nose/нос, О→metro/метро, П→park/парк, Р→Russia/Россия, С→sport/спорт, Т→taxi/такси, У→football/футбол, Ф→photo/фото, Х→hockey/хоккей, Ц→pizza/пицца, Ч→Chili/Чили, Ш→show/шоу, Щ→borsch/борщ, Ъ→(silent)/объект, Ы→(no eng)/музыка, Ь→(silent)/фильм, Э→Edinburgh/Эдинбург, Ю→producer/продюсер, Я→Yandex/Яндекс`

## Data model

- **`alphabet.json`** (upgrade existing): each of 33 letters gets `group` (`true`|`false`|`new`|`stranger`), `hint_en`, `hint_word`. Keep existing `cyrillic`/`example_word` etc. for compatibility.
- **`reading_lessons.json`** (new): array of lessons `{ id, title, groups: [letter-group keys], letters: [...], words: [{ ru, emoji }] }` for lessons 1–3.
- **`numbers.json`** (new): `{ words: [{ digit, ru, emoji? }], sequences: [[8,3,5], ...] }`.
- **Emoji map:** authored from her word lists (~80 words → emoji), e.g. `кот→🐱, банан→🍌, пицца→🍕, ракета→🚀, ёж→🦔`. Stored inline in `reading_lessons.json` per word. Coverage verified ~95%+; the rare miss takes the closest emoji.
- **Audio (build pipeline, edge-tts):** each letter's **example word** (`hint_word`, which contains the sound — e.g. `бар` for А), all reading words, and number words get clips, keyed by `audio_key` like existing audio. **Reading-word audio is tap-triggered only** in the UI — never autoplayed (letter-intro and numbers cards may play on reveal).

## Progress / gating

- Reuse the count-based scheduler. Letters → `P.letters` (already exists). Reading words → a new `P.reading` map keyed by the word. Numbers → `P.numbers`.
- Lessons unlock sequentially (Lesson N available once Lesson N-1's letters are all "known", or simply once visited — exact gate decided in the plan; default: sequential unlock on completing the prior lesson's letters + mini-test).
- A small progress indicator per lesson in the lesson list.

## Build approach (data-first, phased)

1. **Core vertical slice — Lesson 1:** the module shell + lesson list, the Lesson-1 letter-intro cards (True/False friends), the word-decoding cards for its ~22 words (+ emoji + audio), and the mini-test. Ship + validate the feel.
2. **Enrichment:** "Find the Word" matching + the Mixed Review entry.
3. **Replicate content:** Lessons 2–3 word/letter data + Lesson 4 Numbers (learn cards + digit-sequence tap-build).

## Non-goals (YAGNI)

- No changes to the existing five modes.
- No cursive, no handwriting, no numbers beyond 1–10 / basic sequences.
- No typed input in this module — reading is self-graded (read silently → tap to confirm), per her explicit rule.
- No translations anywhere in the module — emoji only.

## Testing

- Reuse the existing patterns: pure logic (cumulative word availability by learned letters; mini-test selection; Find-the-Word match checking) is unit-testable; add E2E specs (`tests/e2e/learn-to-read.spec.js`) driving the module — letter card reveal, word-card tap→emoji+audio (assert no autoplay, audio only on tap via the `/audio/*.mp3` request after tap), mini-test, and one Find-the-Word match. Update/replace `alphabet.spec.js`.
- Dataset-integrity guards extended: every reading word has an emoji + an audio clip; every letter has a hint.
