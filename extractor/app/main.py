from fastapi import FastAPI

app = FastAPI(title="Statement Extractor")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
