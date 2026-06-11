import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app, get_merchant_namer
from tests.conftest import FakeNamer

FIXTURE = Path(__file__).parent / "fixtures" / "sample_statement.pdf"


@pytest.fixture
def client():
    app.dependency_overrides[get_merchant_namer] = FakeNamer
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def _post_fixture(client: TestClient, data: dict | None = None):
    return client.post(
        "/extract",
        files={"file": ("sample_statement.pdf", FIXTURE.read_bytes(), "application/pdf")},
        data=data or {},
    )


def test_extract_returns_contract(client):
    response = _post_fixture(client)
    assert response.status_code == 200
    body = response.json()

    assert body["statementPeriod"] == {
        "year": 2026,
        "closingDate": "2026-05-20",
        "yearResolved": True,
    }

    transactions = body["transactions"]
    assert len(transactions) == 4  # the payment line is dropped
    assert all(t["amount"] > 0 for t in transactions)
    assert all(t["date"].startswith("2026-") for t in transactions)

    chick = transactions[0]
    assert chick == {
        "date": "2026-04-22",
        "merchant": "Chick-fil-A",
        "rawDescription": "CHICK-FIL-A #03663 NORTH HAVEN CT",
        "amount": 12.66,
    }

    # Both NICE DAY rows normalize to the same merchant.
    nice_days = [t for t in transactions if t["merchant"] == "Nice Day Chinese"]
    assert len(nice_days) == 2

    assert body["validation"] == {
        "extractedPurchaseTotal": 92.49,
        "statementPurchaseTotal": 92.49,
        "match": True,
    }


def test_closing_date_wins_over_statement_year_param(client):
    response = _post_fixture(client, data={"statementYear": "2019"})
    assert response.status_code == 200
    assert response.json()["statementPeriod"]["year"] == 2026


def test_no_file_is_written(client, monkeypatch, tmp_path):
    """The PDF must be processed in memory only (CLAUDE.md invariant 1)."""

    def forbidden(*args, **kwargs):
        raise AssertionError("attempted to create a file on disk during /extract")

    monkeypatch.setattr(tempfile, "NamedTemporaryFile", forbidden)
    monkeypatch.setattr(tempfile, "mkstemp", forbidden)
    monkeypatch.setattr(tempfile, "mkdtemp", forbidden)
    monkeypatch.chdir(tmp_path)  # any stray relative-path write would land here

    response = _post_fixture(client)

    assert response.status_code == 200
    assert list(tmp_path.iterdir()) == []


def test_namer_failure_returns_502_with_cause(client):
    class ExplodingNamer:
        def standardize(self, rows):
            raise RuntimeError("OpenAI quota exceeded")

    app.dependency_overrides[get_merchant_namer] = ExplodingNamer
    try:
        response = _post_fixture(client)
    finally:
        app.dependency_overrides[get_merchant_namer] = FakeNamer

    assert response.status_code == 502
    assert "OpenAI quota exceeded" in response.json()["detail"]
