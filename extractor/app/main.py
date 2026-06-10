from typing import Annotated

from fastapi import Depends, FastAPI, File, Form, UploadFile

from app.extraction import extract_layout
from app.normalize import normalize
from app.parser import MerchantNamer, OpenAIMerchantNamer, parse_rows
from app.schemas import ExtractResponse

app = FastAPI(title="Statement Extractor")


def get_merchant_namer() -> MerchantNamer:
    return OpenAIMerchantNamer()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/extract", response_model=ExtractResponse)
async def extract(
    file: Annotated[UploadFile, File()],
    namer: Annotated[MerchantNamer, Depends(get_merchant_namer)],
    statement_year: Annotated[int | None, Form(alias="statementYear")] = None,
) -> ExtractResponse:
    # The PDF is processed entirely in memory and discarded with the request —
    # it is never written to disk (CLAUDE.md invariant 1).
    pdf_bytes = await file.read()
    layout = extract_layout(pdf_bytes)
    parsed = parse_rows(layout.rows, namer)
    statement = normalize(
        parsed, layout.closing_date, statement_year, layout.statement_totals
    )
    return ExtractResponse.from_normalized(statement)
