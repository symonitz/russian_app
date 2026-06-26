from datetime import datetime, timezone

import pytest

# NOTE: the backend deps (sqlalchemy via ruslearn.db, fsrs via ruslearn.srs) are
# imported lazily INSIDE the fixtures below, not at module top level. pytest loads
# this conftest for the whole tests/ tree at collection time, so a top-level import
# would force every run (incl. the hermetic CI data-test run that installs only
# `pytest regex`) to have the heavy backend stack. Keeping them fixture-local lets
# the accent/dataset tests collect without it.


@pytest.fixture
def session(tmp_path):
    from ruslearn.db import init_db, make_engine, make_session_factory

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
    from ruslearn.srs import SRSService

    return SRSService()


@pytest.fixture
def now():
    return datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
