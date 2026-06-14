"""FastAPI app: wires SRS / lexicon / alphabet services to HTTP and serves
the static SPA. Contains no learning logic itself."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ruslearn.alphabet import AlphabetModule
from ruslearn.db import init_db, make_engine, make_session_factory
from ruslearn.gemini_cli import GeminiCLIProvider
from ruslearn.lexicon import LexiconStore
from ruslearn.reader import ContentGenerator
from ruslearn.seed import SeedImporter
from ruslearn.srs import SRSService
from ruslearn.tts import TTSService

ROOT = Path(__file__).resolve().parents[2]
WEB_DIR = Path(__file__).resolve().parent / "web"
DATA_DIR = ROOT / "data"
DEFAULT_DB = DATA_DIR / "russian.db"


class CountBody(BaseModel):
    count: int = 5


class RatingBody(BaseModel):
    rating: int


def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_app(
    db_path: Path | str = DEFAULT_DB,
    tts_cache_dir: Path | str | None = None,
    generator: ContentGenerator | None = None,
) -> FastAPI:
    engine = make_engine(db_path)
    init_db(engine)
    factory = make_session_factory(engine)
    srs = SRSService()
    tts = TTSService(tts_cache_dir or (DATA_DIR / "tts"))
    generator = generator or ContentGenerator(GeminiCLIProvider())

    # One-time idempotent seeding.
    with factory() as s:
        SeedImporter(s, srs).import_words(DATA_DIR / "seed_words.csv")
        import json

        letters = json.loads((DATA_DIR / "alphabet.json").read_text(encoding="utf-8"))
        AlphabetModule(s, srs).seed_letters(letters)
        s.commit()

    app = FastAPI(title="ruslearn")

    def session() -> Session:
        return factory()

    @app.get("/api/state")
    def state() -> dict:
        with session() as s:
            return {
                "vocab": LexiconStore(s, srs).counts(_now()),
                "alphabet": AlphabetModule(s, srs).overview(),
            }

    @app.post("/api/vocab/introduce")
    def vocab_introduce(body: CountBody) -> dict:
        with session() as s:
            store = LexiconStore(s, srs)
            lemmas = store.introduce_next(_now(), count=body.count)
            s.commit()
            return {
                "introduced": [
                    {"id": l.id, "cyrillic": l.cyrillic, "stressed": l.stressed,
                     "gloss_en": l.gloss_en, "translit": l.translit}
                    for l in lemmas
                ]
            }

    @app.get("/api/vocab/due")
    def vocab_due(limit: int = 20) -> dict:
        with session() as s:
            due = LexiconStore(s, srs).get_due(_now(), limit=limit)
            return {
                "cards": [
                    {"id": k.lemma.id, "cyrillic": k.lemma.cyrillic,
                     "stressed": k.lemma.stressed, "gloss_en": k.lemma.gloss_en,
                     "translit": k.lemma.translit, "is_cognate": k.lemma.is_cognate}
                    for k in due
                ]
            }

    @app.post("/api/vocab/{lemma_id}/review")
    def vocab_review(lemma_id: int, body: RatingBody) -> dict:
        with session() as s:
            k = LexiconStore(s, srs).record_review(lemma_id, body.rating, _now())
            s.commit()
            return {"lemma_id": lemma_id, "state": k.state}

    @app.post("/api/vocab/{lemma_id}/introduce")
    def vocab_introduce_one(lemma_id: int) -> dict:
        with session() as s:
            k = LexiconStore(s, srs).introduce_lemma(lemma_id, _now())
            s.commit()
            return {"lemma_id": lemma_id, "state": k.state}

    @app.post("/api/alphabet/introduce")
    def alpha_introduce(body: CountBody) -> dict:
        with session() as s:
            mod = AlphabetModule(s, srs)
            letters = mod.introduce_next(_now(), count=body.count)
            s.commit()
            return {"introduced": [{"id": l.id, "cyrillic": l.cyrillic} for l in letters]}

    @app.get("/api/alphabet/due")
    def alpha_due(limit: int = 20) -> dict:
        with session() as s:
            due = AlphabetModule(s, srs).get_due(_now(), limit=limit)
            return {
                "cards": [
                    {"id": lk.letter.id, "cyrillic": lk.letter.cyrillic,
                     "ipa": lk.letter.ipa, "friend_type": lk.letter.friend_type,
                     "latin_lookalike": lk.letter.latin_lookalike,
                     "example_word": lk.letter.example_word,
                     "example_gloss": lk.letter.example_gloss}
                    for lk in due
                ]
            }

    @app.post("/api/alphabet/{letter_id}/answer")
    def alpha_answer(letter_id: int, body: RatingBody) -> dict:
        with session() as s:
            lk = AlphabetModule(s, srs).record_answer(letter_id, body.rating, _now())
            s.commit()
            return {"letter_id": letter_id, "state": lk.state}

    @app.get("/api/reading/next")
    async def reading_next() -> dict:
        with session() as s:
            store = LexiconStore(s, srs)
            known = store.known_words()
            new = store.peek_next_new()
            new_info = (
                {"id": new.id, "cyrillic": new.cyrillic, "gloss": new.gloss_en}
                if new
                else None
            )
        if len(known) < 3:
            return {"needs_more": True, "known_count": len(known)}
        if new_info is None:
            return {"done": True}
        try:
            passage = await generator.generate(
                known, new_info["cyrillic"], new_info["gloss"]
            )
        except Exception:
            raise HTTPException(status_code=502, detail="generation failed")
        return {
            "passage": passage.text,
            "glossary": passage.glossary,
            "new_words": passage.new_words,
            "new_word": new_info,
        }

    @app.get("/api/audio")
    async def audio(text: str, voice: str | None = None) -> FileResponse:
        try:
            path = await tts.synthesize(text, voice)
        except ValueError:
            raise HTTPException(status_code=400, detail="text is required")
        except Exception:  # network / synthesis failure
            raise HTTPException(status_code=502, detail="audio unavailable")
        return FileResponse(path, media_type="audio/mpeg")

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(WEB_DIR / "index.html")

    app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")
    return app


app = create_app()
