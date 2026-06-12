# Implementation Plan — Finance Intelligence Dashboard

Read `CLAUDE.md` first; it holds the invariants and contracts this plan assumes.

**How to use this file:** do one phase at a time, top to bottom. Each phase has a
**Definition of Done (DoD)** and **Self-test** block. Do not advance to the next phase
until the current phase's self-tests pass. After a phase, tick its checkbox and post a
one-line summary (what was built + how it was verified).

External boundaries — OpenAI, Notion, and (from `web`) the extractor HTTP call — are
**mocked** in self-tests. A green mocked test proves logic, not the live integration;
the live pass is the user's, per `docs/MANUAL_SETUP.md`.

---

## Phase 0 — Monorepo scaffold & tooling
- [x] Create the structure (implementation root: `spending-insights/`):
  ```
  docs/  web/  extractor/  Makefile  README.md
  ```
- [x] `web/`: Next.js (App Router) + TypeScript (strict). Add Vitest + React Testing
  Library, ESLint, Prettier. Add `web/.env.example` with `DATABASE_URL`,
  `TEST_DATABASE_URL`, `OPENAI_API_KEY`, `NOTION_API_KEY`, `NOTION_DATABASE_ID`,
  `EXTRACTOR_URL` (default `http://localhost:8000`).
- [x] `extractor/`: FastAPI app, pydantic v2, `pdfplumber`, `openai`, `pytest`,
  `ruff`. Add `extractor/.env.example` with `OPENAI_API_KEY`. A `GET /health` returns
  `{"status":"ok"}`.
- [x] Root `Makefile`: `make dev` (runs both servers concurrently), `make test`,
  `make typecheck`, `make lint` — each fanning out to both folders.
- [x] `README.md`: how to install deps and run both runtimes.

**DoD:** both apps boot; `GET /health` (extractor) and the Next.js dev server both
respond; empty test suites run clean; typecheck passes.

**Self-test:**
```bash
make typecheck          # tsc --noEmit + ruff/pyright clean
make test               # both suites run (0 tests OK)
# manual: make dev, curl localhost:8000/health -> {"status":"ok"}
```

---

## Phase 1 — Database & Prisma schema
- [x] `web/prisma/schema.prisma` with `transactions`, `merchant_rules`,
  `import_batches` exactly per the data contract in CLAUDE.md §3 (types, UNIQUE on
  `merchant_pattern`, `category_source` constrained to `rule|ai|manual` via enum).
- [x] `web/lib/prisma.ts`: a single PrismaClient instance (avoid hot-reload leaks).
  (Prisma 7: requires a driver adapter — uses `@prisma/adapter-pg`; datasource URL
  lives in `prisma.config.ts`, not the schema.)
- [x] Migration + `prisma generate`. (Init migration generated offline via
  `prisma migrate diff`; later applied to both DBs once Postgres landed —
  verified 2026-06-10.)
- [x] A seed/smoke script that inserts one transaction + one rule and reads them back
  (`web/tests/prisma.test.ts` — **2 passed** against `finance_test`, 2026-06-10).

**DoD:** migration applies to a local Postgres; generated client typechecks; a row
round-trips.

**Self-test:**
```bash
cd web && DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy
cd web && npm run test -- prisma   # asserts insert+read of each model
```
> Needs a reachable local Postgres. If none is available in the sandbox, document the
> exact `TEST_DATABASE_URL` the user must provide and mark this phase's DB-dependent
> test as skipped-with-reason rather than faking a pass.

---

## Phase 2 — Extractor: layout extraction (deterministic, no AI yet)
- [x] `extractor/app/extraction.py`: open the PDF with `pdfplumber`, find the
  `Transactions` heading, and read rows using **x-position bands** for the columns
  (bands are derived from the header row's word x-positions; the Account band is
  never read, per invariant 3).
- [x] Classify each line: section header (`Payments and Other Credits`,
  `Purchases and Adjustments`), subtotal line (`Total` column populated /
  `TOTAL ... FOR THIS PERIOD`), or a transaction row. Subtotal amounts are exposed
  as `statement_totals` for Phase 3 validation.
- [x] Capture the statement **closing date** by scanning the full document text;
  expose it for year resolution.
- [x] Emit raw rows: `{transactionDateMMDD, description, amount, section}` — no AI,
  no normalization yet. Negatives kept here but tagged by section (filtered later).
- [x] **Build a synthetic fixture PDF** (`tests/fixtures/sample_statement.pdf`) that
  reproduces the real layout: the 7 columns, both sub-sections, a couple of subtotal
  lines, MM/DD dates, messy descriptions (`SQ *NICE DAY CHINESE NEW gosq.com   CT`,
  `CHICK-FIL-A #03663    NORTH HAVEN  CT`, `TST*ATTICUS BOOKSTORE CA New Haven  CT`),
  a negative payment line, and a closing date elsewhere in the doc. Use `reportlab`
  or `fpdf2` to generate it; commit the generator script so the fixture is
  reproducible.

**DoD:** from the fixture, the right number of transaction rows are returned; headers
and subtotal lines are excluded from the row list; the closing date is found.

**Self-test:**
```bash
cd extractor && pytest tests/test_extraction.py -v
# asserts: row count, section tagging, subtotal/header exclusion, closing-date capture
```

---

## Phase 3 — Extractor: AI parse, normalization, validation, `/extract`
- [x] `extractor/app/parser.py`: send the layout rows to OpenAI and get back, per row,
  a **standardized merchant** (strip `SQ */TST*` prefixes, `#store` numbers,
  city/state, URLs) plus a confirmed amount/date. Wrap the OpenAI client so it is
  injectable/mockable. (Layout values win over the AI echo on any disagreement.)
- [x] `extractor/app/normalize.py`:
  - **Filter to spending:** keep positive amounts only; drop negatives, headers,
    subtotals.
  - **Resolve year:** apply the closing date to MM/DD dates; if `txn.month >
    closing.month`, use prior year (Dec→Jan rollover). If no closing date found, use
    the `statementYear` param; if that's absent, set `yearResolved=false` and return
    dates with a placeholder year for the caller to handle.
  - **Validate:** sum kept purchases; compare to the statement's
    `TOTAL PURCHASES AND ADJUSTMENTS` subtotal; return both + a `match` boolean
    (tolerance a cent or two).
- [x] `extractor/app/main.py`: `POST /extract` — accepts the PDF (multipart) +
  optional `statementYear`, processes **in memory only** (never writes to disk),
  returns the JSON contract from CLAUDE.md §2. (Unresolved years use placeholder
  year 1900 with `yearResolved=false`.)

**DoD:** posting the fixture returns clean, positive-only, fully-dated transactions
with standardized merchants; the two `NICE DAY CHINESE` rows both normalize to the
same merchant; validation reports a match; no file is written.

**Self-test:**
```bash
cd extractor && pytest tests/test_parser.py tests/test_normalize.py tests/test_extract_endpoint.py -v
# OpenAI is MOCKED with deterministic responses; assert normalization, positive-only
# filtering, year+rollover, validation match, and in-memory (no temp file created).
```

---

## Phase 4 — Web: ingestion pipeline (upload → extract → classify → store)
- [x] `web/lib/extractor-client.ts`: POST the uploaded bytes to `EXTRACTOR_URL/extract`.
- [x] `web/lib/openai.ts`: a mockable client for categorization (fixed category list,
  unknown AI answers coerced to `Other`).
- [x] `web/lib/classify.ts`: implement CLAUDE.md §5 (rule lookup → AI fallback → set
  `category_source`). Rule matching is case-insensitive; only unique unmatched
  merchants go to the AI.
- [x] `web/app/api/upload/route.ts`: receive the PDF, stream bytes to the extractor,
  create an `import_batch` (`file_name`, count), classify each transaction, bulk
  insert. **Never persist the PDF.** Returns 422 if `yearResolved=false` (caller
  must re-send with `statementYear`). Classify/openai unit tests green; DB-backed
  upload integration test **2 passed** against `finance_test` (2026-06-10).

**DoD:** an uploaded PDF results in stored transactions with correct `category_source`
(`rule` when a matching rule exists, else `ai`), one `import_batch` row with the right
count, and no file on disk.

**Self-test:**
```bash
cd web && npm run test -- upload classify
# MOCK extractor-client (returns fixture transactions) and OpenAI; run against
# TEST_DATABASE_URL; seed one merchant_rule and assert that merchant -> rule, others
# -> ai; assert import_batch count; assert no fs write.
```

---

## Phase 5 — Web: transactions API, corrections, rule creation
- [x] `GET /api/transactions` (with filters: month, category, merchant — the latter
  two case-insensitive; month is `YYYY-MM`).
- [x] `PATCH /api/transactions/[id]`: editable = `date, merchant, amount, category,
  notes`. Reject `id, import_batch_id, created_at, updated_at, category_source`.
- [x] On a `category` change: set `category_source = "manual"`; the response carries
  `promptApplyToFuture: true` to signal the "apply to future?" prompt (false when
  the category value is unchanged).
- [x] `POST /api/merchant-rules` (accept path → create rule, UNIQUE on pattern →
  409 on duplicate), `GET /api/merchant-rules`. Decline path updates only the
  current transaction (no rule unless POST is called).

**DoD:** editable fields update; non-editable fields are rejected; a category edit
flips `category_source` to `manual`; accepting creates a rule; declining does not.

**Self-test:**
```bash
cd web && npm run test -- transactions merchant-rules
```

---

## Phase 6 — Web: analytics engine
- [x] `web/lib/analytics.ts`: total spend, transaction count, average daily spend,
  spend-by-category (for the pie), top merchants (top 5, ties alphabetical). All
  respect the month/category/merchant filters and count spending only. Sums are
  done in integer cents (no float drift). Average daily spend divides by the
  calendar-month day count when a month filter is given, else by the inclusive
  day span of the data.
- [x] `GET /api/analytics?month=&category=&merchant=` (filter parsing shared with
  `/api/transactions` via `lib/transactions.ts`).

**DoD:** against a known seeded set, every metric matches a hand-computed expected
value; filters change results correctly.

**Self-test:**
```bash
cd web && npm run test -- analytics   # exact-value assertions on seeded data
```

---

## Phase 7 — Web: dashboard UI
- [x] Read `/mnt/skills/public/frontend-design/SKILL.md` (if present) before styling.
  (Not present on this machine — styled with an intentional warm-paper/teal look.)
- [x] Filters: Month (native month input), Category (select from data), Merchant.
- [x] Transaction table (TanStack Table): Date, Merchant, Category, Amount, Notes —
  **all editable inline** (click-to-edit, Enter/blur commits, Esc cancels), wired to
  `PATCH`. On category change, the "apply to future transactions from this merchant?"
  dialog calls the rule endpoint on accept; decline creates nothing.
- [x] Analytics: Recharts **pie** (donut + legend with shared category colors) +
  metric cards (Total Spend, Transaction Count, Average Daily Spend, Top Merchants).
  Also added an Upload button wired to `/api/upload` (needed for the live smoke test).

**DoD:** dashboard renders from the APIs; editing a cell persists via PATCH; the
category-edit prompt creates a rule on accept; the pie and cards reflect analytics.

**Self-test:**
```bash
cd web && npm run test -- dashboard   # RTL: render, inline-edit fires PATCH,
                                      # prompt-accept fires rule create, chart renders
cd web && npm run typecheck
```

---

## Phase 8 — Web: monthly report + Notion sync
- [x] `web/lib/notion.ts`: build the report from analytics for a given month and
  **upsert one row per month** into the Notion DB. Properties: `Month` (Title),
  `Total Spend` (Number), `Transaction Count` (Number), `Average Daily Spend`
  (Number). Write **Top Categories** and **Top Merchants** into the **page body**
  (not properties). Upsert = update existing month row (properties replaced, body
  blocks cleared + re-appended); else create. Real client is a thin fetch wrapper
  on Notion's REST API (pinned `Notion-Version: 2022-06-28`), no SDK.
- [x] `POST /api/reports` (generate + sync for a month). Notion client mockable
  via the `NotionApi` interface + injectable `createNotionApi`.

**DoD:** the report payload matches the agreed property schema; top categories/
merchants go in the body; re-running for the same month updates rather than
duplicates.

**Self-test:**
```bash
cd web && npm run test -- reports notion   # Notion API MOCKED; assert property
                                           # payload, body blocks, and upsert logic
```

---

## Phase 9 — End-to-end wiring, docs, manual smoke checklist
- [x] Confirm `make dev` runs both (extractor `/health` ok + web HTTP 200);
  `make test` (web 51 + extractor 25), `make typecheck`, `make lint` all green
  across both runtimes (2026-06-10). Also added the missing UI for report
  generation: a month picker + "Sync to Notion" control in the dashboard header
  (with an RTL test).
- [x] Complete both `.env.example` files (incl. optional `OPENAI_MODEL`) and the
  `README.md` run instructions (full setup incl. Prisma migrate steps).
- [x] Produced the **live smoke-test checklist**: root `SMOKE_TEST.md` —
  upload the real PDF → verify rows + a validation match → edit a category → accept a
  rule → re-upload to confirm the rule applies → sync the report → confirm the
  Notion row updates (not duplicates) on re-sync, plus where the extraction tuning
  knobs live if the real PDF parses imperfectly.

**DoD:** a clean checkout can be set up and run from the README; the full mocked test
suite is green; the manual checklist is written.

**Self-test:**
```bash
make test && make typecheck && make lint
```
