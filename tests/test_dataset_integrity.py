"""Regression guards over the built dataset (site/data/*.json)."""
import json
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "site" / "data"
ACUTE = "́"  # U+0301


def _load(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def test_no_audio_key_has_combining_acute():
    audio = _load("audio.json")
    bad = [k for k in audio if ACUTE in k]
    assert bad == [], f"audio keys must be accent-stripped, found: {bad[:5]}"


def test_audio_manifest_is_populated():
    assert len(_load("audio.json")) > 500


def test_yo_was_restored_in_vocab():
    words = _load("words.json")
    assert sum(1 for w in words if "ё" in w["stressed"]) >= 10


def test_stress_marks_present_in_vocab():
    words = _load("words.json")
    assert sum(1 for w in words if ACUTE in w["stressed"]) >= 100


def test_every_pattern_answer_is_nonempty_strings():
    for p in _load("patterns.json"):
        for item in p["items"]:
            ans = item["answer"]
            assert ans and all(isinstance(x, str) and x for x in ans), item


def test_reading_glossary_keys_are_accent_free():
    for e in _load("reading.json"):
        for k in (e.get("glossary") or {}):
            assert ACUTE not in k, f"glossary key has acute: {k!r}"
