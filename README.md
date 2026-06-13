# ruslearn — Personal Russian Learning App

A local, single-user app for learning Russian from zero. **M1 (this milestone):**
an offline Cyrillic alphabet trainer and a spaced-repetition vocabulary
reviewer, seeded with starter words. No network required.

See the design in [docs/superpowers/specs/2026-06-13-russian-learning-platform-design.md](docs/superpowers/specs/2026-06-13-russian-learning-platform-design.md).

## Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
```

## Run

```bash
python -m ruslearn
# open http://127.0.0.1:8000
```

The SQLite database is created at `data/russian.db` on first run and is
seeded automatically from `data/seed_words.csv` and `data/alphabet.json`.

## Test

```bash
pytest -q
```

## Roadmap

- **M2** — LLM-generated reading at ~98% known-word coverage, edge-tts audio.
- **M3** — stats, settings, stress-weaning, grammar notes, FSRS optimizer.
