# Accurate Stress + ё Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run all Russian content through RUAccent to display accurate stress marks (incl. in reading) and restore ё, without breaking audio or tap-to-gloss.

**Architecture:** Pure converter turns RUAccent's `+`-format into our combining-acute display form; `audio_key` is the accent-stripped (ё-kept) lookup key. A standalone post-processing script accentizes the existing cached JSON and re-renders only the few ё-changed audio clips. The frontend strips accent marks before audio/glossary lookups. The Gemini build pipeline is also updated so future full rebuilds stay correct.

**Tech Stack:** Python 3.11 (RUAccent on onnxruntime, `regex` module), pytest, edge-tts, vanilla-JS PWA.

## Global Constraints

- **RUAccent output format:** stress is `+` placed *before* the stressed vowel (`магаз+ин`, `вс+ё`). Restores ё automatically. Runs without torch (onnxruntime); load once per run.
- **Display form (`accentize`):** combining acute **U+0301 after** the stressed vowel; **ё is inherently stressed → drop the `+`, add NO acute** (`вс+ё`→`всё`, `магаз+ин`→`магази́н`).
- **Lookup key (`audio_key`)** = `strip_acute(accentize(text))` — ё kept, acute removed. This keys audio + glossary.
- **Idempotent:** `accentize` must `strip_acute` its input first, so re-running on already-accented data is safe.
- **Word-token regex** (Python): use the `regex` module (already installed via ruaccent) with `[\p{L}\p{M}]+` to keep combining marks inside tokens — matches the frontend's `tokenizeHTML` regex.
- **Audio is incremental:** TTS caches by `sha1(voice|text)`; only ё-changed keys generate new clips. Voice = `ru-RU-SvetlanaNeural`.
- **Frontend strip:** `stripAccent(s) = s.replace(/́/g, "")` (ё is U+0451, unaffected).
- **Run python via the project venv:** `.venv/bin/python`, `.venv/bin/pytest`. Tests live in `tests/` (pytest, per `pyproject.toml`).
- **Non-goals:** homograph perfection (teacher spot-checks), Piper, cursive/pictures/minimal-pairs.

---

### Task 1: Pure accent converters

**Files:**
- Create: `src/ruslearn/accent.py`
- Test: `tests/test_accent.py`

**Interfaces:**
- Produces: `strip_acute(s: str) -> str`; `plus_to_acute(s: str) -> str` (RUAccent `+`-form → combining-acute display, ё special-cased).

- [ ] **Step 1: Write the failing tests**

`tests/test_accent.py`:
```python
from ruslearn.accent import strip_acute, plus_to_acute

ACUTE = "́"

def test_plus_to_acute_marks_normal_vowel():
    assert plus_to_acute("магаз+ин") == "магаз" + "и" + ACUTE + "н"

def test_plus_before_yo_drops_plus_no_acute():
    assert plus_to_acute("вс+ё") == "всё"
    assert plus_to_acute("ещ+ё") == "ещё"

def test_plus_to_acute_multiword():
    out = plus_to_acute("Я любл+ю чит+ать")
    assert out == "Я любл" + "ю" + ACUTE + " чит" + "а" + ACUTE + "ть"

def test_no_plus_unchanged():
    assert plus_to_acute("не") == "не"

def test_strip_acute_removes_marks_keeps_yo():
    assert strip_acute("магази" + ACUTE + "н") == "магазин"
    assert strip_acute("всё") == "всё"

def test_strip_acute_roundtrips_plus_to_acute():
    assert strip_acute(plus_to_acute("магаз+ин")) == "магазин"
    assert strip_acute(plus_to_acute("вс+ё")) == "всё"
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_accent.py -q`
Expected: FAIL (module `ruslearn.accent` not found).

- [ ] **Step 3: Implement the converters**

`src/ruslearn/accent.py`:
```python
"""Stress + ё helpers: convert RUAccent '+'-format to our display/key forms."""
from __future__ import annotations

ACUTE = "́"  # combining acute accent (placed AFTER the stressed vowel)
_VOWELS = set("аеёиоуыэюяАЕЁИОУЫЭЮЯ")


def strip_acute(s: str) -> str:
    """Remove combining-acute stress marks; ё (U+0451) is untouched."""
    return s.replace(ACUTE, "")


def plus_to_acute(s: str) -> str:
    """RUAccent marks stress as '+' before the vowel. Convert to a combining
    acute after the vowel. ё is inherently stressed, so '+ё' -> 'ё' (no acute)."""
    out = []
    i = 0
    while i < len(s):
        ch = s[i]
        if ch == "+" and i + 1 < len(s) and s[i + 1] in _VOWELS:
            v = s[i + 1]
            if v in ("ё", "Ё"):
                out.append(v)            # ё already implies stress
            else:
                out.append(v + ACUTE)
            i += 2
        else:
            out.append(ch)
            i += 1
    return "".join(out)
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_accent.py -q`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ruslearn/accent.py tests/test_accent.py
git commit -m "feat: pure stress-mark + ё converters (accent.py)"
```

---

### Task 2: RUAccent-backed accentize + audio_key

**Files:**
- Modify: `src/ruslearn/accent.py`
- Modify: `pyproject.toml` (add the `ruaccent` dependency)

**Interfaces:**
- Consumes: `strip_acute`, `plus_to_acute` (Task 1).
- Produces: `accentize(text: str) -> str` (idempotent display form); `audio_key(text: str) -> str` (= `strip_acute(accentize(text))`).

- [ ] **Step 1: Add `ruaccent` to `pyproject.toml` dependencies**

In `pyproject.toml`, add to the `dependencies` list:
```toml
    "ruaccent>=1.5",
```

- [ ] **Step 2: Add the RUAccent wrapper to `src/ruslearn/accent.py`**

Append:
```python
_accentizer = None


def _get_accentizer():
    global _accentizer
    if _accentizer is None:
        from ruaccent import RUAccent  # heavy import; defer until needed
        acc = RUAccent()
        try:
            acc.load(omograph_model_size="turbo", use_dictionary=True)
        except TypeError:
            acc.load()
        _accentizer = acc
    return _accentizer


def accentize(text: str) -> str:
    """Display form: accurate stress (combining acute) + ё restored.
    Idempotent — strips any existing acute first so re-runs are safe."""
    if not text or not text.strip():
        return text
    base = strip_acute(text)
    try:
        marked = _get_accentizer().process_all(base)
    except Exception:  # noqa: BLE001 — never crash the build on one string
        return text
    return plus_to_acute(marked)


def audio_key(text: str) -> str:
    """Lookup key for audio/glossary: ё kept, stress marks removed."""
    return strip_acute(accentize(text))
```

- [ ] **Step 3: Verify on a sample (model loads on first call — manual, no pytest)**

Run:
```bash
.venv/bin/python -c "from ruslearn.accent import accentize, audio_key; \
print(accentize('еще'), accentize('магазин'), accentize('Я люблю читать книги.')); \
print(audio_key('еще'), audio_key('магазин'))" 2>&1 | grep -vE 'Warning|warn|HF_TOKEN|PyTorch'
```
Expected: `ещё магази́н Я любл<acute>ю чит<acute>ать кн<acute>иги.` then `ещё магазин`
(i.e. ё restored, stress on multi-syllable words, audio_key has ё but no acute).

- [ ] **Step 4: Confirm the pure tests still pass**

Run: `.venv/bin/python -m pytest tests/test_accent.py -q`
Expected: PASS (6 tests — wrapper adds no unit tests; it's verified manually above, matching how the codebase treats model/network code).

- [ ] **Step 5: Commit**

```bash
git add src/ruslearn/accent.py pyproject.toml
git commit -m "feat: RUAccent-backed accentize + audio_key (idempotent)"
```

---

### Task 3: Dataset transform (apply_accents + passage marking)

**Files:**
- Modify: `src/ruslearn/accent.py`
- Test: `tests/test_accent_dataset.py`

**Interfaces:**
- Consumes: `accentize`, `audio_key`, `strip_acute` (same module).
- Produces:
  - `accentize_passage(passage: str, accentize_fn) -> str` — accentize a reading passage, preserving a single `[[new word]]` marker by word-index.
  - `apply_accents(words: list, reading: list, patterns: list, accentize_fn=accentize, key_fn=audio_key) -> None` — mutate in place: word `stressed`, reading `passage` + re-keyed `glossary`, pattern `say` + ё-restored `answer`/`gloss`/`distractors`.

- [ ] **Step 1: Write the failing tests (use a FAKE accentizer — no model)**

`tests/test_accent_dataset.py`:
```python
from ruslearn.accent import accentize_passage, apply_accents

ACUTE = "́"

# Fake accentizer: marks every 'а' as stressed-ish and "restores" е->ё in "еще".
def fake_acc(text):
    return text.replace("еще", "ещё").replace("а", "а" + ACUTE)

def fake_key(text):
    return fake_acc(text).replace(ACUTE, "")

def test_passage_marker_preserved_at_right_word():
    # "мама" is the 2nd word (index 1) -> only it gets wrapped; "Я"/"тут" have no 'а'
    out = accentize_passage("Я [[мама]] тут", fake_acc)
    assert out == "Я [[ма" + ACUTE + "ма" + ACUTE + "]] тут"
    assert out.count("[[") == 1 and out.count("]]") == 1

def test_passage_no_marker_just_accentizes():
    out = accentize_passage("она там", fake_acc)
    assert "[[" not in out and "́" in out

def test_apply_accents_words_and_glossary():
    words = [{"cyrillic": "мама", "stressed": "мама"}]
    reading = [{"passage": "[[еще]] раз", "glossary": {"еще": "still", "раз": "time"}}]
    patterns = [{"items": [{"say": "мама", "answer": ["еще"], "gloss": [["еще", "still"]]}],
                 "distractors": ["раз"]}]
    apply_accents(words, reading, patterns, accentize_fn=fake_acc, key_fn=fake_key)
    assert words[0]["stressed"] == "ма́ма́"
    # glossary re-keyed via key_fn (ё restored, no acute), lowercased
    assert reading[0]["glossary"] == {"ещё": "still", "ра́з".replace("́", ""): "time"}
    # pattern answer + distractors ё-restored, no acute
    assert patterns[0]["items"][0]["answer"] == ["ещё"]
    assert patterns[0]["distractors"] == ["раз"]
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_accent_dataset.py -q`
Expected: FAIL (`accentize_passage` / `apply_accents` not defined).

- [ ] **Step 3: Implement the transform**

Append to `src/ruslearn/accent.py` (add `import regex` near the top of the file, after `from __future__`):
```python
import regex  # supports \p{L}\p{M}; installed via ruaccent

_WORD = regex.compile(r"[\p{L}\p{M}]+")


def _marked_index(passage: str):
    i = passage.find("[[")
    if i < 0:
        return None
    return len(_WORD.findall(passage[:i]))


def accentize_passage(passage: str, accentize_fn=None) -> str:
    fn = accentize_fn or accentize
    idx = _marked_index(passage)
    plain = passage.replace("[[", "").replace("]]", "")
    acc = fn(plain)
    if idx is None:
        return acc
    counter = {"n": -1}

    def repl(m):
        counter["n"] += 1
        return f"[[{m.group(0)}]]" if counter["n"] == idx else m.group(0)

    return _WORD.sub(repl, acc)


def apply_accents(words, reading, patterns, accentize_fn=None, key_fn=None) -> None:
    acc = accentize_fn or accentize
    key = key_fn or audio_key
    for w in words:
        w["stressed"] = acc(w.get("cyrillic", w.get("stressed", "")))
    for e in reading:
        e["passage"] = accentize_passage(e["passage"], acc)
        e["glossary"] = {key(k).lower(): v for k, v in (e.get("glossary") or {}).items()}
    for p in patterns:
        for item in p.get("items", []):
            item["say"] = acc(item["say"])
            item["answer"] = [key(x) for x in item.get("answer", [])]
            item["gloss"] = [[key(ru), en] for ru, en in item.get("gloss", [])]
        p["distractors"] = [key(d) for d in p.get("distractors", [])]
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_accent_dataset.py -q`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ruslearn/accent.py tests/test_accent_dataset.py
git commit -m "feat: apply_accents dataset transform + passage marker preservation"
```

---

### Task 4: Standalone runner + run it on the real data

**Files:**
- Create: `tools/accentize_dataset.py`
- (Regenerates: `site/data/words.json`, `reading.json`, `patterns.json`, `audio.json`, new `site/audio/*.mp3`)

**Interfaces:**
- Consumes: `apply_accents`, `audio_key` (accent.py); reuses `collect_audio_texts`, `render_audio`, `_write` from `tools/build_dataset.py`.

- [ ] **Step 1: Write the runner**

`tools/accentize_dataset.py`:
```python
"""One-time pass: accentize the cached dataset (stress + ё) and re-render only
the audio clips whose key changed. No Gemini needed.

Run: .venv/bin/python tools/accentize_dataset.py
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tools"))

from ruslearn.accent import apply_accents, strip_acute  # noqa: E402
import build_dataset as bd  # noqa: E402

SD = bd.SITE_DATA


def _load(name):
    return json.loads((SD / name).read_text(encoding="utf-8"))


# The data is already accentized at this point, so strip_acute yields the audio
# key (== audio_key) without re-running the model — and tokenizing the *stripped*
# text avoids WORD_RE splitting words at the combining acute.
def _audio_texts(words, alphabet, reading, patterns):
    texts = set()
    for w in words:
        texts.add(strip_acute(w["stressed"]))
    for letter in alphabet:
        texts.add(strip_acute(letter["example_word"]))
    for e in reading:
        clean = strip_acute(e["passage"].replace("[[", "").replace("]]", ""))
        texts.add(clean)
        for tok in bd.WORD_RE.findall(clean):
            texts.add(tok.lower())
    for p in patterns:
        for item in p["items"]:
            say = strip_acute(item["say"])
            texts.add(say)
            for tok in bd.WORD_RE.findall(say):
                texts.add(tok.lower())
    return {t for t in texts if t.strip()}


async def main():
    words = _load("words.json")
    reading = _load("reading.json")
    patterns = _load("patterns.json")
    alphabet = _load("alphabet.json")

    apply_accents(words, reading, patterns)
    bd._write(SD / "words.json", words)
    bd._write(SD / "reading.json", reading)
    bd._write(SD / "patterns.json", patterns)
    print(f"accentized {len(words)} words, {len(reading)} sentences, {len(patterns)} patterns")

    texts = _audio_texts(words, alphabet, reading, patterns)
    print(f"rendering/caching {len(texts)} audio clips (only new ё-clips synthesize)...")
    manifest = await bd.render_audio(texts)
    bd._write(SD / "audio.json", manifest)
    print(f"-> {len(manifest)} clips in manifest")


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Run it (data-first: it processes all, prints counts)**

Run: `.venv/bin/python tools/accentize_dataset.py 2>&1 | grep -vE 'Warning|warn|HF_TOKEN|PyTorch'`
Expected: prints "accentized 500 words…", renders clips (most cached, a few new), "-> N clips in manifest".

- [ ] **Step 3: Validate the output changed correctly**

Run:
```bash
.venv/bin/python -c "import json; d=json.load(open('site/data/words.json')); \
print('words with ё:', sum(1 for w in d if 'ё' in w['stressed'])); \
print('words with stress mark:', sum(1 for w in d if '́' in w['stressed'])); \
import json as j; a=j.load(open('site/data/audio.json')); \
print('audio keys with acute (should be 0):', sum(1 for k in a if '́' in k))"
```
Expected: ё count now in the dozens (was ~12), stress-mark count in the hundreds, **0 audio keys with acute**.

- [ ] **Step 4: Commit the regenerated data + new audio**

```bash
git add site/data/words.json site/data/reading.json site/data/patterns.json site/data/audio.json site/audio/ tools/accentize_dataset.py
git commit -m "feat: accentized dataset (stress + ё) + incremental audio re-render"
```

---

### Task 5: Frontend — strip accents on lookup, show stress in reading

**Files:**
- Modify: `site/app.js` (add `stripAccent`, update `play`, update glossary lookup)
- Modify: `site/sw.js` (cache bump)

**Interfaces:**
- Consumes: the accentized `site/data/*.json` (Task 4).

- [ ] **Step 1: Add `stripAccent` and use it in `play()`**

In `site/app.js`, the `play` function (around line 75) currently is:
```javascript
function play(text, rate = 1) {
  if (!text) return;
  const file = AUDIO[text] ?? AUDIO[text.toLowerCase()];
```
Change it to:
```javascript
const stripAccent = (s) => (s || "").replace(/́/g, "");
function play(text, rate = 1) {
  if (!text) return;
  const key = stripAccent(text);
  const file = AUDIO[key] ?? AUDIO[key.toLowerCase()];
```
(Leave the rest of `play` unchanged.)

- [ ] **Step 2: Strip accents in the reading glossary lookup**

In `renderPassage` (around line 500), change:
```javascript
      const g = glossary[w.toLowerCase()];
```
to:
```javascript
      const g = glossary[stripAccent(w).toLowerCase()];
```

- [ ] **Step 3: Bump the service-worker cache**

In `site/sw.js`, change `const CACHE = "ruslearn-v4";` to `const CACHE = "ruslearn-v5";`.

- [ ] **Step 4: Syntax check**

Run: `node --check site/app.js`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add site/app.js site/sw.js
git commit -m "feat: strip accent marks on audio/glossary lookup; show stress in reading"
```

---

### Task 6: Keep future full rebuilds correct

**Files:**
- Modify: `tools/build_dataset.py` (apply accents before audio; key audio by `audio_key`)

**Interfaces:**
- Consumes: `apply_accents`, `audio_key` (accent.py).

- [ ] **Step 1: Import the helpers in `tools/build_dataset.py`**

Add after the existing `from ruslearn...` imports (near line 31):
```python
from ruslearn.accent import apply_accents, strip_acute  # noqa: E402
```

- [ ] **Step 2: Key `collect_audio_texts` by `audio_key`**

Replace the body of `collect_audio_texts` (lines ~178-194) with:
```python
def collect_audio_texts(words, alphabet, reading, patterns) -> set[str]:
    # main() runs apply_accents first, so the data is already accentized here;
    # strip_acute gives the audio key without re-running the model, and tokenizing
    # the stripped text avoids WORD_RE splitting words at the combining acute.
    texts: set[str] = set()
    for w in words:
        texts.add(strip_acute(w["stressed"]))
    for letter in alphabet:
        texts.add(strip_acute(letter["example_word"]))
    for entry in reading:
        clean = strip_acute(entry["passage"].replace("[[", "").replace("]]", ""))
        texts.add(clean)
        for tok in WORD_RE.findall(clean):
            texts.add(tok.lower())
    for pat in patterns:
        for item in pat["items"]:
            say = strip_acute(item["say"])
            texts.add(say)
            for tok in WORD_RE.findall(say):
                texts.add(tok.lower())
    return {t for t in texts if t.strip()}
```

- [ ] **Step 3: Apply accents before audio in `main()`**

In `main()`, immediately after the patterns are built (after `patterns = await build_patterns(...)` and its print, ~line 301) and BEFORE `texts = collect_audio_texts(...)`, insert:
```python
    apply_accents(words, reading, patterns)
    _write(SITE_DATA / "words.json", words)
    _write(SITE_DATA / "reading.json", reading)
    _write(SITE_DATA / "patterns.json", patterns)
    print("  -> applied stress + ё")
```

- [ ] **Step 4: Syntax check**

Run: `.venv/bin/python -c "import ast; ast.parse(open('tools/build_dataset.py').read()); print('ok')"`
Expected: `ok`

- [ ] **Step 5: Commit**

```bash
git add tools/build_dataset.py
git commit -m "feat: build pipeline applies stress + ё so rebuilds stay correct"
```

---

## Deployment (after all tasks reviewed)

1. Local preview check (`python -m http.server` on `site/` or the preview tool): open Reading → confirm **stress marks show in passages**, tapping a word still **plays audio + shows the gloss**; check a ё-word (всё/ещё) plays and reads correctly; check Reviews/Listen still play audio.
2. `npx wrangler deploy` (uploads new audio + data).
3. Verify on the live URL, then merge `feat-accents` → master.
4. Note for the teacher: include the accentized output in her phrase-check so she can flag any wrong stress/homographs.

## Self-review notes

- **Spec coverage:** accentize/audio_key (T1-2) ✓; words/reading/patterns transform + glossary re-key + passage markers (T3) ✓; run + incremental audio (T4) ✓; frontend strip + stress-in-reading (T5) ✓; rebuild-safety (T6) ✓. Homograph caveat + teacher spot-check noted.
- **Idempotency:** `accentize` strips acute first, so T4 (standalone) and T6 (build) can both run without double-marking.
- **Audio safety:** `audio_key` strips acute → non-ё clips reuse cache; only ё-changed keys synthesize.
