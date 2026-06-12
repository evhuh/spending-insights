// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { probeTestDb } from "./helpers/db";

// OpenAI MOCKED at the module boundary so the routes' default generator is
// the fake. `responses` is reloaded per test; the spy counts every LLM call.
let responses: unknown[] = [];
const generateMock = vi.fn(async () =>
  responses.length > 0 ? responses.shift() : { insights: ["g1", "g2", "g3"] }
);
vi.mock("@/lib/openai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/openai")>()),
  createOpenAIInsightsGenerator: () => ({ generate: generateMock }),
}));

const db = await probeTestDb("insights-api.test");

describe.skipIf(!db.available)("/api/insights", () => {
  const client = db.client!;
  const marker = `insapi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const merchant = `M-${marker}`;
  const category = `Cat-${marker}`;
  // July 1996: isolated month no other test writes to.
  const MONTH = "1996-07";

  beforeAll(async () => {
    const batch = await client.importBatch.create({
      data: { fileName: `${marker}.pdf`, transactionCount: 1 },
    });
    await client.transaction.create({
      data: {
        date: new Date("1996-07-04"),
        merchant,
        category,
        amount: "42.00",
        importBatchId: batch.id,
        categorySource: "ai",
      },
    });
  });

  afterAll(async () => {
    await client.transaction.deleteMany({ where: { merchant } });
    await client.importBatch.deleteMany({ where: { fileName: { startsWith: marker } } });
    await client.monthlyInsight.deleteMany({ where: { month: MONTH } });
    await client.$disconnect();
  });

  async function post(body: unknown) {
    const { POST } = await import("@/app/api/insights/route");
    return POST(
      new Request("http://test/api/insights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  }

  async function get(query: string) {
    const { GET } = await import("@/app/api/insights/route");
    return GET(new Request(`http://test/api/insights${query}`));
  }

  it("rejects malformed months on both methods", async () => {
    expect((await post({ month: "96-07" })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await get("?month=1996-13")).status).toBe(400);
    expect((await get("")).status).toBe(400);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("GET returns the empty state when nothing is stored — without calling the LLM", async () => {
    const response = await get(`?month=${MONTH}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ month: MONTH, insights: null });
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("POST generates, persists one row, and regenerating upserts the same row", async () => {
    responses = [{ insights: ["p1", "p2", "p3"] }];
    const first = await post({ month: MONTH });
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.insights).toEqual(["p1", "p2", "p3"]);
    expect(firstBody.stale).toBe(false);

    responses = [{ insights: ["q1", "q2", "q3"] }];
    const second = await post({ month: MONTH });
    expect((await second.json()).insights).toEqual(["q1", "q2", "q3"]);

    const rows = await client.monthlyInsight.findMany({ where: { month: MONTH } });
    expect(rows).toHaveLength(1);
    expect(rows[0].insights).toEqual(["q1", "q2", "q3"]);
  });

  it("GET returns the stored set and never calls the LLM; stale flips after a data change", async () => {
    generateMock.mockClear();

    const fresh = await (await get(`?month=${MONTH}`)).json();
    expect(fresh.insights).toEqual(["q1", "q2", "q3"]);
    expect(fresh.stale).toBe(false);
    expect(generateMock).not.toHaveBeenCalled();

    const batch = await client.importBatch.create({
      data: { fileName: `${marker}-edit.pdf`, transactionCount: 1 },
    });
    await client.transaction.create({
      data: {
        date: new Date("1996-07-20"),
        merchant,
        category,
        amount: "9.99",
        importBatchId: batch.id,
        categorySource: "ai",
      },
    });

    const stale = await (await get(`?month=${MONTH}`)).json();
    expect(stale.stale).toBe(true);
    expect(stale.insights).toEqual(["q1", "q2", "q3"]);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("POST returns 422 for a month with no spending and never calls the LLM", async () => {
    generateMock.mockClear();
    // August 1996 has no seeded transactions.
    const response = await post({ month: "1996-08" });
    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain("no transactions");
    expect(generateMock).not.toHaveBeenCalled();
    expect(await client.monthlyInsight.findUnique({ where: { month: "1996-08" } })).toBeNull();
  });

  it("POST returns 502 on repeated malformed LLM output and stores nothing new", async () => {
    const before = await client.monthlyInsight.findUniqueOrThrow({ where: { month: MONTH } });

    responses = ["not json shape", { insights: ["x"] }];
    const response = await post({ month: MONTH });
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("malformed");

    const after = await client.monthlyInsight.findUniqueOrThrow({ where: { month: MONTH } });
    expect(after.insights).toEqual(before.insights);
    expect(after.generatedAt.toISOString()).toBe(before.generatedAt.toISOString());
  });
});
