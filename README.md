# Finance Intelligence Dashboard

Local-first personal finance analytics. Upload a credit-card statement PDF, get
extracted + categorized transactions in an editable dashboard, and sync a monthly
spending report to Notion.

## Architecture

| Folder       | Runtime                       | Owns                                                                  |
| ------------ | ----------------------------- | --------------------------------------------------------------------- |
| `web/`       | Next.js (App Router) + TS     | Classification, Prisma/Postgres, dashboard, analytics, Notion sync     |
| `extractor/` | Python 3.11+ / FastAPI        | PDF parsing only: pdfplumber layout extraction + AI parse-to-schema    |

The two communicate over HTTP on localhost: `web`'s `/api/upload` streams PDF bytes
to the extractor's `POST /extract`. The PDF is never written to disk.

## Prerequisites

- Node.js 20+
- Python 3.11+ with [uv](https://docs.astral.sh/uv/)
- A local PostgreSQL instance

## Setup

```bash
# web
cd web
npm install
cp .env.example .env   # fill in DATABASE_URL, TEST_DATABASE_URL, OPENAI_API_KEY,
                       # NOTION_API_KEY, NOTION_DATABASE_ID (EXTRACTOR_URL defaults
                       # to http://localhost:8000)

# extractor
cd ../extractor
uv sync
cp .env.example .env   # fill in OPENAI_API_KEY
```

## Run

```bash
make dev   # from the repo root: Next.js on :3000 and the extractor on :8000
```

Or individually:

```bash
cd web && npm run dev                                      # http://localhost:3000
cd extractor && uv run uvicorn app.main:app --reload       # http://localhost:8000
```

Sanity check: `curl localhost:8000/health` → `{"status":"ok"}`.

## Develop

```bash
make test        # Vitest (web) + pytest (extractor)
make typecheck   # tsc --noEmit + ruff
make lint        # ESLint + ruff
```
