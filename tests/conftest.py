from datetime import datetime, timezone

import pytest

from ruslearn.db import init_db, make_engine, make_session_factory
from ruslearn.srs import SRSService


@pytest.fixture
def session(tmp_path):
    engine = make_engine(tmp_path / "test.db")
    init_db(engine)
    factory = make_session_factory(engine)
    s = factory()
    try:
        yield s
    finally:
        s.close()


@pytest.fixture
def srs():
    return SRSService()


@pytest.fixture
def now():
    return datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
