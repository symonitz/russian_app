from datetime import datetime, timezone

from ruslearn.srs import SRSService


def _now():
    return datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)


def test_new_card_is_json_dict_in_learning_state():
    card = SRSService().new_card()
    assert isinstance(card, dict)
    assert card["state"] == 1  # fsrs State.Learning


def test_review_good_keeps_learning_and_advances_due():
    srs = SRSService()
    out = srs.review(None, rating=3, now=_now())  # Good
    assert out.card["state"] == 1                 # still Learning
    assert out.due > _now()                       # rescheduled into the future
    assert out.log["rating"] == 3


def test_review_easy_graduates_to_known_state():
    srs = SRSService()
    out = srs.review(None, rating=4, now=_now())  # Easy
    assert out.card["state"] == 2                 # fsrs State.Review
    assert SRSService.is_graduated(out.card) is True


def test_review_roundtrips_existing_card():
    srs = SRSService()
    first = srs.review(None, rating=3, now=_now())
    second = srs.review(first.card, rating=3, now=out_later())
    assert second.due > first.due


def out_later():
    return datetime(2026, 1, 2, 12, 0, tzinfo=timezone.utc)
