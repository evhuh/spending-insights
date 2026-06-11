from typing import Annotated

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile

# uvicorn does not load .env by itself — without this, OPENAI_API_KEY from
# extractor/.env is never seen by the process.
load_dotenv()

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
    try:
        layout = extract_layout(pdf_bytes)
    except Exception as error:
        raise HTTPException(
            status_code=422, detail=f"could not parse the PDF layout: {error}"
        ) from error
    try:
        parsed = parse_rows(layout.rows, namer)
    except Exception as error:
        # Usually the OpenAI boundary (auth/quota) or a malformed AI response —
        # surface the cause instead of an opaque 500.
        raise HTTPException(
            status_code=502, detail=f"merchant standardization failed: {error}"
        ) from error
    statement = normalize(
        parsed, layout.closing_date, statement_year, layout.statement_totals
    )
    return ExtractResponse.from_normalized(statement)
