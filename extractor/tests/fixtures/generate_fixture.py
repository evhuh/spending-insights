"""Generate the synthetic statement fixture PDF.

Reproduces the real statement layout (see CLAUDE.md §8): a `Transactions` heading,
the two bold sub-sections, 7 columns laid out at fixed x positions, MM/DD dates,
messy descriptions, a negative payment line, subtotal lines with the `Total` column
populated, and a closing date elsewhere in the document.

Run from `extractor/` to (re)create `tests/fixtures/sample_statement.pdf`:

    uv run python tests/fixtures/generate_fixture.py
"""

from pathlib import Path

from reportlab.lib.pagesizes import LETTER
from reportlab.pdfgen import canvas

OUT = Path(__file__).parent / "sample_statement.pdf"

# Column x positions (points). The extractor derives its bands from the header row's
# word positions, so data cells are drawn at the same x as their column header.
COLS = {
    "transaction_date": 36,
    "posting_date": 105,
    "description": 175,
    "reference": 385,
    "account": 448,
    "amount": 502,
    "total": 556,
}

PURCHASES = [
    ("04/22", "04/23", "CHICK-FIL-A #03663 NORTH HAVEN CT", "7501", "1234", "12.66"),
    ("04/25", "04/26", "SQ *NICE DAY CHINESE NEW gosq.com CT", "7502", "1234", "28.41"),
    ("05/02", "05/03", "SQ *NICE DAY CHINESE NEW gosq.com CT", "7503", "1234", "19.92"),
    ("05/05", "05/06", "TST*ATTICUS BOOKSTORE CA New Haven CT", "7504", "1234", "31.50"),
]

PAYMENTS = [
    ("04/28", "04/29", "PAYMENT - THANK YOU", "7500", "1234", "-1,250.00"),
]


def main() -> None:
    c = canvas.Canvas(str(OUT), pagesize=LETTER)
    _, height = LETTER
    y = height - 60

    def line(font: str, size: int, cells: dict[str, str]) -> None:
        nonlocal y
        c.setFont(font, size)
        for col, text in cells.items():
            c.drawString(COLS[col], y, text)
        y -= 18

    def text_line(text: str, font: str = "Helvetica", size: int = 10, x: int = 36) -> None:
        nonlocal y
        c.setFont(font, size)
        c.drawString(x, y, text)
        y -= 18

    # Preamble — the closing date lives here, NOT in the transactions table.
    text_line("CashRewards Visa - Account Statement", "Helvetica-Bold", 14)
    text_line("Statement Closing Date: 05/20/2026")
    text_line("Account summary and rewards details appear on page 2.")
    y -= 18

    # Transactions table.
    text_line("Transactions", "Helvetica-Bold", 12)
    # Column headers are stacked on two lines, as on the real statement
    # ("Transaction" / "Date" etc.) — single-line labels would overlap.
    line(
        "Helvetica-Bold",
        9,
        {
            "transaction_date": "Transaction",
            "posting_date": "Posting",
            "description": "Description",
            "reference": "Reference",
            "account": "Account",
            "amount": "Amount",
            "total": "Total",
        },
    )
    line(
        "Helvetica-Bold",
        9,
        {
            "transaction_date": "Date",
            "posting_date": "Date",
            "reference": "Number",
            "account": "Number",
        },
    )

    text_line("Payments and Other Credits", "Helvetica-Bold", 10)
    for tdate, pdate, desc, ref, acct, amount in PAYMENTS:
        line(
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
    line(
        "Helvetica-Bold",
        9,
        {"description": "TOTAL PAYMENTS AND OTHER CREDITS FOR THIS PERIOD", "total": "-1,250.00"},
    )

    text_line("Purchases and Adjustments", "Helvetica-Bold", 10)
    for tdate, pdate, desc, ref, acct, amount in PURCHASES:
        line(
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
    line(
        "Helvetica-Bold",
        9,
        {"description": "TOTAL PURCHASES AND ADJUSTMENTS FOR THIS PERIOD", "total": "92.49"},
    )

    c.save()
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
