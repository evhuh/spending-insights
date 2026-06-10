from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from app.extraction import extract_layout

FIXTURE = Path(__file__).parent / "fixtures" / "sample_statement.pdf"


@pytest.fixture(scope="module")
def layout():
    return extract_layout(FIXTURE.read_bytes())


def test_row_count(layout):
    # 4 purchases + 1 payment; headers and subtotal lines are not rows.
    assert len(layout.rows) == 5
    assert len([r for r in layout.rows if r.section == "purchases"]) == 4
    assert len([r for r in layout.rows if r.section == "payments"]) == 1


def test_section_tagging_and_amounts(layout):
    payment = next(r for r in layout.rows if r.section == "payments")
    assert payment.amount == Decimal("-1250.00")
    assert payment.transaction_date_mmdd == "04/28"

    purchases = [r for r in layout.rows if r.section == "purchases"]
    assert [r.amount for r in purchases] == [
        Decimal("12.66"),
        Decimal("28.41"),
        Decimal("19.92"),
        Decimal("31.50"),
    ]
    assert [r.transaction_date_mmdd for r in purchases] == [
        "04/22",
        "04/25",
        "05/02",
        "05/05",
    ]


def test_descriptions_are_raw_and_messy(layout):
    descriptions = [r.description for r in layout.rows if r.section == "purchases"]
    assert descriptions == [
        "CHICK-FIL-A #03663 NORTH HAVEN CT",
        "SQ *NICE DAY CHINESE NEW gosq.com CT",
        "SQ *NICE DAY CHINESE NEW gosq.com CT",
        "TST*ATTICUS BOOKSTORE CA New Haven CT",
    ]


def test_headers_and_subtotals_excluded(layout):
    for row in layout.rows:
        assert "TOTAL" not in row.description
        assert row.description.lower() not in (
            "payments and other credits",
            "purchases and adjustments",
        )


def test_account_number_never_captured(layout):
    # The fixture's Account Number column is "1234" on every row (invariant 3).
    for row in layout.rows:
        assert "1234" not in row.description


def test_closing_date_captured(layout):
    assert layout.closing_date == date(2026, 5, 20)


def test_statement_totals_captured(layout):
    assert layout.statement_totals["purchases"] == Decimal("92.49")
    assert layout.statement_totals["payments"] == Decimal("-1250.00")
    purchase_sum = sum(r.amount for r in layout.rows if r.section == "purchases")
    assert purchase_sum == layout.statement_totals["purchases"]
