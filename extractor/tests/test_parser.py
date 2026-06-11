import json
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.extraction import RawRow
from app.parser import OpenAIMerchantNamer, StandardizedRow, parse_rows
from tests.conftest import FakeNamer


def _row(description: str, amount: str, mmdd: str = "04/22", section: str = "purchases") -> RawRow:
    return RawRow(
        transaction_date_mmdd=mmdd,
        description=description,
        amount=Decimal(amount),
        section=section,
    )


def test_parse_rows_standardizes_merchants():
    rows = [
        _row("SQ *NICE DAY CHINESE NEW gosq.com CT", "28.41", "04/25"),
        _row("SQ *NICE DAY CHINESE NEW gosq.com CT", "19.92", "05/02"),
        _row("CHICK-FIL-A #03663 NORTH HAVEN CT", "12.66"),
    ]
    parsed = parse_rows(rows, FakeNamer())

    # Both NICE DAY rows normalize to the same merchant.
    assert parsed[0].merchant == parsed[1].merchant == "Nice Day Chinese"
    assert parsed[2].merchant == "Chick-fil-A"
    # Raw descriptions are preserved for trust/debugging.
    assert parsed[2].raw_description == "CHICK-FIL-A #03663 NORTH HAVEN CT"


def test_parse_rows_layout_is_ground_truth_for_date_and_amount():
    class DriftingNamer(FakeNamer):
        def standardize(self, rows):
            # AI echoes back a wrong amount and date — layout values must win.
            return [
                StandardizedRow(
                    merchant="Chick-fil-A",
                    transaction_date_mmdd="01/01",
                    amount=Decimal("999.99"),
                )
            ]

    parsed = parse_rows([_row("CHICK-FIL-A #03663 NORTH HAVEN CT", "12.66")], DriftingNamer())
    assert parsed[0].amount == Decimal("12.66")
    assert parsed[0].transaction_date_mmdd == "04/22"


def test_parse_rows_blank_merchant_falls_back_to_description():
    class BlankNamer(FakeNamer):
        def standardize(self, rows):
            return [
                StandardizedRow(
                    merchant="  ",
                    transaction_date_mmdd=row.transaction_date_mmdd,
                    amount=row.amount,
                )
                for row in rows
            ]

    parsed = parse_rows([_row("MYSTERY VENDOR LLC", "5.00")], BlankNamer())
    assert parsed[0].merchant == "MYSTERY VENDOR LLC"


def test_parse_rows_rejects_length_mismatch():
    class ShortNamer(FakeNamer):
        def standardize(self, rows):
            return []

    with pytest.raises(ValueError, match="0 rows for 1 inputs"):
        parse_rows([_row("CHICK-FIL-A #03663 NORTH HAVEN CT", "12.66")], ShortNamer())


def test_parse_rows_empty_input_skips_namer():
    namer = FakeNamer()
    assert parse_rows([], namer) == []
    assert namer.calls == []


def test_openai_namer_parses_mocked_response():
    rows = [_row("SQ *NICE DAY CHINESE NEW gosq.com CT", "28.41", "04/25")]
    captured: dict = {}

    def create(**kwargs):
        captured.update(kwargs)
        content = json.dumps(
            {
                "rows": [
                    {
                        "merchant": "Nice Day Chinese",
                        "transaction_date_mmdd": "04/25",
                        "amount": "28.41",
                    }
                ]
            }
        )
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
        )

    fake_client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=create))
    )
    namer = OpenAIMerchantNamer(client=fake_client, model="test-model")
    results = namer.standardize(rows)

    assert results == [
        StandardizedRow(
            merchant="Nice Day Chinese",
            transaction_date_mmdd="04/25",
            amount=Decimal("28.41"),
        )
    ]
    assert captured["model"] == "test-model"
    # The raw description is sent to the model for standardization.
    assert "SQ *NICE DAY CHINESE" in captured["messages"][1]["content"]


def test_standardized_row_cleans_dollar_amounts():
    row = StandardizedRow(
        merchant="Payment", transaction_date_mmdd="04/28", amount="-$1,250.00"
    )
    assert row.amount == Decimal("-1250.00")


def test_openai_namer_tolerates_bare_array_response():
    def create(**kwargs):
        content = json.dumps(
            [{"merchant": "Chick-fil-A", "transaction_date_mmdd": "04/22", "amount": "$12.66"}]
        )
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
        )

    fake_client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=create))
    )
    results = OpenAIMerchantNamer(client=fake_client).standardize(
        [_row("CHICK-FIL-A #03663 NORTH HAVEN CT", "12.66")]
    )
    assert results[0].amount == Decimal("12.66")


def test_openai_namer_raises_clear_error_on_garbage():
    def create(**kwargs):
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="oops not json"))]
        )

    fake_client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=create))
    )
    with pytest.raises(ValueError, match="non-JSON"):
        OpenAIMerchantNamer(client=fake_client).standardize(
            [_row("CHICK-FIL-A #03663 NORTH HAVEN CT", "12.66")]
        )
