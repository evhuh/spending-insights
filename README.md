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
to the extractor's `POST /extract`. The PDF is never written to disk, raw statement
descriptors and account numbers are never stored, and only positive (spending)
transactions are kept.

## Prerequisites

- Node.js 20+
- Python 3.11+ with [uv](https://docs.astral.sh/uv/)
- A local PostgreSQL with two databases (real + test) — see `../POSTGRES_SETUP.md`
- API keys for OpenAI and Notion (live use only; tests never need them) — see
  `../MANUAL_SETUP.md`

## Setup

```bash
# web
cd web
npm install                  # also runs `prisma generate`
cp .env.example .env         # fill in DATABASE_URL, TEST_DATABASE_URL,
                             # OPENAI_API_KEY, NOTION_API_KEY, NOTION_DATABASE_ID
npx prisma migrate deploy    # apply migrations to DATABASE_URL
# repeat migrate deploy with DATABASE_URL=<TEST_DATABASE_URL value> for the test DB

# extractor
cd ../extractor
uv sync
cp .env.example .env         # fill in OPENAI_API_KEY
```

## Run

```bash
make dev   # from this folder: Next.js on :3000 and the extractor on :8000
```

Open http://localhost:3000 — upload a statement, edit categories inline, sync a
monthly report to Notion. Sanity check: `curl localhost:8000/health` →
`{"status":"ok"}`.

## Develop

```bash
make test        # Vitest (web, needs TEST_DATABASE_URL) + pytest (extractor)
make typecheck   # tsc --noEmit + ruff
make lint        # ESLint + ruff
```

All external boundaries (OpenAI, Notion, the extractor HTTP call) are mocked in
tests; DB-backed tests hit `TEST_DATABASE_URL` only and skip with a warning if it
is unreachable. The synthetic statement fixture is regenerable:
`cd extractor && uv run python tests/fixtures/generate_fixture.py`.

## First live run

Follow `../SMOKE_TEST.md` after completing `../MANUAL_SETUP.md`.
