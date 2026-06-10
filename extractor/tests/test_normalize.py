from datetime import date
from decimal import Decimal

from app.normalize import PLACEHOLDER_YEAR, normalize
from app.parser import ParsedRow


def _row(
    mmdd: str,
    amount: str,
    section: str = "purchases",
    merchant: str = "Some Merchant",
) -> ParsedRow:
    return ParsedRow(
        transaction_date_mmdd=mmdd,
        merchant=merchant,
        raw_description=f"RAW {merchant.upper()}",
        amount=Decimal(amount),
        section=section,
    )


def test_keeps_positive_purchases_only():
    rows = [
        _row("04/22", "12.66"),
        _row("04/28", "-1250.00", section="payments"),
        _row("04/29", "-5.00"),  # a refund inside purchases: still dropped
    ]
    result = normalize(rows, date(2026, 5, 20), None, {})

    assert [t.amount for t in result.transactions] == [Decimal("12.66")]
    assert all(t.amount > 0 for t in result.transactions)


def test_year_resolution_from_closing_date():
    rows = [_row("04/22", "12.66"), _row("05/02", "19.92")]
    result = normalize(rows, date(2026, 5, 20), None, {})

    assert result.statement_period.year == 2026
    assert result.statement_period.year_resolved is True
    assert result.statement_period.closing_date == date(2026, 5, 20)
    assert [t.date for t in result.transactions] == [date(2026, 4, 22), date(2026, 5, 2)]


def test_dec_to_jan_rollover():
    rows = [_row("12/30", "40.00"), _row("01/03", "7.50")]
    result = normalize(rows, date(2026, 1, 15), None, {})

    assert [t.date for t in result.transactions] == [date(2025, 12, 30), date(2026, 1, 3)]


def test_statement_year_param_when_no_closing_date():
    rows = [_row("04/22", "12.66")]
    result = normalize(rows, None, 2025, {})

    assert result.statement_period.year == 2025
    assert result.statement_period.year_resolved is True
    assert result.statement_period.closing_date is None
    assert result.transactions[0].date == date(2025, 4, 22)


def test_unresolved_year_uses_placeholder():
    rows = [_row("04/22", "12.66")]
    result = normalize(rows, None, None, {})

    assert result.statement_period.year_resolved is False
    assert result.statement_period.year == PLACEHOLDER_YEAR
    assert result.transactions[0].date == date(PLACEHOLDER_YEAR, 4, 22)


def test_validation_match_within_tolerance():
    rows = [_row("04/22", "12.66"), _row("04/25", "28.41")]
    totals = {"purchases": Decimal("41.08")}  # off by one cent
    result = normalize(rows, date(2026, 5, 20), None, totals)

    assert result.validation.extracted_purchase_total == Decimal("41.07")
    assert result.validation.statement_purchase_total == Decimal("41.08")
    assert result.validation.match is True


def test_validation_mismatch():
    rows = [_row("04/22", "12.66")]
    totals = {"purchases": Decimal("92.49")}
    result = normalize(rows, date(2026, 5, 20), None, totals)

    assert result.validation.match is False


def test_validation_without_statement_total():
    result = normalize([_row("04/22", "12.66")], date(2026, 5, 20), None, {})

    assert result.validation.statement_purchase_total is None
    assert result.validation.match is False
