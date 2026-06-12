// Insights service (CLAUDE.md §9): generation is button-gated and persisted;
// reads never touch the LLM; only aggregated analytics ever leave the app.

import {
  buildInsightsPayload,
  fingerprintAnalytics,
  type AnalyticsTransaction,
  type InsightsPayload,
} from "@/lib/analytics";
import { createOpenAIInsightsGenerator, type InsightsGenerator } from "@/lib/openai";
import { prisma } from "@/lib/prisma";
import { monthRange } from "@/lib/transactions";

export const INSIGHTS_COUNT = 3;

export interface StoredInsights {
  month: string;
  insights: string[];
  generatedAt: string; // ISO timestamp
  stale: boolean;
}

/** Thrown when the LLM returns malformed output twice; nothing is stored. */
export class InsightsGenerationError extends Error {}

/** Thrown when generation is attempted for a month that has no spending. */
export class InsightsNoDataError extends Error {}

/** "2026-06" → "2026-05", with Jan→Dec rollover. */
export function priorMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const prior = new Date(Date.UTC(year, monthNumber - 2, 1));
  return `${prior.getUTCFullYear()}-${String(prior.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function monthTransactions(month: string): Promise<AnalyticsTransaction[]> {
  const rows = await prisma.transaction.findMany({
    where: { date: monthRange(month)! },
    select: { date: true, merchant: true, category: true, amount: true },
  });
  return rows.map((row) => ({ ...row, amount: Number(row.amount) }));
}

/** Aggregated payload + fingerprint for a month's current data. */
export async function analyticsForMonth(
  month: string
): Promise<{ payload: InsightsPayload; fingerprint: string }> {
  const [current, prior] = await Promise.all([
    monthTransactions(month),
    monthTransactions(priorMonth(month)),
  ]);
  const payload = buildInsightsPayload(month, current, prior);
  return { payload, fingerprint: fingerprintAnalytics(payload) };
}

function validateInsights(raw: unknown): string[] | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { insights } = raw as { insights?: unknown };
  if (!Array.isArray(insights) || insights.length !== INSIGHTS_COUNT) return null;
  if (!insights.every((entry) => typeof entry === "string" && entry.trim() !== "")) {
    return null;
  }
  return insights as string[];
}

/**
 * Generate (or regenerate) insights for a month and upsert the single
 * `monthly_insights` row. Sends ONLY the aggregated payload to the LLM.
 * Malformed LLM output is retried once, then surfaced — never stored.
 */
export async function generateInsights(
  month: string,
  generator: InsightsGenerator = createOpenAIInsightsGenerator()
): Promise<StoredInsights> {
  const { payload, fingerprint } = await analyticsForMonth(month);

  // No spending → nothing to summarize. Never call the LLM or store a row.
  if (payload.topMerchants.length === 0) {
    throw new InsightsNoDataError(`no transactions for ${month}; nothing to generate`);
  }

  let insights = validateInsights(await generator.generate(payload));
  if (insights === null) {
    insights = validateInsights(await generator.generate(payload));
  }
  if (insights === null) {
    throw new InsightsGenerationError(
      `insights generation for ${month} returned malformed output twice; nothing stored`
    );
  }

  const generatedAt = new Date();
  const row = await prisma.monthlyInsight.upsert({
    where: { month },
    create: { month, insights, analyticsFingerprint: fingerprint, generatedAt },
    update: { insights, analyticsFingerprint: fingerprint, generatedAt },
  });

  return {
    month: row.month,
    insights,
    generatedAt: row.generatedAt.toISOString(),
    stale: false,
  };
}

/**
 * Read the stored insights for a month, flagging staleness by comparing the
 * stored fingerprint against the current analytics. NEVER calls the LLM.
 */
export async function getInsights(month: string): Promise<StoredInsights | null> {
  const row = await prisma.monthlyInsight.findUnique({ where: { month } });
  if (row === null) {
    return null;
  }
  const { fingerprint } = await analyticsForMonth(month);
  return {
    month: row.month,
    insights: row.insights as string[],
    generatedAt: row.generatedAt.toISOString(),
    stale: row.analyticsFingerprint !== fingerprint,
  };
}
