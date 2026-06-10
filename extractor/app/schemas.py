"""Wire format for POST /extract — the JSON contract from CLAUDE.md §2."""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from app.normalize import NormalizedStatement


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class StatementPeriodOut(CamelModel):
    year: int
    closing_date: date | None
    year_resolved: bool


class TransactionOut(CamelModel):
    date: date
    merchant: str
    raw_description: str
    amount: float


class ValidationOut(CamelModel):
    extracted_purchase_total: float
    statement_purchase_total: float | None
    match: bool


class ExtractResponse(CamelModel):
    statement_period: StatementPeriodOut
    transactions: list[TransactionOut]
    validation: ValidationOut

    @classmethod
    def from_normalized(cls, statement: NormalizedStatement) -> ExtractResponse:
        period = statement.statement_period
        validation = statement.validation
        return cls(
            statement_period=StatementPeriodOut(
                year=period.year,
                closing_date=period.closing_date,
                year_resolved=period.year_resolved,
            ),
            transactions=[
                TransactionOut(
                    date=t.date,
                    merchant=t.merchant,
                    raw_description=t.raw_description,
                    amount=float(t.amount),
                )
                for t in statement.transactions
            ],
            validation=ValidationOut(
                extracted_purchase_total=float(validation.extracted_purchase_total),
                statement_purchase_total=(
                    None
                    if validation.statement_purchase_total is None
                    else float(validation.statement_purchase_total)
                ),
                match=validation.match,
            ),
        )
