from fastapi.testclient import TestClient

from ruslearn.api import create_app


def _client(tmp_path):
    app = create_app(db_path=tmp_path / "api.db", tts_cache_dir=tmp_path / "tts")
    return TestClient(app)


def test_audio_endpoint_returns_mp3(tmp_path, monkeypatch):
    import ruslearn.tts as tts_mod

    class _Fake:
        def __init__(self, text, voice):
            pass

        async def save(self, path):
            with open(path, "wb") as fh:
                fh.write(b"ID3FAKE")

    monkeypatch.setattr(tts_mod.edge_tts, "Communicate", _Fake)
    client = _client(tmp_path)
    r = client.get("/api/audio", params={"text": "приве́т"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("audio/mpeg")
    assert r.content == b"ID3FAKE"


def test_audio_endpoint_requires_text(tmp_path):
    client = _client(tmp_path)
    r = client.get("/api/audio", params={"text": "   "})
    assert r.status_code == 400


def test_reading_needs_more_when_nothing_known(tmp_path):
    client = _client(tmp_path)  # fresh DB, 0 introduced
    r = client.get("/api/reading/next")
    assert r.status_code == 200
    assert r.json()["needs_more"] is True


def test_reading_generates_passage_with_injected_generator(tmp_path):
    from ruslearn.reader import Passage

    class _FakeGen:
        async def generate(self, known, new_word, new_gloss):
            return Passage(
                text="Это [[белый]] дом.",
                glossary={"это": "this", "дом": "house", "белый": "white"},
                new_words=["белый"],
            )

    app = create_app(
        db_path=tmp_path / "api.db", tts_cache_dir=tmp_path / "tts", generator=_FakeGen()
    )
    client = TestClient(app)
    client.post("/api/vocab/introduce", json={"count": 5})  # known >= 3
    r = client.get("/api/reading/next")
    assert r.status_code == 200
    body = r.json()
    assert "[[белый]]" in body["passage"]
    assert body["glossary"]["дом"] == "house"
    assert body["new_word"]["cyrillic"]


def test_introduce_one_endpoint(tmp_path):
    client = _client(tmp_path)
    r = client.post("/api/vocab/1/introduce")  # lemma id 1 = "я" (freq_rank 1)
    assert r.status_code == 200
    assert r.json()["state"] == "learning"


def test_state_endpoint_reports_seeded_counts(tmp_path):
    client = _client(tmp_path)
    r = client.get("/api/state")
    assert r.status_code == 200
    body = r.json()
    assert body["vocab"]["new"] == 45            # seeded words
    assert body["alphabet"]["total"] == 33       # seeded letters


def test_introduce_then_review_vocab_flow(tmp_path):
    client = _client(tmp_path)
    intro = client.post("/api/vocab/introduce", json={"count": 1}).json()
    assert len(intro["introduced"]) == 1
    lemma_id = intro["introduced"][0]["id"]

    due = client.get("/api/vocab/due").json()
    assert any(card["id"] == lemma_id for card in due["cards"])

    r = client.post(f"/api/vocab/{lemma_id}/review", json={"rating": 4})  # Easy
    assert r.status_code == 200
    assert r.json()["state"] == "known"


def test_alphabet_due_and_answer_flow(tmp_path):
    client = _client(tmp_path)
    client.post("/api/alphabet/introduce", json={"count": 1})
    due = client.get("/api/alphabet/due").json()
    assert len(due["cards"]) >= 1
    letter_id = due["cards"][0]["id"]
    r = client.post(f"/api/alphabet/{letter_id}/answer", json={"rating": 3})
    assert r.status_code == 200
    assert r.json()["state"] in {"learning", "known"}


def test_root_serves_html(tmp_path):
    client = _client(tmp_path)
    r = client.get("/")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
