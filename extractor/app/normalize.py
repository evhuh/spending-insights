"""Normalization: filter to spending, resolve full dates, validate totals."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from pydantic import BaseModel

from app.extraction import Section
from app.parser import ParsedRow

# Used when neither a closing date nor a statementYear is available; the caller
# sees year_resolved=False and must handle these dates.
PLACEHOLDER_YEAR = 1900

# The statement subtotal and our sum may disagree by a rounding cent or two.
MATCH_TOLERANCE = Decimal("0.02")


class NormalizedTransaction(BaseModel):
    date: date
    merchant: str
    raw_description: str
    amount: Decimal


class StatementPeriod(BaseModel):
    year: int
    closing_date: date | None
    year_resolved: bool


class Validation(BaseModel):
    extracted_purchase_total: Decimal
    statement_purchase_total: Decimal | None
    match: bool


class NormalizedStatement(BaseModel):
    statement_period: StatementPeriod
    transactions: list[NormalizedTransaction]
    validation: Validation


def normalize(
    rows: list[ParsedRow],
    closing_date: date | None,
    statement_year: int | None,
    statement_totals: dict[Section, Decimal],
) -> NormalizedStatement:
    # Spending only (CLAUDE.md invariant 2): keep positive purchase rows; the
    # payments/credits section and any stray negatives are dropped.
    kept = [row for row in rows if row.section == "purchases" and row.amount > 0]

    if closing_date is not None:
        year, year_resolved = closing_date.year, True
    elif statement_year is not None:
        year, year_resolved = statement_year, True
    else:
        year, year_resolved = PLACEHOLDER_YEAR, False

    transactions = [
        NormalizedTransaction(
            date=_resolve_date(row.transaction_date_mmdd, year, closing_date),
            merchant=row.merchant,
            raw_description=row.raw_description,
            amount=row.amount,
        )
        for row in kept
    ]

    extracted_total = sum((t.amount for t in transactions), Decimal("0"))
    statement_total = statement_totals.get("purchases")
    match = (
        statement_total is not None
        and abs(extracted_total - statement_total) <= MATCH_TOLERANCE
    )

    return NormalizedStatement(
        statement_period=StatementPeriod(
            year=year, closing_date=closing_date, year_resolved=year_resolved
        ),
        transactions=transactions,
        validation=Validation(
            extracted_purchase_total=extracted_total,
            statement_purchase_total=statement_total,
            match=match,
        ),
    )


def _resolve_date(mmdd: str, year: int, closing_date: date | None) -> date:
    month, day = (int(part) for part in mmdd.split("/"))
    # Dec→Jan rollover: a transaction month after the closing month belongs to
    # the prior year (e.g. 12/30 on a statement closing 01/15).
    if closing_date is not None and month > closing_date.month:
        year -= 1
    return date(year, month, day)
