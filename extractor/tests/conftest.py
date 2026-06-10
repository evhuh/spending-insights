from collections.abc import Sequence

from app.extraction import RawRow
from app.parser import StandardizedRow

# Deterministic stand-in for OpenAI (self-tests never call the live API).
STANDARDIZED_NAMES = {
    "CHICK-FIL-A #03663 NORTH HAVEN CT": "Chick-fil-A",
    "SQ *NICE DAY CHINESE NEW gosq.com CT": "Nice Day Chinese",
    "TST*ATTICUS BOOKSTORE CA New Haven CT": "Atticus Bookstore Cafe",
    "PAYMENT - THANK YOU": "Payment",
}


class FakeNamer:
    def __init__(self) -> None:
        self.calls: list[list[str]] = []

    def standardize(self, rows: Sequence[RawRow]) -> list[StandardizedRow]:
        self.calls.append([row.description for row in rows])
        return [
            StandardizedRow(
                merchant=STANDARDIZED_NAMES.get(row.description, row.description),
                transaction_date_mmdd=row.transaction_date_mmdd,
                amount=row.amount,
            )
            for row in rows
        ]
