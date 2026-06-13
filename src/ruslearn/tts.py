"""Text-to-speech for Russian via edge-tts, cached to disk.

Audio is generated once per (voice, text) pair and cached as an mp3, so
repeated reviews never re-synthesize. edge-tts uses Microsoft's neural voices
(free, no API key) but needs network access at generation time.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

import edge_tts

DEFAULT_VOICE = "ru-RU-SvetlanaNeural"


class TTSService:
    def __init__(self, cache_dir: Path | str, voice: str = DEFAULT_VOICE) -> None:
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.voice = voice

    def _path_for(self, text: str, voice: str) -> Path:
        key = hashlib.sha1(f"{voice}|{text}".encode("utf-8")).hexdigest()
        return self.cache_dir / f"{key}.mp3"

    async def synthesize(self, text: str, voice: str | None = None) -> Path:
        """Return the path to an mp3 of `text`, generating + caching on miss."""
        text = text.strip()
        if not text:
            raise ValueError("text must not be empty")
        voice = voice or self.voice
        path = self._path_for(text, voice)
        if not path.exists():
            communicate = edge_tts.Communicate(text, voice)
            await communicate.save(str(path))
        return path
