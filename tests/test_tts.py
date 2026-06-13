import asyncio

import pytest

import ruslearn.tts as tts_mod
from ruslearn.tts import TTSService


class _FakeCommunicate:
    calls = 0

    def __init__(self, text, voice):
        self.text = text
        self.voice = voice

    async def save(self, path):
        _FakeCommunicate.calls += 1
        with open(path, "wb") as fh:
            fh.write(b"FAKEMP3")


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    _FakeCommunicate.calls = 0
    monkeypatch.setattr(tts_mod.edge_tts, "Communicate", _FakeCommunicate)


def test_synthesize_creates_file(tmp_path):
    svc = TTSService(tmp_path / "tts")
    path = asyncio.run(svc.synthesize("привет"))
    assert path.exists()
    assert path.read_bytes() == b"FAKEMP3"


def test_synthesize_caches_and_does_not_regenerate(tmp_path):
    svc = TTSService(tmp_path / "tts")
    p1 = asyncio.run(svc.synthesize("привет"))
    p2 = asyncio.run(svc.synthesize("привет"))
    assert p1 == p2
    assert _FakeCommunicate.calls == 1  # second call served from cache


def test_different_text_or_voice_gets_different_file(tmp_path):
    svc = TTSService(tmp_path / "tts")
    a = asyncio.run(svc.synthesize("привет"))
    b = asyncio.run(svc.synthesize("пока"))
    c = asyncio.run(svc.synthesize("привет", voice="ru-RU-DmitryNeural"))
    assert len({a, b, c}) == 3


def test_synthesize_rejects_empty(tmp_path):
    svc = TTSService(tmp_path / "tts")
    with pytest.raises(ValueError):
        asyncio.run(svc.synthesize("   "))
