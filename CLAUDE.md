# CLAUDE.md — Finance Intelligence Dashboard

This file is loaded into your context at the start of every session. Treat it as
ground truth. The detailed, phase-by-phase build sequence lives in
`docs/IMPLEMENTATION_PLAN.md` — **do not** paste the whole plan in here; open that
file and read the relevant phase when you start one.

---

## 1. What this project is

A local-first personal finance analytics app. It ingests a **credit-card statement
PDF**, extracts and normalizes transactions, categorizes spending (merchant rules
first, AI fallback), stores everything in PostgreSQL, shows an editable dashboard,
and syncs a monthly spending report to Notion.

Personal use + portfolio piece. Single user. Runs locally.

---

## 2. Architecture (two runtimes, one repo)

```
web/        Next.js (App Router) + TypeScript. Owns EVERYTHING except PDF parsing:
            classification, Prisma/Postgres, dashboard, analytics, Notion sync.
extractor/  Python + FastAPI. Owns ONLY the PDF concern: pdfplumber layout
            extraction + AI parse-to-schema. PDF bytes in → clean transaction JSON out.
```

The Next.js `/api/upload` route forwards the uploaded PDF's bytes to the extractor's
`POST /extract`, receives structured transactions, then classifies and stores them.

**The two runtimes communicate over HTTP (localhost). Never shell out to Python via
child_process.**

### The contract between them

`POST /extract` (multipart: the PDF; optional `statementYear`) returns:

```json
{
  "statementPeriod": { "year": 2026, "closingDate": "2026-05-20", "yearResolved": true },
  "transactions": [
    { "date": "2026-04-22", "merchant": "Chick-fil-A", "rawDescription": "CHICK-FIL-A #03663 NORTH HAVEN CT", "amount": 12.66 }
  ],
  "validation": { "extractedPurchaseTotal": 1234.56, "statementPurchaseTotal": 1234.56, "match": true }
}
```

`rawDescription` is for debugging/trust only — **it is NOT stored** (see invariants).
`web` maps each transaction into the storage shape below and fills `category` /
`categorySource` during classification.

---

## 3. Data contract (storage shape — matches the spec exactly)

`transactions`: `id` (uuid), `date` (date), `merchant` (text), `amount`
(decimal 10,2), `category` (text), `notes` (text, nullable), `import_batch_id`
(text), `category_source` (`rule` | `ai` | `manual`), `created_at`, `updated_at`.

`merchant_rules`: `id` (uuid), `merchant_pattern` (text, UNIQUE), `category` (text),
`created_at`.

`import_batches`: `id` (uuid), `file_name` (text), `imported_at` (timestamp),
`transaction_count` (int).

Prisma `schema.prisma` is the single source of truth. Postgres tables are generated
**from** it via `prisma migrate` — never hand-edit the database to diverge.

---

## 4. INVARIANTS — never violate these

1. **The raw PDF is never written to disk, in either runtime.** The extractor
   processes bytes in memory and discards them when the request ends. `web` streams
   bytes straight to the extractor. Because the file is never persisted, there is no
   "delete the file" step to implement — there is nothing to delete. If you find
   yourself writing a temp PDF, stop: that's a bug.
2. **Spending only.** Keep transactions with a **positive** amount. Drop negatives
   (payments, credits, refunds) and drop section-header and subtotal lines. Store
   `amount` as a positive number.
3. **No account numbers retained.** The statement's `Account Number` column is the
   card's last four — never extract or store it.
4. **Non-editable fields:** `id`, `import_batch_id`, `created_at`, `updated_at`,
   `category_source`. The API must reject attempts to set these directly.
   (`category_source` changes only as a side effect — see classification rules.)
5. **`merchant` is the standardized name** (`Nice Day Chinese`), not the raw
   descriptor. Standardization happens in the extractor.
6. **Dates are resolved to full ISO dates** using the statement closing date, with
   Dec→Jan rollover. Use the **Transaction Date** column, not Posting Date.
7. **Secrets come from env only** (`DATABASE_URL`, `OPENAI_API_KEY`, `NOTION_API_KEY`,
   `NOTION_DATABASE_ID`). Never hardcode, never commit. Tests must not require real
   secrets — mock the boundaries (see §6).

---

## 5. Classification rules (the spec's flow)

For each extracted transaction, in `web`:
1. Standardized `merchant` is looked up against `merchant_rules.merchant_pattern`.
2. **Match** → apply that category, `category_source = "rule"`.
3. **No match** → call OpenAI to categorize, `category_source = "ai"`.
4. Store.

On a manual category edit in the dashboard:
- Update the transaction, set `category_source = "manual"`.
- Prompt: "Apply this category to future transactions from this merchant?"
- **Accept** → create a `merchant_rule`. **Decline** → update only this transaction.

---

## 6. Next.js version warning

`web/` uses **Next.js 16**, which has breaking changes vs. older versions. APIs,
conventions, and file structure may differ from training data. Before writing any
`web/` app code, read the relevant guide in
`spending-insights/web/node_modules/next/dist/docs/` and heed deprecation notices.

If `create-next-app` (or any tool) generates a `CLAUDE.md` or `AGENTS.md` inside
`spending-insights/`, delete them and consolidate the content here instead.

---

## 7. How to work in this repo (read this every session)

- **Work one phase at a time, in order, from `docs/IMPLEMENTATION_PLAN.md`.** Open the
  phase, do it, then run that phase's self-tests.
- **Do not start the next phase until the current phase's self-tests are green.** If
  something is red, fix it or surface a blocker — never paper over it or proceed.
- **After completing a phase, check off its box in the plan** and give a one-line
  summary of what was done and how it was verified.
- **Self-tests mock all external boundaries** (OpenAI, Notion, and — in `web` — the
  extractor HTTP call). They run against a local **test** Postgres
  (`TEST_DATABASE_URL`), never the user's real data. You cannot reach the user's live
  OpenAI/Notion/Postgres, and you must not pretend a green mocked test proves the live
  integration works — it proves the logic works.
- **Never invent credentials or sample real data.** Where you need a PDF to test, use
  the synthetic fixture described in Phase 2 (it mirrors the real statement layout).
- **Conventions:** `web` is TypeScript strict, App Router, Vitest + React Testing
  Library, ESLint/Prettier. `extractor` is Python 3.11+, FastAPI, pydantic v2,
  pytest, ruff. Keep functions small and unit-testable; isolate I/O so it can be mocked.
- **When building UI (Phase 7), read `/mnt/skills/public/frontend-design/SKILL.md`
  first** if available, and aim for an intentional, non-default look.
- Run commands from the right folder (`web/` or `extractor/`). The root `Makefile`
  has `make dev`, `make test`, `make typecheck` that fan out to both.

---

## 8. The real statement format (so extraction matches reality)

Credit-card statement. Transactions begin under a **`Transactions`** heading, split
into two sub-sections by bold row headers:
- `Payments and Other Credits` — negative amounts → **drop all of these**.
- `Purchases and Adjustments` — positive amounts → **these are the spending**.

Columns, left to right: `Transaction Date` (MM/DD), `Posting Date` (MM/DD),
`Description`, `Reference Number`, `Account Number`, `Amount`, `Total`.
- The `Total` column is populated **only on subtotal lines**
  (e.g. `TOTAL PAYMENTS AND OTHER CREDITS FOR THIS PERIOD`) → use as a signal to skip
  those lines, and to validate extracted sums.
- Descriptions are messy: processor prefixes (`SQ *`, `TST*`), store numbers
  (`#03663`), trailing city + 2-letter state, sometimes a URL (`gosq.com`). Strip all
  of that to get the standardized merchant.
- The year is **not** in the transactions table — resolve it from the statement's
  closing date elsewhere in the document.

---

## 9. Insights & AI usage (feature)

- Insights are generated ONLY on explicit user action (the Generate/Regenerate
  button). Never on page load, never automatically, never as a side effect of a
  Notion sync.
- Generated insights are persisted in the `monthly_insights` table and reused by both
  the dashboard and the Notion report. Neither surface generates on its own.
- The Notion report REUSES stored insights. If a month has none, it OMITS the Insights
  section — it must never trigger generation.
- Only aggregated analytics are sent to the LLM for insights. Never raw transactions.
- Each stored insight set records a fingerprint of the analytics it was built from. If
  current analytics differ, the UI marks the insights STALE and offers regeneration,
  but does NOT auto-regenerate.
- AI is used only for (a) categorization fallback and (b) monthly insights. Merchant
  rules remain the primary categorization mechanism.
- The ONLY schema change in this feature is the new `monthly_insights` table. The
  transactions table is NOT modified — categorization source uses the existing
  `category_source` field. ("Do not change the schema" in the original spec means the
  transactions table specifically; adding a new table for insights is permitted and
  required.)
