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
