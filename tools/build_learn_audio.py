"""Pre-render audio for the Learn-to-Read module: Lesson reading words + each
letter's example word (hint_word). Incremental (TTS caches by content). No Gemini.

Run: .venv/bin/python tools/build_learn_audio.py
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tools"))

from ruslearn.accent import strip_acute  # noqa: E402
import build_dataset as bd  # noqa: E402

SD = bd.SITE_DATA


async def main():
    lessons = json.loads((SD / "reading_lessons.json").read_text(encoding="utf-8"))
    alphabet = json.loads((SD / "alphabet.json").read_text(encoding="utf-8"))
    audio = json.loads((SD / "audio.json").read_text(encoding="utf-8"))

    texts = set()
    for lesson in lessons:
        for w in lesson["words"]:
            texts.add(strip_acute(w["ru"]))
    for letter in alphabet:
        if letter.get("hint_word"):
            texts.add(strip_acute(letter["hint_word"]))
    texts = {t for t in texts if t.strip()}

    print(f"rendering/caching {len(texts)} learn-module clips...")
    manifest = await bd.render_audio(texts)   # writes mp3s, returns {text: path}
    audio.update(manifest)
    bd._write(SD / "audio.json", audio)
    print(f"-> audio.json now {len(audio)} clips")


if __name__ == "__main__":
    asyncio.run(main())
