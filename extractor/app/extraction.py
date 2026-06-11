"""Deterministic layout extraction from statement PDFs (no AI).

Reads the `Transactions` table using x-position bands derived from the column
header row, classifies each line (section header / subtotal / transaction row),
and captures the statement closing date from the full document text.

Everything operates on in-memory bytes — the PDF is never written to disk.
"""

from __future__ import annotations

import io
import re
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

import pdfplumber
from pydantic import BaseModel

Section = Literal["payments", "purchases"]

SECTION_HEADERS: dict[str, Section] = {
    "payments and other credits": "payments",
    "purchases and adjustments": "purchases",
}

# Column order is fixed; band starts come from the header row's word positions.
# The `account` band (card last four) is intentionally never read — see
# CLAUDE.md invariant 3.
HEADER_TOKEN_TO_COLUMN = {
    "Transaction": "transaction_date",
    "Posting": "posting_date",
    "Description": "description",
    "Reference": "reference",
    "Account": "account",
    "Amount": "amount",
    "Total": "total",
}

MMDD_RE = re.compile(r"^\d{2}/\d{2}$")
AMOUNT_RE = re.compile(r"^-?\$?[\d,]+\.\d{2}-?$")
CLOSING_DATE_RE = re.compile(
    r"(?:statement\s+)?closing\s+date:?\s+(\d{1,2}/\d{1,2}/\d{4})", re.IGNORECASE
)


class RawRow(BaseModel):
    """One transaction line, exactly as laid out — unfiltered, unnormalized."""

    transaction_date_mmdd: str
    description: str
    amount: Decimal
    section: Section


class LayoutExtraction(BaseModel):
    rows: list[RawRow]
    closing_date: date | None
    # Subtotal amounts read from `TOTAL ... FOR THIS PERIOD` lines, per section.
    statement_totals: dict[Section, Decimal]


def extract_layout(pdf_bytes: bytes) -> LayoutExtraction:
    rows: list[RawRow] = []
    statement_totals: dict[Section, Decimal] = {}
    closing_date: date | None = None

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        full_text = "\n".join(page.extract_text() or "" for page in pdf.pages)
        closing_date = _find_closing_date(full_text)

        in_transactions = False
        header_starts: dict[str, float] = {}
        bands: list[tuple[str, float]] | None = None
        section: Section | None = None

        for page in pdf.pages:
            for line in _lines(page):
                text = " ".join(w["text"] for w in line)

                if not in_transactions:
                    in_transactions = text.strip().lower() == "transactions"
                    continue

                if bands is None:
                    # Column headers are stacked across two lines on the real
                    # statement ("Transaction/Posting/Reference/Account" above
                    # "Date/Date/Description/Number/Number/Amount/Total"), so
                    # accumulate anchors over consecutive lines until all seven
                    # columns are placed.
                    _collect_header_starts(line, header_starts)
                    if len(header_starts) == len(HEADER_TOKEN_TO_COLUMN):
                        bands = sorted(header_starts.items(), key=lambda item: item[1])
                    continue

                normalized = text.strip().lower()
                if normalized in SECTION_HEADERS:
                    section = SECTION_HEADERS[normalized]
                    continue

                cells = _assign_to_bands(line, bands)
                upper = text.lstrip().upper()
                if upper.startswith("TOTAL") or _parse_amount(cells.get("total", "")):
                    # Subtotal-ish line: record the section's statement total
                    # (its own "TOTAL ... FOR THIS PERIOD" line) and close the
                    # section, so later interest/fee totals and rows in
                    # unrecognized sections can't be misattributed.
                    if section is not None and "FOR THIS PERIOD" in upper:
                        value = _first_amount(cells, ("total", "amount"))
                        if value is not None:
                            statement_totals[section] = value
                        section = None
                    continue

                row = _read_transaction_row(cells, section)
                if row is not None:
                    rows.append(row)

    return LayoutExtraction(
        rows=rows, closing_date=closing_date, statement_totals=statement_totals
    )


def _lines(page: pdfplumber.page.Page) -> list[list[dict]]:
    """Group the page's words into visual lines, top-to-bottom, left-to-right."""
    grouped: dict[int, list[dict]] = {}
    for word in page.extract_words():
        grouped.setdefault(round(word["top"] / 3), []).append(word)
    return [sorted(ws, key=lambda w: w["x0"]) for _, ws in sorted(grouped.items())]


def _collect_header_starts(line: list[dict], starts: dict[str, float]) -> None:
    """Record each column-header token's x position (first occurrence wins)."""
    for word in line:
        column = HEADER_TOKEN_TO_COLUMN.get(word["text"])
        if column is not None and column not in starts:
            starts[column] = word["x0"]


def _assign_to_bands(line: list[dict], bands: list[tuple[str, float]]) -> dict[str, str]:
    """Bucket each word into the rightmost band starting at or left of it."""
    cells: dict[str, list[str]] = {}
    for word in line:
        column = bands[0][0]
        for name, start in bands:
            if word["x0"] >= start - 2:
                column = name
        cells.setdefault(column, []).append(word["text"])
    return {column: " ".join(words) for column, words in cells.items()}


def _first_amount(cells: dict[str, str], columns: tuple[str, ...]) -> Decimal | None:
    """First parseable amount among the given bands (right-aligned values can
    start left of their column header). Safe even when the account band is
    listed: the card's last-four has no decimal point and never parses."""
    for column in columns:
        value = _parse_amount(cells.get(column, ""))
        if value is not None:
            return value
    return None


def _read_transaction_row(cells: dict[str, str], section: Section | None) -> RawRow | None:
    tdate = cells.get("transaction_date", "")
    amount = _first_amount(cells, ("amount", "account"))
    description = cells.get("description", "")
    if section is None or amount is None or not MMDD_RE.match(tdate) or not description:
        return None
    return RawRow(
        transaction_date_mmdd=tdate,
        description=description,
        amount=amount,
        section=section,
    )


def _parse_amount(text: str) -> Decimal | None:
    cleaned = text.strip()
    if not AMOUNT_RE.match(cleaned):
        return None
    negative = cleaned.startswith("-") or cleaned.endswith("-")
    digits = cleaned.strip("-").lstrip("$").replace(",", "")
    value = Decimal(digits)
    return -value if negative else value


def _find_closing_date(full_text: str) -> date | None:
    match = CLOSING_DATE_RE.search(full_text)
    if match is None:
        return None
    return datetime.strptime(match.group(1), "%m/%d/%Y").date()
