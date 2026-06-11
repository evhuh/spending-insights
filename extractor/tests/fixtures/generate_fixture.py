"""Generate the synthetic statement fixture PDF.

Mirrors the REAL statement layout (verified against a redacted structural scan
of an actual statement, 2026-06): column x-positions, the two-line stacked
header split ("Transaction Posting Reference Account" above
"Date Date Description Number Number Amount Total"), $-prefixed amounts, the
transactions table spanning two pages with a "Transactions Continued" heading,
and trailing interest lines after the purchases subtotal.

Run from `extractor/` to (re)create `tests/fixtures/sample_statement.pdf`:

    uv run python tests/fixtures/generate_fixture.py
"""

from pathlib import Path

from reportlab.lib.pagesizes import LETTER
from reportlab.pdfgen import canvas

OUT = Path(__file__).parent / "sample_statement.pdf"

# Column x positions (points) — taken from the real statement's word scan.
COLS = {
    "transaction_date": 36,
    "posting_date": 82,
    "description": 117,
    "reference": 358,
    "account": 417,
    "amount": 496,
    "total": 559,
}

PAGE1_PURCHASES = [
    ("04/22", "04/23", "CHICK-FIL-A #03663 NORTH HAVEN CT", "7501", "1234", "$12.66"),
    ("04/25", "04/26", "SQ *NICE DAY CHINESE NEW gosq.com CT", "7502", "1234", "$28.41"),
    ("05/02", "05/03", "SQ *NICE DAY CHINESE NEW gosq.com CT", "7503", "1234", "$19.92"),
]

PAGE2_PURCHASES = [
    ("05/05", "05/06", "TST*ATTICUS BOOKSTORE CA New Haven  CT", "7504", "1234", "$31.50"),
]

PAYMENTS = [
    ("04/28", "04/29", "PAYMENT - THANK YOU", "7500", "1234", "-$1,250.00"),
]


class Page:
    def __init__(self, c: canvas.Canvas, height: float) -> None:
        self.c = c
        self.y = height - 60

    def line(self, font: str, size: int, cells: dict[str, str]) -> None:
        self.c.setFont(font, size)
        for col, text in cells.items():
            self.c.drawString(COLS[col], self.y, text)
        self.y -= 18

    def text(self, text: str, font: str = "Helvetica", size: int = 10, x: int = 36) -> None:
        self.c.setFont(font, size)
        self.c.drawString(x, self.y, text)
        self.y -= 18

    def header_rows(self) -> None:
        # The real statement stacks the column headers on two lines, with
        # Description/Amount/Total appearing only on the SECOND line.
        # 7pt like the real statement — at larger sizes "Transaction" (x=36)
        # would overlap "Posting" (x=82) and pdfplumber merges the words.
        self.line(
            "Helvetica-Bold",
            7,
            {
                "transaction_date": "Transaction",
                "posting_date": "Posting",
                "reference": "Reference",
                "account": "Account",
            },
        )
        self.line(
            "Helvetica-Bold",
            7,
            {
                "transaction_date": "Date",
                "posting_date": "Date",
                "description": "Description",
                "reference": "Number",
                "account": "Number",
                "amount": "Amount",
                "total": "Total",
            },
        )

    def txn_rows(self, rows: list[tuple[str, ...]]) -> None:
        for tdate, pdate, desc, ref, acct, amount in rows:
            self.line(
                "Helvetica",
                9,
                {
                    "transaction_date": tdate,
                    "posting_date": pdate,
                    "description": desc,
                    "reference": ref,
                    "account": acct,
                    "amount": amount,
                },
            )


def main() -> None:
    c = canvas.Canvas(str(OUT), pagesize=LETTER)
    _, height = LETTER

    # --- Page 1: summary preamble (closing date lives here) ---
    p = Page(c, height)
    p.text("CashRewards Visa - Account Statement", "Helvetica-Bold", 14)
    p.text("Statement Closing Date: 05/20/2026")
    p.text("Payments and Other Credits -$1,250.00")  # summary box, NOT the table
    p.text("Purchases and Adjustments $92.49")
    p.text("Total Credit Line $5,000.00")
    c.showPage()

    # --- Page 2: the transactions table begins ---
    p = Page(c, height)
    p.text("Transactions", "Helvetica-Bold", 12)
    p.header_rows()
    p.text("Payments and Other Credits", "Helvetica-Bold", 10)
    p.txn_rows(PAYMENTS)
    p.line(
        "Helvetica-Bold",
        9,
        {"description": "TOTAL PAYMENTS AND OTHER CREDITS FOR THIS PERIOD", "total": "-$1,250.00"},
    )
    p.text("Purchases and Adjustments", "Helvetica-Bold", 10)
    p.txn_rows(PAGE1_PURCHASES)
    c.showPage()

    # --- Page 3: table continues, then closes with totals + interest noise ---
    p = Page(c, height)
    p.text("Transactions Continued", "Helvetica-Bold", 12)
    p.header_rows()
    p.txn_rows(PAGE2_PURCHASES)
    p.line(
        "Helvetica-Bold",
        9,
        {"description": "TOTAL PURCHASES AND ADJUSTMENTS FOR THIS PERIOD", "total": "$92.49"},
    )
    # Lines after the purchases subtotal that must NOT become rows or totals:
    p.line(
        "Helvetica",
        9,
        {
            "transaction_date": "05/20",
            "description": "INTEREST CHARGED ON PURCHASES",
            "amount": "$0.00",
        },
    )
    p.line(
        "Helvetica-Bold",
        9,
        {"description": "TOTAL INTEREST CHARGED FOR THIS PERIOD", "total": "$0.00"},
    )
    p.text("Total fees charged in 2026 $0.00")
    c.save()
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
