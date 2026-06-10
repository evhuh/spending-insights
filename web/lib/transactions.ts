// Shared shapes/helpers for the transactions API routes.

import type { Prisma, Transaction } from "@/lib/generated/prisma/client";

// Spec invariant 4: everything else (id, import_batch_id, created_at,
// updated_at, category_source) is non-editable and must be rejected.
export const EDITABLE_FIELDS = ["date", "merchant", "amount", "category", "notes"] as const;

export interface TransactionJson {
  id: string;
  date: string; // YYYY-MM-DD
  merchant: string;
  amount: number;
  category: string;
  notes: string | null;
  importBatchId: string;
  categorySource: "rule" | "ai" | "manual";
  createdAt: string;
  updatedAt: string;
}

export function serializeTransaction(transaction: Transaction): TransactionJson {
  return {
    id: transaction.id,
    date: transaction.date.toISOString().slice(0, 10),
    merchant: transaction.merchant,
    amount: Number(transaction.amount),
    category: transaction.category,
    notes: transaction.notes,
    importBatchId: transaction.importBatchId,
    categorySource: transaction.categorySource,
    createdAt: transaction.createdAt.toISOString(),
    updatedAt: transaction.updatedAt.toISOString(),
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type EditValidation =
  | { ok: true; data: Record<string, unknown>; categoryProvided: boolean }
  | { ok: false; error: string };

/** Validate a PATCH body: only editable fields, with sane values. */
export function validateEdit(body: unknown): EditValidation {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const fields = body as Record<string, unknown>;
  const forbidden = Object.keys(fields).filter(
    (key) => !(EDITABLE_FIELDS as readonly string[]).includes(key)
  );
  if (forbidden.length > 0) {
    return { ok: false, error: `non-editable fields: ${forbidden.join(", ")}` };
  }
  if (Object.keys(fields).length === 0) {
    return { ok: false, error: "no fields to update" };
  }

  const data: Record<string, unknown> = {};
  if ("date" in fields) {
    if (typeof fields.date !== "string" || !DATE_RE.test(fields.date)) {
      return { ok: false, error: "date must be YYYY-MM-DD" };
    }
    data.date = new Date(fields.date);
  }
  if ("merchant" in fields) {
    if (typeof fields.merchant !== "string" || fields.merchant.trim() === "") {
      return { ok: false, error: "merchant must be a non-empty string" };
    }
    data.merchant = fields.merchant.trim();
  }
  if ("amount" in fields) {
    const amount = Number(fields.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, error: "amount must be a positive number" };
    }
    data.amount = amount.toFixed(2);
  }
  if ("category" in fields) {
    if (typeof fields.category !== "string" || fields.category.trim() === "") {
      return { ok: false, error: "category must be a non-empty string" };
    }
    data.category = fields.category.trim();
  }
  if ("notes" in fields) {
    if (fields.notes !== null && typeof fields.notes !== "string") {
      return { ok: false, error: "notes must be a string or null" };
    }
    data.notes = fields.notes;
  }

  return { ok: true, data, categoryProvided: "category" in fields };
}

export type WhereFromParams =
  | { ok: true; where: Prisma.TransactionWhereInput }
  | { ok: false; error: string };

/** Build the month/category/merchant filter shared by /api/transactions and
 * /api/analytics. */
export function transactionWhereFromParams(searchParams: URLSearchParams): WhereFromParams {
  const where: Prisma.TransactionWhereInput = {};
  const month = searchParams.get("month");
  if (month !== null) {
    const range = monthRange(month);
    if (range === null) {
      return { ok: false, error: "month must be YYYY-MM" };
    }
    where.date = range;
  }
  const category = searchParams.get("category");
  if (category !== null) {
    where.category = { equals: category, mode: "insensitive" };
  }
  const merchant = searchParams.get("merchant");
  if (merchant !== null) {
    where.merchant = { equals: merchant, mode: "insensitive" };
  }
  return { ok: true, where };
}

/** [start, end) date range for a YYYY-MM month filter, or null if malformed. */
export function monthRange(month: string): { gte: Date; lt: Date } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  return {
    gte: new Date(Date.UTC(year, monthIndex, 1)),
    lt: new Date(Date.UTC(year, monthIndex + 1, 1)),
  };
}
