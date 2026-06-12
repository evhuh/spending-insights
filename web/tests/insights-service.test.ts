// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { probeTestDb } from "./helpers/db";

// OpenAI is an external boundary — the generator is a controllable fake.
function fakeGenerator(...responses: unknown[]) {
  const queue = [...responses];
  return {
    generate: vi.fn<(payload: unknown) => Promise<unknown>>(async () =>
      queue.length > 0 ? queue.shift() : { insights: ["a", "b", "c"] }
    ),
  };
}

const db = await probeTestDb("insights-service.test");

describe.skipIf(!db.available)("insights service", () => {
  const client = db.client!;
  const marker = `ins-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const merchant = `M-${marker}`;
  const category = `Cat-${marker}`;
  // May 1997 (with April 1997 as the prior month): isolated from other tests.
  const MONTH = "1997-05";

  beforeAll(async () => {
    const batch = await client.importBatch.create({
      data: { fileName: `${marker}.pdf`, transactionCount: 3 },
    });
    // Prior month 100.00 → current month 114.00 = +14% MoM, hand-computed.
    await client.transaction.createMany({
      data: [
        { date: new Date("1997-04-10"), merchant, category, amount: "100.00" },
        { date: new Date("1997-05-08"), merchant, category, amount: "64.00" },
        { date: new Date("1997-05-21"), merchant, category, amount: "50.00" },
      ].map((t) => ({ ...t, importBatchId: batch.id, categorySource: "ai" as const })),
    });
  });

  afterAll(async () => {
    await client.transaction.deleteMany({ where: { merchant } });
    await client.importBatch.deleteMany({ where: { fileName: `${marker}.pdf` } });
    await client.monthlyInsight.deleteMany({ where: { month: MONTH } });
    await client.$disconnect();
  });

  it("sends only the aggregated payload to the LLM — never raw transactions", async () => {
    const { generateInsights } = await import("@/lib/insights");
    const generator = fakeGenerator({ insights: ["i1", "i2", "i3"] });

    await generateInsights(MONTH, generator);

    expect(generator.generate).toHaveBeenCalledTimes(1);
    const payload = generator.generate.mock.calls[0][0];
    expect(payload).toEqual({
      month: MONTH,
      totalSpend: 114.0,
      topCategories: [{ category, amount: 114.0 }],
      topMerchants: [{ merchant, amount: 114.0 }],
      momChanges: [{ category, changePct: 14 }],
    });
    // No per-transaction data crosses the boundary.
    expect(JSON.stringify(payload)).not.toContain('"date"');
  });

  it("upserts a single row per month and regenerating updates it in place", async () => {
    const { generateInsights } = await import("@/lib/insights");

    const first = await generateInsights(MONTH, fakeGenerator({ insights: ["a1", "a2", "a3"] }));
    const second = await generateInsights(MONTH, fakeGenerator({ insights: ["b1", "b2", "b3"] }));

    expect(first.insights).toEqual(["a1", "a2", "a3"]);
    expect(second.insights).toEqual(["b1", "b2", "b3"]);
    expect(second.stale).toBe(false);

    const rows = await client.monthlyInsight.findMany({ where: { month: MONTH } });
    expect(rows).toHaveLength(1);
    expect(rows[0].insights).toEqual(["b1", "b2", "b3"]);
    expect(rows[0].generatedAt.toISOString()).toBe(second.generatedAt);
  });

  it("getInsights returns the stored row without any LLM call, then stale flips after a data change", async () => {
    const { generateInsights, getInsights } = await import("@/lib/insights");

    const generator = fakeGenerator({ insights: ["fresh1", "fresh2", "fresh3"] });
    await generateInsights(MONTH, generator);

    const fresh = await getInsights(MONTH);
    expect(fresh).not.toBeNull();
    expect(fresh!.insights).toEqual(["fresh1", "fresh2", "fresh3"]);
    expect(fresh!.stale).toBe(false);
    // getInsights has no generator path at all; the only fake in play was
    // called exactly once, by generateInsights.
    expect(generator.generate).toHaveBeenCalledTimes(1);

    // Seeded data change in the month → fingerprint differs → stale.
    const batch = await client.importBatch.create({
      data: { fileName: `${marker}-extra.pdf`, transactionCount: 1 },
    });
    await client.transaction.create({
      data: {
        date: new Date("1997-05-28"),
        merchant,
        category,
        amount: "5.00",
        importBatchId: batch.id,
        categorySource: "ai",
      },
    });

    const afterEdit = await getInsights(MONTH);
    expect(afterEdit!.stale).toBe(true);
    expect(afterEdit!.insights).toEqual(["fresh1", "fresh2", "fresh3"]);
    expect(generator.generate).toHaveBeenCalledTimes(1);

    await client.importBatch.deleteMany({ where: { fileName: `${marker}-extra.pdf` } });
  });

  it("getInsights returns null for a month with nothing stored", async () => {
    const { getInsights } = await import("@/lib/insights");
    expect(await getInsights("1997-01")).toBeNull();
  });

  it("refuses to generate for a month with no spending — no LLM call, nothing stored", async () => {
    const { generateInsights, getInsights, InsightsNoDataError } = await import(
      "@/lib/insights"
    );
    const generator = fakeGenerator({ insights: ["a", "b", "c"] });

    // 1997-02 has no seeded transactions.
    await expect(generateInsights("1997-02", generator)).rejects.toThrow(
      InsightsNoDataError
    );
    expect(generator.generate).not.toHaveBeenCalled();
    expect(await getInsights("1997-02")).toBeNull();
  });

  it("retries malformed LLM output once, then succeeds", async () => {
    const { generateInsights } = await import("@/lib/insights");
    const generator = fakeGenerator(
      { wrong: "shape" },
      { insights: ["r1", "r2", "r3"] }
    );

    const result = await generateInsights(MONTH, generator);
    expect(result.insights).toEqual(["r1", "r2", "r3"]);
    expect(generator.generate).toHaveBeenCalledTimes(2);
  });

  it("malformed output twice surfaces an error and stores nothing", async () => {
    const { generateInsights, getInsights, InsightsGenerationError } = await import(
      "@/lib/insights"
    );

    const before = await getInsights(MONTH);
    const generator = fakeGenerator(
      { insights: ["only", "two"] },
      { insights: [1, 2, 3] }
    );

    await expect(generateInsights(MONTH, generator)).rejects.toThrow(
      InsightsGenerationError
    );
    expect(generator.generate).toHaveBeenCalledTimes(2);

    // The previously stored row is untouched — garbage never lands.
    const after = await getInsights(MONTH);
    expect(after!.insights).toEqual(before!.insights);
    expect(after!.generatedAt).toBe(before!.generatedAt);
  });
});
