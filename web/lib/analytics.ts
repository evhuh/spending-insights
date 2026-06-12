// Analytics engine — pure computation over already-filtered transactions.
// All stored transactions are spending (positive amounts) by invariant 2, so
// every metric here is spending-only by construction.

import { createHash } from "node:crypto";

export interface AnalyticsTransaction {
  date: Date;
  merchant: string;
  category: string;
  amount: number;
}

export interface CategorySpend {
  category: string;
  total: number;
}

export interface MerchantSpend {
  merchant: string;
  total: number;
  count: number;
}

export interface Analytics {
  totalSpend: number;
  transactionCount: number;
  averageDailySpend: number;
  spendByCategory: CategorySpend[];
  topMerchants: MerchantSpend[];
}

export const TOP_MERCHANTS_LIMIT = 5;

const toCents = (value: number) => Math.round(value * 100);
const fromCents = (cents: number) => cents / 100;

/**
 * Compute all dashboard metrics. `month` (YYYY-MM), when given, defines the
 * day-count for average daily spend (the full calendar month); otherwise the
 * inclusive day span of the data is used.
 */
export function computeAnalytics(
  transactions: AnalyticsTransaction[],
  options: { month?: string } = {}
): Analytics {
  // Sum in integer cents so 0.1 + 0.2 style float drift can't creep in.
  const totalCents = transactions.reduce((sum, t) => sum + toCents(t.amount), 0);

  const byCategory = new Map<string, number>();
  const byMerchant = new Map<string, { total: number; count: number }>();
  for (const t of transactions) {
    byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + toCents(t.amount));
    const merchant = byMerchant.get(t.merchant) ?? { total: 0, count: 0 };
    merchant.total += toCents(t.amount);
    merchant.count += 1;
    byMerchant.set(t.merchant, merchant);
  }

  const spendByCategory = [...byCategory.entries()]
    .map(([category, cents]) => ({ category, total: fromCents(cents) }))
    .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category));

  const topMerchants = [...byMerchant.entries()]
    .map(([merchant, { total, count }]) => ({ merchant, total: fromCents(total), count }))
    .sort((a, b) => b.total - a.total || a.merchant.localeCompare(b.merchant))
    .slice(0, TOP_MERCHANTS_LIMIT);

  const days = spanDays(transactions, options.month);
  const averageDailySpend =
    days === 0 ? 0 : fromCents(Math.round(totalCents / days));

  return {
    totalSpend: fromCents(totalCents),
    transactionCount: transactions.length,
    averageDailySpend,
    spendByCategory,
    topMerchants,
  };
}

export interface MomChange {
  category: string;
  changePct: number;
}

/**
 * Aggregated month payload sent to the LLM for insights (CLAUDE.md §9: only
 * aggregates, never raw transactions) and fingerprinted for staleness.
 */
export interface InsightsPayload {
  month: string; // YYYY-MM
  totalSpend: number;
  topCategories: { category: string; amount: number }[];
  topMerchants: { merchant: string; amount: number }[];
  momChanges: MomChange[];
}

export const TOP_CATEGORIES_LIMIT = 5;

/**
 * Per-category month-over-month change %, relative to the prior month.
 * Only categories with prior-month spend have a defined baseline: a category
 * that disappeared is -100; a category new this month is omitted. No prior
 * month at all → empty list. Sorted by category for determinism.
 */
export function computeMomChanges(
  current: AnalyticsTransaction[],
  prior: AnalyticsTransaction[]
): MomChange[] {
  const currentCents = centsByCategory(current);
  const priorCents = centsByCategory(prior);

  return [...priorCents.entries()]
    .map(([category, priorTotal]) => ({
      category,
      changePct: Math.round(
        (((currentCents.get(category) ?? 0) - priorTotal) / priorTotal) * 100
      ),
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

function centsByCategory(transactions: AnalyticsTransaction[]): Map<string, number> {
  const byCategory = new Map<string, number>();
  for (const t of transactions) {
    byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + toCents(t.amount));
  }
  return byCategory;
}

/** Canonical analytics payload for a month (see InsightsPayload). */
export function buildInsightsPayload(
  month: string,
  currentMonthTransactions: AnalyticsTransaction[],
  priorMonthTransactions: AnalyticsTransaction[]
): InsightsPayload {
  const analytics = computeAnalytics(currentMonthTransactions, { month });
  return {
    month,
    totalSpend: analytics.totalSpend,
    topCategories: analytics.spendByCategory
      .slice(0, TOP_CATEGORIES_LIMIT)
      .map(({ category, total }) => ({ category, amount: total })),
    topMerchants: analytics.topMerchants.map(({ merchant, total }) => ({
      merchant,
      amount: total,
    })),
    momChanges: computeMomChanges(currentMonthTransactions, priorMonthTransactions),
  };
}

/**
 * Deterministic fingerprint of the payload: sha-256 over canonical JSON
 * (recursively sorted keys), so identical analytics always hash identically
 * and any data change flips the hash. Used for staleness detection.
 */
export function fingerprintAnalytics(payload: InsightsPayload): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, inner]) => `${JSON.stringify(key)}:${canonicalJson(inner)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function spanDays(transactions: AnalyticsTransaction[], month?: string): number {
  if (month !== undefined) {
    const [year, monthNumber] = month.split("-").map(Number);
    // Day 0 of the next month = last day of this month.
    return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  }
  if (transactions.length === 0) {
    return 0;
  }
  const times = transactions.map((t) => t.date.getTime());
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.floor((Math.max(...times) - Math.min(...times)) / dayMs) + 1;
}
