from ruslearn.models import Lemma, Knowledge


def test_can_persist_lemma_with_knowledge(session):
    lemma = Lemma(cyrillic="дом", stressed="дом", gloss_en="house", freq_rank=1)
    lemma.knowledge = Knowledge(state="new")
    session.add(lemma)
    session.commit()

    fetched = session.query(Lemma).filter_by(cyrillic="дом").one()
    assert fetched.gloss_en == "house"
    assert fetched.knowledge.state == "new"


from datetime import timedelta

from ruslearn.lexicon import LexiconStore


def _store(session, srs):
    return LexiconStore(session, srs)


def _seed_three(store):
    store.add_lemma(cyrillic="я", stressed="я", gloss_en="I", freq_rank=1)
    store.add_lemma(cyrillic="дом", stressed="дом", gloss_en="house", freq_rank=2)
    store.add_lemma(cyrillic="кот", stressed="кот", gloss_en="cat", freq_rank=3)


def _now():
    from datetime import datetime, timezone
    return datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)


def test_add_lemma_creates_new_knowledge(session, srs):
    store = _store(session, srs)
    store.add_lemma(cyrillic="дом", stressed="дом", gloss_en="house", freq_rank=2)
    counts = store.counts(now=_now())
    assert counts["new"] == 1
    assert counts["learning"] == 0
    assert counts["due"] == 0


def test_introduce_next_picks_lowest_freq_rank_and_makes_due(session, srs, now):
    store = _store(session, srs)
    _seed_three(store)
    introduced = store.introduce_next(now=now, count=2)
    assert [l.cyrillic for l in introduced] == ["я", "дом"]  # by freq_rank
    due = store.get_due(now=now, limit=10)
    assert {k.lemma.cyrillic for k in due} == {"я", "дом"}


def test_record_review_good_keeps_learning(session, srs, now):
    store = _store(session, srs)
    _seed_three(store)
    (lemma,) = store.introduce_next(now=now, count=1)
    k = store.record_review(lemma.id, rating=3, now=now)
    assert k.state == "learning"
    # no longer due at `now` (rescheduled into the future)
    assert store.get_due(now=now, limit=10) == []


def test_record_review_easy_marks_known_and_logs(session, srs, now):
    store = _store(session, srs)
    _seed_three(store)
    (lemma,) = store.introduce_next(now=now, count=1)
    k = store.record_review(lemma.id, rating=4, now=now)
    assert k.state == "known"
    assert store.counts(now=now)["known"] == 1
    from ruslearn.models import ReviewLogEntry
    assert session.query(ReviewLogEntry).count() == 1


def test_known_words_peek_and_introduce_lemma(session, srs):
    store = _store(session, srs)
    _seed_three(store)  # я(1), дом(2), кот(3)
    assert store.known_words() == []
    assert store.peek_next_new().cyrillic == "я"  # lowest freq_rank
    store.introduce_next(_now(), count=2)
    assert set(store.known_words()) == {"я", "дом"}
    kot = store.peek_next_new()
    assert kot.cyrillic == "кот"
    k = store.introduce_lemma(kot.id, _now())
    assert k.state == "learning"
    assert "кот" in store.known_words()
