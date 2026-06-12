# spending insights

**Local-first personal finance analytics.** Upload a credit-card statement PDF and get
clean, categorized transactions in an editable dashboard with merchant-rule
classification and AI fallback, spending analytics, and one-click monthly report
sync to Notion.

Built as a privacy-conscious, two-runtime system: statements are
parsed entirely in memory and never touch disk.

Also because I actually need this.

![Dashboard overview](docs-assets/dashboard.png)

Upload:

[![Upload](https://img.youtube.com/vi/4fBEtElVgI8/hqdefault.jpg)](https://youtu.be/4fBEtElVgI8)

Notion Sync:

[![Upload](https://img.youtube.com/vi/KjUiX5hXd0s/hqdefault.jpg)](https://youtu.be/KjUiX5hXd0s)



## Stack

**Web:** Next.js 16 (App Router), TypeScript (strict), Prisma 7 + PostgreSQL,
TanStack Table, Recharts, Tailwind CSS v4, Vitest + React Testing Library.

**Extractor:** Python 3.11, FastAPI, pydantic v2, pdfplumber, OpenAI API, pytest,
ruff, [uv](https://docs.astral.sh/uv/).

## Features

- **PDF → structured data, no manual entry.** A FastAPI microservice does layout-aware extraction with pdfplumber (x-band column detection, two-line stacked headers, section/subtotal handling), then an AI pass standardizes messy descriptors (ex. `SQ *NICE DAY #03663 NEW HAVEN CT gosq.com` → `Nice Day Chinese`).
- **Adaptive categorization pipeline.** Transactions are categorized using a rules-first approach. Known merchants are classified via reusable merchant rules, while unknown merchants are categorized using an LLM. User corrections can be promoted to persistent merchant rules, reducing future AI calls and improving categorization consistency over time.
- **Editable dashboard.** TanStack Table with click-to-edit cells, category color theming, filterable donut chart of spending by category, top-merchant summary.
- **Notion sync.** Monthly spending reports (totals + category breakdown) are upserted into a Notion database via the REST API.
- **Privacy by construction.** The uploaded PDF exists only as bytes in memory for the lifetime of one request — there is no file to delete because none is written.
- **Tested at the boundaries.** 56 web tests (Vitest + React Testing Library) and a pytest suite for the extractor; OpenAI, Notion, and the cross-service HTTP call are all mocked, and DB tests run against a dedicated test database.

## High-Level Architecture

Two runtimes, one repo, communicating over localhost HTTP:

| Folder       | Runtime                          | Owns                                                                |
| ------------ | -------------------------------- | ------------------------------------------------------------------- |
| `web/`       | Next.js 16 (App Router) + TS     | Classification, Prisma/Postgres, dashboard, analytics, Notion sync   |
| `extractor/` | Python 3.11 / FastAPI            | PDF parsing only: pdfplumber layout extraction + AI parse-to-schema  |

```
            PDF Statement (upload)
                     ↓
        Next.js /api/upload  ──streams bytes──▶  FastAPI POST /extract
                                                       ↓
                                              Layout Extraction (pdfplumber)
                                                       ↓
                                              Normalization + Merchant
                                              Standardization (AI)
                                                       ↓
        clean transaction JSON  ◀──────  (bytes discarded, never written to disk)
                     ↓                            
            Merchant Rules Lookup
                     ↓
              ├─ Rule Exists → Apply Category
              │
              └─ No Rule → AI Categorization
                     ↓
               Store Transactions
                     ↓
                 PostgreSQL
                     ↓
        ┌────────────┼────────────┐
        ↓            ↓            ↓
    Dashboard   Analytics     Notion Sync
        │        Engine      (monthly reports)
        ↓
  User Corrections
        ↓
  Merchant Rule Creation ──▶ (feeds future lookups)
```

## Security Boundary

Uploaded statements are used only during ingestion:

- **The original file is never persisted** — both runtimes process the PDF as
  in-memory bytes and discard them when the request ends.
- **Only normalized transaction data is retained** (date, standardized merchant,
  amount, category, notes). Raw statement descriptors are returned for validation
  but not stored.
- **Account numbers are never extracted or stored.**
- **Payments, credits, and refunds are dropped** — only spending is kept.
- **Secrets live in env vars only** (`DATABASE_URL`, `OPENAI_API_KEY`,
  `NOTION_API_KEY`, `NOTION_DATABASE_ID`); the test suite needs none of them.

## Run It Locally

Prerequisites: Node.js 20+, Python 3.11+ with uv, local PostgreSQL.

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

# both, from the repo root
make dev                     # Next.js on :3000, extractor on :8000
```

Open http://localhost:3000, upload a statement, edit categories inline, and sync a
monthly report to Notion. Sanity check: `curl localhost:8000/health` →
`{"status":"ok"}`.

### Demo with the sample statement

No real statement handy? The repo ships a synthetic statement PDF that mirrors a
real credit-card statement's layout (stacked column headers, payments/purchases
sections, subtotal rows, messy processor-prefixed descriptors):

```
extractor/tests/fixtures/sample_statement.pdf
```

Upload it through the dashboard to see the full pipeline run end to end. It is
fully synthetic (no real merchants, amounts, or account data) and regenerable
with `cd extractor && uv run python tests/fixtures/generate_fixture.py`.

> Uploading requires an `OPENAI_API_KEY` (merchant standardization and category fallback are AI-assisted); Notion keys are only needed for report sync.

## Dev

```bash
make test        # Vitest (web, needs TEST_DATABASE_URL) + pytest (extractor)
make typecheck   # tsc --noEmit + ruff
make lint        # ESLint + ruff
```

All external boundaries (OpenAI, Notion, the extractor HTTP call) are mocked in
tests; DB-backed tests hit `TEST_DATABASE_URL` only and skip with a warning if it
is unreachable.
