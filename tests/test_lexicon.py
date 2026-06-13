from ruslearn.models import Lemma, Knowledge


def test_can_persist_lemma_with_knowledge(session):
    lemma = Lemma(cyrillic="дом", stressed="дом", gloss_en="house", freq_rank=1)
    lemma.knowledge = Knowledge(state="new")
    session.add(lemma)
    session.commit()

    fetched = session.query(Lemma).filter_by(cyrillic="дом").one()
    assert fetched.gloss_en == "house"
    assert fetched.knowledge.state == "new"
