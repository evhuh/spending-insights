"""Diagnose why extraction finds no/wrong rows in a real statement PDF.

Prints STRUCTURAL information only — all digit runs are masked with '#' so no
amounts, account numbers, or reference numbers appear in the output. Safe to
paste back to Claude Code for tuning.

Usage (from extractor/):
    uv run python tools/diagnose.py /path/to/statement.pdf
"""

from __future__ import annotations

import io
import re
import sys
from pathlib import Path

import pdfplumber

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.extraction import (  # noqa: E402
    HEADER_TOKEN_TO_COLUMN,
    SECTION_HEADERS,
    _collect_header_starts,
    _lines,
    extract_layout,
)

MASK = re.compile(r"\d")


def mask(text: str) -> str:
    return MASK.sub("#", text)


def main(path: str) -> None:
    pdf_bytes = Path(path).read_bytes()

    print("=== extract_layout result ===")
    layout = extract_layout(pdf_bytes)
    print(f"closing_date found: {layout.closing_date is not None} -> {layout.closing_date}")
    by_section: dict[str, int] = {}
    for row in layout.rows:
        by_section[row.section] = by_section.get(row.section, 0) + 1
    print(f"rows: {len(layout.rows)} by section: {by_section}")
    print(f"statement_totals captured for sections: {list(layout.statement_totals)}")

    print("\n=== structural scan (digits masked) ===")
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        print(f"pages: {len(pdf.pages)}")
        for page_number, page in enumerate(pdf.pages, 1):
            for line in _lines(page):
                text = " ".join(w["text"] for w in line)
                lower = text.strip().lower()

                if lower == "transactions":
                    print(f"p{page_number}: EXACT 'Transactions' heading line found")
                elif "transaction" in lower and len(lower) < 60:
                    print(f"p{page_number}: line containing 'transaction': {mask(text)!r}")

                if any(h in lower for h in SECTION_HEADERS):
                    print(f"p{page_number}: section-header EXACT match: {mask(text)!r}")
                elif "payments and" in lower or "purchases and" in lower:
                    print(f"p{page_number}: section-ish line (NOT exact): {mask(text)!r}")

                token_hits = [w["text"] for w in line if w["text"] in HEADER_TOKEN_TO_COLUMN]
                if len(token_hits) >= 3:
                    starts: dict[str, float] = {}
                    _collect_header_starts(line, starts)
                    words = [(w["text"], round(w["x0"])) for w in line]
                    print(
                        f"p{page_number}: header-ish line (hits={len(token_hits)}, "
                        f"columns={sorted(starts)}): {words}"
                    )

                if lower.startswith("total"):
                    print(f"p{page_number}: TOTAL line: {mask(text)!r}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1])
