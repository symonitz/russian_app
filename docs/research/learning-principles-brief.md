I'll synthesize the research into a design brief. Let me note the verification verdicts that require softening: the "FSRS is Anki's default since v23.10" claim (it's opt-in, not default), the four-bucket source convergence (Babbel and UArizona CMES citations are unreliable — drop them), the iotated vowel placement (move to bucket 4), and the FrequencyWords commercial-license claim (non-commercial upstream restriction).

# Russian Learning App — Design Brief

A personal, local, single-user Russian-from-zero web app. Core engine: per-learner known-words lexicon + vocabulary-constrained comprehensible-input (CI) text generation, with FSRS spaced repetition driving both reviews and text selection. English explanations throughout; audio on every word.

---

## 1. Learning principles to bake in

- **Comprehensible input gated at ~98% known-word coverage** — at ~98% coverage (1 unknown word per ~50) readers comprehend unaided; below ~95% comprehension degrades sharply ([Nation 2006](https://www.lextutor.ca/cover/papers/nation_2006.pdf), [Hu & Nation 2000](https://nflrc.hawaii.edu/rfl/item/43)).
- **CI is the consolidation layer, not the discovery layer** — incidental reading picks up only ~15% of target words and most decay within months, so SRS must front-load vocabulary and CI reinforces it ([Brown et al. 2008](https://www2.hawaii.edu/~readfl/rfl/October2008/brown/brown.html)).
- **Words need many spaced encounters** — roughly 8–18+ encounters for solid receptive knowledge, so "introducing" a word means engineering its recurrence across future texts ([EAP Foundation synthesis](https://www.eapfoundation.com/vocab/learn/incidental/)).
- **Expanding-interval spaced repetition beats massed practice** — optimal review gap is ~10–20% of the target retention interval ([Cepeda review, PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC5476736/)).
- **Pair text with audio** — reading-while-listening (~16% pickup) beats reading-only and far beats listening-only (~2%) ([Brown et al. 2008](https://www2.hawaii.edu/~readfl/rfl/October2008/brown/brown.html)).
- **Personalize difficulty per word/skill, not by one global level** — learners have "spiky" profiles; a known lemma in a new case can be its own i+1 step ([Frontiers in Psychology 2025](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2025.1636777/full)).
- **Add light output + explicit explanation, not input alone** — cloze and short type-the-word tasks plus one-line English grammar notes add what comprehension cannot ([Frontiers 2025](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2025.1636777/full)).
- **Treat thresholds as tunable defaults, not gospel** — a 2025 replication ([RFL, n=94](https://eric.ed.gov/?q=coverage&id=EJ1486674)) found weak coverage→comprehension differences above 90%; log per-text comprehension and tune to your own data.

---

## 2. Concrete parameters & choices

**SRS algorithm + library**
- Use **FSRS-6** via the **`py-fsrs`** Python library (`pip install fsrs`; optimizer extra `pip install "fsrs[optimizer]"`). FSRS uses a Difficulty/Stability/Retrievability model and outperforms SM-2 for ~99.5% of users on the [open-spaced-repetition benchmark](https://github.com/open-spaced-repetition/srs-benchmark). *Correction vs. raw research:* FSRS has been a **built-in opt-in option in Anki since v23.10 (Nov 2023)** — it was **not** Anki's default at that time (SM-2 was). Don't hand-roll SM-2.
- Wrap `Scheduler`/`Card`/`Rating`/`review_card` behind a thin service. Persist full Card state **and every ReviewLog** (the optimizer is useless without stored logs; it needs ~hundreds-plus reviews before personalized params beat defaults).
- `desired_retention = 0.90` default; expose a single 0.80–0.95 slider. Don't chase 0.95+ early — workload climbs steeply.
- Map review UI to 4 ratings (Again/Hard/Good/Easy); a 2-button Again/Good is fine for a beginner.

**CI generation targets**
- Default generation target: **~98% known-word coverage** (≈1 new word per ~50 running words). Expose a "new-word density" knob: tighten to 98–99% for relaxed reading, loosen to ~95% (≈1 new per sentence) only in deliberate-learning mode with glosses shown. **Never below ~90%** for a from-zero learner.
- **1–3 genuinely new words per short snippet**, each scheduled to recur within the same text and across subsequent texts before its SRS interval lapses.
- **Enforce the constraint at the output, not just the prompt** — LLMs don't reliably obey "only use these words." Generate, then tokenize → lemmatize → diff against the known-set, and regenerate/post-edit any sentence over budget. Lemmatize with **pymorphy3** (or spaCy `ru`) so книга/книги/книгу all map to one lemma. Decide explicitly: known-set keyed on **lemmas**, with a known lemma in an unseen case/aspect counting as its own new i+1 item.

**Cyrillic teaching order** (four-bucket model — verified as the dominant beginner model via [RussianLessons.net](https://www.russianlessons.net/lessons/lesson1_main.php) and [Polyglottist](https://www.polyglottistlanguageacademy.com/language-culture-travelling-blog/2026/6/10/russian-cyrillic-vs-english-10-letters-that-look-the-same-but-sound-different); originates with RussianPod101's True/False/New Friends + Strangers framing):
1. **True friends** (look + sound like Latin): А К М О Т — build instant words (КОТ, МАК, ТОМ).
2. **False friends** (look Latin, sound different): В Н Р С У Х + Е, taught explicitly as side-by-side contrast cards ("looks like X, sounds like Y") and given persistent extra SRS exposure — they're the biggest decoding-error source.
3. **Unfamiliar shape / familiar sound**: Б Г Д З И Й Л П Ф Э.
4. **Genuinely new sounds + signs**: Ж Ц Ч Ш Щ Ы, the iotated vowels **Ё Ю Я**, and Ъ Ь. *(Correction vs. raw research, which mis-placed the iotated vowels in bucket 3: Ё Ю Я carry a genuinely new /j/+palatalization behavior and belong in bucket 4.)*

Train **recognition before production**; for a reading app, defer/skip cursive *production* but introduce cursive *reading* once print is solid. **Sunset transliteration within the first ~3–7 days**, replacing it with stress marks + audio. Seed the first session with ~30–50 transparent cognates so the learner reads real Russian immediately.

**Stress marks**
- Model **stress as a first-class per-word-FORM attribute** (stored on the lemma and on each inflected form), because Russian stress is lexically unpredictable and mobile across the paradigm — verified well-supported ([Jouravlev & Lupker 2015](https://www.psychology.uwo.ca/faculty/lupkerpdfs/Jouravlev%20&%20Lupker,%202015a.pdf), [Cambridge Phonology study](https://www.cambridge.org/core/journals/phonology/article/default-stress-assignment-in-russian-evidence-from-acquired-surface-dyslexia/1890076DCE1C2A7FBE45E77B620E82DF)). (Soften the raw "no rules at all" wording: weak probabilistic cues exist, just not reliable enough to skip per-lexeme storage.)
- Bundle **stress + vowel reduction** into one "how this word sounds" unit — reduction (akanye/ikanye) is fully determined by stress, so never teach it as separate rules; pair every word with audio ([Vowel reduction in Russian, Wikipedia](https://en.wikipedia.org/wiki/Vowel_reduction_in_Russian)).
- Mark stress on **all learner-facing Russian from day one**, then implement **per-word weaning**: once a word crosses its mastery threshold, render it unaccented (as real text does).
- Auto-annotate imported text with **RUAccent** (`ruaccent-predictor`, COLING 2025, ~0.97 accuracy — [paper](https://aclanthology.org/2025.coling-main.444/)); spot-check rare words/names. A flag for stress-mobility can be sourced from Zaliznyak/Wiktionary-derived paradigm data (treat StimulStat's exact field list as unconfirmed if you cite it).

**Grammar: introduce early vs. defer** (no SLA consensus on case order — this is a reasoned frequency-driven sequence, not validated):
- **Early:** Nominative (citation/subject) → Accusative (direct object, "я хочу/люблю X") → Prepositional (location в/на X, simple endings) → Genitive (possession, negation нет X, quantity). Introduce one most-frequent *function* per case (spiral approach), let CI surface it, expand later.
- **Defer:** Dative, Instrumental, full case-ending paradigm tables, **verb aspect** (build early speaking around the present tense, which is imperfective-only and sidesteps the aspect choice; introduce perfective/imperfective contrast via paired example sentences once past/future become productive needs), numerals + case agreement, verbs of motion, participles/gerunds.
- Tag every verb with its aspect + aspectual partner, and every word with case/form metadata, so the engine can later present pairs and treat new forms as i+1 steps.

---

## 3. Recommended open resources

**Frequency word lists (seed the curriculum, frequency-first):**
- **hermitdave/FrequencyWords** — OpenSubtitles-2018 Russian lists at `content/2018/ru/ru_50k.txt`, plain `word count` format. Best practical free frequency spine. **License caveat (verified):** README labels it MIT (code) + CC BY-SA 4.0 (data), but the repo's LICENSE file is MIT-only, the author's site states CC BY-SA *3.0*, and the upstream OpenSubtitles source carries a **non-commercial** restriction. For this **personal, non-commercial** app it's fine; do **not** assume clean commercial rights without legal review. Entries are surface forms — lemmatize before joining. [GitHub](https://github.com/hermitdave/FrequencyWords)
- **`wordfreq`** (PyPI, Apache-2.0 code / CC BY-SA 4.0 data) — use as a runtime difficulty/scoring function (`zipf_frequency(token,'ru')`) inside the CI engine; blends 5 sources, no static list to ship. [GitHub](https://github.com/rspeer/wordfreq)
- **Kelly project (Sharoff), CEFR-graded** — ~9,000 lemmas mapped to A1–C2 (`ru_m3.xls`). Highest pedagogical value for lesson gating. **License: CC BY-NC-SA 2.0 (non-commercial)** — fits this app; swap out before any monetization. [Kelly](https://ssharoff.github.io/kelly/)
- Stress-annotated dictionary + sentence bank: **OpenRussian / Badestrand** (CC BY-SA 4.0, accented declensions/conjugations + Tatoeba sentences). [GitHub](https://github.com/Badestrand/russian-dictionary)

**Cognate list for early wins:**
- Harvest **Wiktionary "Category:Russian terms borrowed from English"** (~1,220 entries: компьютер, бизнес, менеджер) and **"Category:Russian internationalisms"** (телефон, театр, музей, проблема) via the MediaWiki API; intersect with the top ~3,000 frequency entries so you only surface common, instantly-readable cognates. CC BY-SA 4.0 — attribute. [Borrowed-from-English category](https://en.wiktionary.org/wiki/Category:Russian_terms_borrowed_from_English)
- Encode cognate suffix rules (-ция↔-tion, -ика↔-ics, -ура↔-ure, c↔ц) so the engine can expand the recognizable set programmatically and explain *why* a word is guessable. (The blog compilations like StoryLearning's "121+" are inspiration only — no open license; re-express, don't ingest.)

**TTS approach:**
- **Primary: `edge-tts`** (Python, GPL-3.0) — free, no API key, neural Russian voices **ru-RU-SvetlanaNeural (F)** and **ru-RU-DmitryNeural (M)**; alternate them. Exposes **word-boundary timings** for karaoke-style word highlighting during CI playback (verified in source). Feed it the stress-marked form. [GitHub](https://github.com/rany2/edge-tts)
- **Cache every clip** on disk keyed by (text, voice, rate) hash — turns repeated SRS reviews into one-time generation, removes latency, and sidesteps the unofficial-endpoint rate-limit/breakage risk.
- **Fallback: Google Cloud TTS** (ru-RU Neural2/WaveNet) — officially supported, generous free tier (~1M Neural2 / ~4M WaveNet chars/month), and **full SSML `<phoneme>` IPA** so you can force correct stress on ambiguous words (route stress-sensitive items here; edge-tts's restricted SSML can't). Verify current pricing/limits before committing. [Voices](https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types)
- **Do not** make the browser Web Speech API primary or fallback — Russian coverage is inconsistent and the good voices are online-only; on macOS expect robotic results (verified via [readium.org survey](https://readium.org/speech/docs/WebSpeech.html)). Use only as a last-resort emergency path. Control playback speed (~0.75x for shadowing) in the player, not by re-synthesizing.

---

## 4. Pitfalls to avoid

- **Don't trust prompt-level vocabulary constraints** — always run a hard post-generation coverage filter (lemmatize first). LLMs holding a tight known-words constraint for Russian at scale is an open engineering question.
- **Don't rely on incidental reading for acquisition** — pickup is slow and decays; SRS introduces, CI consolidates.
- **Don't count passive reading exposure as a graduating active-recall success** — log it as a separate, lightly-weighted signal that can nudge due dates; never let it silently inflate mastery (no validated exposure→FSRS conversion exists — tune on your own data).
- **Don't match on surface forms** — Russian's heavy inflection means you must lemmatize (pymorphy3) before checking the known-set; decide lemma-vs-form policy up front, since it changes your density math.
- **Don't teach pronunciation without stress** — vowel reduction is unrecoverable without it; verify your TTS doesn't mis-stress unmarked input.
- **Don't gate progress on palatalization production** — perception lags for years even with immersion ([Kochetov et al. 2015](https://www.sciencedirect.com/science/article/abs/pii/S0095447015000777)); teach it perception-first via minimal pairs, accept imperfect output.
- **Don't dump full case/aspect paradigm tables on a beginner** — introduce one frequent function at a time and let CI surface forms.
- **Don't let transliteration persist** — it entrenches bad pronunciation; hard-cut it within the first week.
- **Don't treat 98%/95% as hard cutoffs** — they're soft, individually-variable defaults validated only for intermediate+ L2 *English*; instrument the app (cloze accuracy, self-rated comprehension) and tune for your learner.
- **Don't run the FSRS optimizer too early** — it needs a meaningful review volume; run on defaults for the first weeks.
- **Don't assume clean commercial rights** on the frequency/CEFR data — Kelly and the OpenSubtitles-derived lists carry NC/non-commercial constraints. Keep a per-source attribution/license file in the repo.