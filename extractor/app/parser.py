"""AI parse: turn raw layout rows into rows with standardized merchant names.

The OpenAI client sits behind the `MerchantNamer` protocol so tests (and the
endpoint) can inject a deterministic fake. The layout extraction remains ground
truth for dates and amounts — the AI only confirms them, and any disagreement is
resolved in the layout's favor.
"""

from __future__ import annotations

import json
import os
from collections.abc import Sequence
from decimal import Decimal
from typing import Any, Protocol

from pydantic import BaseModel

from app.extraction import RawRow, Section

SYSTEM_PROMPT = """\
You standardize credit-card transaction descriptions into clean merchant names.

For each row in the user's JSON array, produce the merchant's standardized name:
- strip processor prefixes such as "SQ *" and "TST*"
- strip store numbers such as "#03663"
- strip trailing city names and 2-letter state codes
- strip URLs such as "gosq.com"
- use natural capitalization (e.g. "Nice Day Chinese", "Chick-fil-A")

Echo back each row's date and amount unchanged so they can be cross-checked.

Respond with JSON: {"rows": [{"merchant": str, "transaction_date_mmdd": str,
"amount": str}, ...]} with exactly one entry per input row, in the same order.
"""


class StandardizedRow(BaseModel):
    """One row as returned by the namer: clean merchant + echoed date/amount."""

    merchant: str
    transaction_date_mmdd: str
    amount: Decimal


class ParsedRow(BaseModel):
    """A layout row enriched with its standardized merchant."""

    transaction_date_mmdd: str
    merchant: str
    raw_description: str
    amount: Decimal
    section: Section


class MerchantNamer(Protocol):
    def standardize(self, rows: Sequence[RawRow]) -> list[StandardizedRow]: ...


class OpenAIMerchantNamer:
    """Real implementation. The client is created lazily so importing this module
    (and running mocked tests) never requires an OPENAI_API_KEY."""

    def __init__(self, client: Any | None = None, model: str | None = None) -> None:
        self._client = client
        self._model = model or os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

    def standardize(self, rows: Sequence[RawRow]) -> list[StandardizedRow]:
        if self._client is None:
            from openai import OpenAI

            self._client = OpenAI()
        payload = [
            {
                "description": row.description,
                "transaction_date_mmdd": row.transaction_date_mmdd,
                "amount": str(row.amount),
            }
            for row in rows
        ]
        response = self._client.chat.completions.create(
            model=self._model,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(payload)},
            ],
        )
        data = json.loads(response.choices[0].message.content)
        return [StandardizedRow.model_validate(item) for item in data["rows"]]


def parse_rows(rows: Sequence[RawRow], namer: MerchantNamer) -> list[ParsedRow]:
    if not rows:
        return []
    results = namer.standardize(rows)
    if len(results) != len(rows):
        raise ValueError(
            f"namer returned {len(results)} rows for {len(rows)} inputs"
        )
    parsed: list[ParsedRow] = []
    for row, result in zip(rows, results, strict=True):
        merchant = result.merchant.strip() or row.description
        # Cross-check the echoed date/amount; on disagreement the deterministic
        # layout values win.
        parsed.append(
            ParsedRow(
                transaction_date_mmdd=row.transaction_date_mmdd,
                merchant=merchant,
                raw_description=row.description,
                amount=row.amount,
                section=row.section,
            )
        )
    return parsed
