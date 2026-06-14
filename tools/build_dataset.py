"""Build the static reading dataset + audio for the PWA (run once, offline).

Outputs into site/:
  site/data/words.json     - seed vocabulary (curriculum order)
  site/data/alphabet.json  - the 33-letter curriculum (copied as-is)
  site/data/reading.json   - one generated passage per curriculum level
  site/data/audio.json     - manifest mapping text -> audio file
  site/audio/*.mp3         - pre-rendered Russian audio (Svetlana)

Runtime needs none of this machinery — the app just reads the JSON + mp3s.
Requires the `gemini` CLI (logged in) and network access for edge-tts.

Run:  python tools/build_dataset.py
"""
from __future__ import annotations

import asyncio
import csv
import json
import re
import sys
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
MIN_KNOWN = 3
WORD_RE = re.compile(r"[^\W\d_]+", re.UNICODE)


def load_words() -> list[dict]:
    rows: list[dict] = []
    with open(DATA / "seed_words.csv", encoding="utf-8", newline="") as fh:
        for r in csv.DictReader(fh):
            rows.append(
                {
                    "id": int(r["freq_rank"]),
                    "cyrillic": r["cyrillic"],
                    "stressed": r["stressed"],
                    "translit": r["translit"],
                    "gloss_en": r["gloss_en"],
                    "pos": r["pos"],
                    "is_cognate": r["is_cognate"].strip().lower() == "true",
                    "freq_rank": int(r["freq_rank"]),
                }
            )
    rows.sort(key=lambda w: w["freq_rank"])
    return rows


async def _gen_level(gen, sem, level, known, new) -> dict | None:
    async with sem:
        try:
            p = await gen.generate(known, new["cyrillic"], new["gloss_en"])
            print(f"  level {level}: + {new['cyrillic']}")
            return {
                "level": level,
                "new_word": {"cyrillic": new["cyrillic"], "gloss": new["gloss_en"]},
                "passage": p.text,
                "glossary": p.glossary,
                "new_words": p.new_words,
            }
        except Exception as exc:  # noqa: BLE001
            print(f"  ! level {level} ({new['cyrillic']}) failed: {exc}")
            return None


async def build_reading(words: list[dict]) -> list[dict]:
    gen = ContentGenerator(GeminiCLIProvider())
    sem = asyncio.Semaphore(3)
    tasks = [
        _gen_level(gen, sem, i, [w["cyrillic"] for w in words[:i]], words[i])
        for i in range(MIN_KNOWN, len(words))
    ]
    results = [r for r in await asyncio.gather(*tasks) if r]
    results.sort(key=lambda r: r["level"])
    return results


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

    words = load_words()
    alphabet = json.loads((DATA / "alphabet.json").read_text(encoding="utf-8"))
    _write(SITE_DATA / "words.json", words)
    _write(SITE_DATA / "alphabet.json", alphabet)

    print(f"Generating passages for levels {MIN_KNOWN}..{len(words) - 1} via Gemini...")
    reading = await build_reading(words)
    _write(SITE_DATA / "reading.json", reading)
    print(f"  -> {len(reading)} passages")

    texts = collect_audio_texts(words, alphabet, reading)
    print(f"Rendering {len(texts)} audio clips via edge-tts...")
    manifest = await render_audio(texts)
    _write(SITE_DATA / "audio.json", manifest)
    print(f"  -> {len(manifest)} clips")

    print("Done. Static dataset written to site/")


if __name__ == "__main__":
    asyncio.run(main())
