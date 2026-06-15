"""Build the static reading dataset + audio for the PWA (run once, offline).

Pipeline:
  1. Take the top-N Russian words from an OpenSubtitles frequency list.
  2. Enrich each (gloss, translit, pos, cognate) via Gemini in batches; the
     hand-curated seed_words.csv overrides for quality where it overlaps.
  3. Generate one comprehensible-input passage per curriculum level (Gemini),
     up to PASSAGE_LEVELS.
  4. Pre-render all audio with edge-tts (Svetlana).

Outputs site/data/*.json + site/audio/*.mp3. Runtime needs none of this.
Requires the `gemini` CLI (logged in) and network access.

Run:  python tools/build_dataset.py
"""
from __future__ import annotations

import asyncio
import csv
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from ruslearn.gemini_cli import GeminiCLIProvider  # noqa: E402
from ruslearn.reader import ContentGenerator  # noqa: E402
from ruslearn.tts import TTSService  # noqa: E402

DATA = ROOT / "data"
SITE = ROOT / "site"
SITE_DATA = SITE / "data"
SITE_AUDIO = SITE / "audio"
VOICE = "ru-RU-SvetlanaNeural"

N_WORDS = 500          # vocabulary size (flashcards + audio)
PASSAGE_LEVELS = 120   # generate reading passages up to this level
MIN_KNOWN = 3
ENRICH_BATCH = 25      # bigger batches -> far fewer Gemini calls (the real speedup)
FREQ_URL = "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/ru/ru_50k.txt"
FREQ_PATH = DATA / "ru_50k.txt"
WORD_RE = re.compile(r"[^\W\d_]+", re.UNICODE)
CYR_RE = re.compile(r"^[а-яё]+$")

POS_VALUES = "noun, verb, adjective, adverb, pronoun, preposition, conjunction, particle, numeral, other"


def ensure_freq() -> None:
    if not FREQ_PATH.exists():
        print("Downloading frequency list...")
        urllib.request.urlretrieve(FREQ_URL, FREQ_PATH)


def load_freq(n: int) -> list[str]:
    words, seen = [], set()
    for line in FREQ_PATH.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if not parts:
            continue
        w = parts[0].strip().lower()
        if CYR_RE.match(w) and w not in seen:
            seen.add(w)
            words.append(w)
            if len(words) >= n:
                break
    return words


def load_curated() -> dict[str, dict]:
    curated = {}
    with open(DATA / "seed_words.csv", encoding="utf-8", newline="") as fh:
        for r in csv.DictReader(fh):
            curated[r["cyrillic"]] = {
                "stressed": r["stressed"],
                "translit": r["translit"],
                "gloss_en": r["gloss_en"],
                "pos": r["pos"],
                "is_cognate": r["is_cognate"].strip().lower() == "true",
            }
    return curated


async def _enrich_batch(provider, sem, batch: list[str]) -> dict[str, dict]:
    prompt = (
        "You are building a Russian->English vocabulary dataset for beginners.\n"
        "For EACH Russian word below give: \"gloss\" (concise English meaning, 1-4 words), "
        "\"translit\" (simple Latin transliteration), "
        f"\"pos\" (one of: {POS_VALUES}), "
        "\"is_cognate\" (true if an English speaker would likely recognize it from English, else false).\n"
        "Use plain Russian letters, no stress marks.\n"
        f"Words: {', '.join(batch)}\n"
        "Respond with ONLY a JSON object keyed by the exact word, e.g. "
        '{"слово": {"gloss":"word","translit":"slovo","pos":"noun","is_cognate":false}}'
    )
    async with sem:
        try:
            data = json.loads(await provider.complete(prompt))
            return data if isinstance(data, dict) else {}
        except Exception as exc:  # noqa: BLE001
            print(f"  ! enrich batch failed: {exc}")
            return {}


async def enrich(provider, sem, words: list[str]) -> dict[str, dict]:
    batches = [words[i : i + ENRICH_BATCH] for i in range(0, len(words), ENRICH_BATCH)]
    print(f"Enriching {len(words)} words in {len(batches)} batches...")
    results = await asyncio.gather(*(_enrich_batch(provider, sem, b) for b in batches))
    merged: dict[str, dict] = {}
    for r in results:
        merged.update(r)
    return merged


def assemble_words(freq: list[str], curated: dict, enriched: dict) -> list[dict]:
    words = []
    for i, w in enumerate(freq):
        rank = i + 1
        if w in curated:
            c = curated[w]
            words.append({"id": rank, "cyrillic": w, "stressed": c["stressed"],
                          "translit": c["translit"], "gloss_en": c["gloss_en"],
                          "pos": c["pos"], "is_cognate": c["is_cognate"], "freq_rank": rank})
        else:
            e = enriched.get(w, {})
            words.append({"id": rank, "cyrillic": w, "stressed": w,
                          "translit": e.get("translit", ""), "gloss_en": e.get("gloss", "—"),
                          "pos": e.get("pos", ""), "is_cognate": bool(e.get("is_cognate", False)),
                          "freq_rank": rank})
    return words


async def _gen_level(gen, sem, level, known, new) -> dict | None:
    async with sem:
        try:
            p = await gen.generate(known, new["cyrillic"], new["gloss_en"])
            return {"level": level,
                    "new_word": {"cyrillic": new["cyrillic"], "gloss": new["gloss_en"]},
                    "passage": p.text, "glossary": p.glossary, "new_words": p.new_words}
        except Exception as exc:  # noqa: BLE001
            print(f"  ! level {level} ({new['cyrillic']}) failed: {exc}")
            return None


async def build_reading(provider, sem, words: list[dict]) -> list[dict]:
    gen = ContentGenerator(provider)
    top = min(len(words), PASSAGE_LEVELS)
    print(f"Generating passages for levels {MIN_KNOWN}..{top - 1}...")
    tasks = [
        _gen_level(gen, sem, i, [w["cyrillic"] for w in words[:i]], words[i])
        for i in range(MIN_KNOWN, top)
    ]
    out = [r for r in await asyncio.gather(*tasks) if r]
    out.sort(key=lambda r: r["level"])
    return out


def collect_audio_texts(words, alphabet, reading) -> set[str]:
    texts: set[str] = set()
    for w in words:
        texts.add(w["stressed"])
    for letter in alphabet:
        texts.add(letter["example_word"])
    for entry in reading:
        clean = entry["passage"].replace("[[", "").replace("]]", "")
        for tok in WORD_RE.findall(clean):
            texts.add(tok.lower())
    return {t for t in texts if t.strip()}


async def render_audio(texts: set[str]) -> dict[str, str]:
    tts = TTSService(SITE_AUDIO, voice=VOICE)
    sem = asyncio.Semaphore(6)
    manifest: dict[str, str] = {}

    async def one(text: str) -> None:
        async with sem:
            try:
                path = await tts.synthesize(text)
                manifest[text] = f"audio/{path.name}"
            except Exception as exc:  # noqa: BLE001
                print(f"  ! audio failed for {text!r}: {exc}")

    await asyncio.gather(*(one(t) for t in texts))
    return manifest


def _write(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


async def main() -> None:
    SITE_DATA.mkdir(parents=True, exist_ok=True)
    SITE_AUDIO.mkdir(parents=True, exist_ok=True)
    provider = GeminiCLIProvider()
    gemini_sem = asyncio.Semaphore(3)

    ensure_freq()
    freq = load_freq(N_WORDS)
    curated = load_curated()
    need = [w for w in freq if w not in curated]
    enriched = await enrich(provider, gemini_sem, need)
    words = assemble_words(freq, curated, enriched)
    _write(SITE_DATA / "words.json", words)
    print(f"  -> {len(words)} words")

    alphabet = json.loads((DATA / "alphabet.json").read_text(encoding="utf-8"))
    _write(SITE_DATA / "alphabet.json", alphabet)

    reading = await build_reading(provider, gemini_sem, words)
    _write(SITE_DATA / "reading.json", reading)
    print(f"  -> {len(reading)} passages")

    texts = collect_audio_texts(words, alphabet, reading)
    print(f"Rendering {len(texts)} audio clips...")
    manifest = await render_audio(texts)
    _write(SITE_DATA / "audio.json", manifest)
    print(f"  -> {len(manifest)} clips")
    print("Done. Static dataset written to site/")


if __name__ == "__main__":
    asyncio.run(main())
