// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { computeAnalytics, type AnalyticsTransaction } from "@/lib/analytics";

import { probeTestDb } from "./helpers/db";

function txn(date: string, merchant: string, category: string, amount: number): AnalyticsTransaction {
  return { date: new Date(date), merchant, category, amount };
}

// Hand-computed seed: total 79.91 over April (30 days); Chick-fil-A 20.00 (2),
// Nice Day 28.41 (1), Atticus 31.50 (1); Dining 48.41, Shopping 31.50.
const APRIL = [
  txn("2026-04-05", "Chick-fil-A", "Dining", 12.66),
  txn("2026-04-10", "Nice Day Chinese", "Dining", 28.41),
  txn("2026-04-10", "Atticus", "Shopping", 31.5),
  txn("2026-04-20", "Chick-fil-A", "Dining", 7.34),
];

describe("computeAnalytics", () => {
  it("computes every metric to the exact hand-computed value (month given)", () => {
    const result = computeAnalytics(APRIL, { month: "2026-04" });

    expect(result.totalSpend).toBe(79.91);
    expect(result.transactionCount).toBe(4);
    // 79.91 / 30 days = 2.6636… → 2.66
    expect(result.averageDailySpend).toBe(2.66);
    expect(result.spendByCategory).toEqual([
      { category: "Dining", total: 48.41 },
      { category: "Shopping", total: 31.5 },
    ]);
    expect(result.topMerchants).toEqual([
      { merchant: "Atticus", total: 31.5, count: 1 },
      { merchant: "Nice Day Chinese", total: 28.41, count: 1 },
      { merchant: "Chick-fil-A", total: 20.0, count: 2 },
    ]);
  });

  it("uses the inclusive data span for daily average when no month is given", () => {
    // 04-05 → 04-20 inclusive = 16 days; 79.91 / 16 = 4.9943… → 4.99
    expect(computeAnalytics(APRIL).averageDailySpend).toBe(4.99);
  });

  it("sums in cents so float drift cannot accumulate", () => {
    const drifty = Array.from({ length: 10 }, (_, i) =>
      txn("2026-04-01", `M${i}`, "Dining", 0.1)
    );
    expect(computeAnalytics(drifty, { month: "2026-04" }).totalSpend).toBe(1.0);
  });

  it("breaks ties alphabetically and caps top merchants at 5", () => {
    const six = ["F", "E", "D", "C", "B", "A"].map((m) =>
      txn("2026-04-01", m, "Dining", 10)
    );
    const { topMerchants } = computeAnalytics(six, { month: "2026-04" });
    expect(topMerchants.map((m) => m.merchant)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("returns zeros and empty lists for no data", () => {
    expect(computeAnalytics([])).toEqual({
      totalSpend: 0,
      transactionCount: 0,
      averageDailySpend: 0,
      spendByCategory: [],
      topMerchants: [],
    });
  });
});

const db = await probeTestDb("analytics.test");

describe.skipIf(!db.available)("GET /api/analytics", () => {
  const client = db.client!;
  const marker = `an-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const m1 = `M1-${marker}`;
  const m2 = `M2-${marker}`;
  const catA = `CatA-${marker}`;
  const catB = `CatB-${marker}`;

  beforeAll(async () => {
    // July 1999: far from every other test's data, so month=1999-07 isolates us.
    const batch = await client.importBatch.create({
      data: { fileName: `${marker}.pdf`, transactionCount: 3 },
    });
    await client.transaction.createMany({
      data: [
        { date: new Date("1999-07-01"), merchant: m1, category: catA, amount: "10.00" },
        { date: new Date("1999-07-15"), merchant: m1, category: catB, amount: "5.50" },
        { date: new Date("1999-07-20"), merchant: m2, category: catA, amount: "15.00" },
      ].map((t) => ({ ...t, importBatchId: batch.id, categorySource: "ai" as const })),
    });
  });

  afterAll(async () => {
    await client.transaction.deleteMany({ where: { merchant: { in: [m1, m2] } } });
    await client.importBatch.deleteMany({ where: { fileName: `${marker}.pdf` } });
    await client.$disconnect();
  });

  async function get(query: string) {
    const { GET } = await import("@/app/api/analytics/route");
    return GET(new Request(`http://test/api/analytics${query}`));
  }

  it("computes exact metrics for a month", async () => {
    const response = await get("?month=1999-07");
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.totalSpend).toBe(30.5);
    expect(body.transactionCount).toBe(3);
    // 30.50 / 31 days = 0.9838… → 0.98
    expect(body.averageDailySpend).toBe(0.98);
    expect(body.spendByCategory).toEqual([
      { category: catA, total: 25.0 },
      { category: catB, total: 5.5 },
    ]);
    expect(body.topMerchants).toEqual([
      { merchant: m1, total: 15.5, count: 2 },
      { merchant: m2, total: 15.0, count: 1 },
    ]);
  });

  it("respects the category filter (case-insensitive, no month)", async () => {
    const response = await get(`?category=${catA.toLowerCase()}`);
    const body = await response.json();

    expect(body.totalSpend).toBe(25.0);
    expect(body.transactionCount).toBe(2);
    // span 07-01 → 07-20 inclusive = 20 days; 25.00 / 20 = 1.25
    expect(body.averageDailySpend).toBe(1.25);
  });

  it("respects the merchant filter combined with month", async () => {
    const response = await get(`?merchant=${m2.toUpperCase()}&month=1999-07`);
    const body = await response.json();

    expect(body.totalSpend).toBe(15.0);
    expect(body.transactionCount).toBe(1);
    expect(body.spendByCategory).toEqual([{ category: catA, total: 15.0 }]);
  });

  it("rejects a malformed month", async () => {
    expect((await get("?month=99-07")).status).toBe(400);
  });
});
