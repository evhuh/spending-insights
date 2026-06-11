// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { FakeNotion } from "./helpers/fake-notion";
import { probeTestDb } from "./helpers/db";

// One shared fake so both POSTs in the upsert test hit the same "Notion".
const fakeNotion = new FakeNotion();

vi.mock("@/lib/notion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notion")>()),
  createNotionApi: () => fakeNotion,
}));

const db = await probeTestDb("reports.test");

describe.skipIf(!db.available)("POST /api/reports", () => {
  const client = db.client!;
  const marker = `rep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const mA = `M-A-${marker}`;
  const mB = `M-B-${marker}`;
  const catX = `CatX-${marker}`;
  const catY = `CatY-${marker}`;

  beforeAll(async () => {
    process.env.NOTION_DATABASE_ID = "db-test";
    // March 1998: isolated month no other test writes to.
    const batch = await client.importBatch.create({
      data: { fileName: `${marker}.pdf`, transactionCount: 3 },
    });
    await client.transaction.createMany({
      data: [
        { date: new Date("1998-03-02"), merchant: mA, category: catX, amount: "40.00" },
        { date: new Date("1998-03-10"), merchant: mB, category: catX, amount: "10.00" },
        { date: new Date("1998-03-15"), merchant: mA, category: catY, amount: "25.50" },
      ].map((t) => ({ ...t, importBatchId: batch.id, categorySource: "ai" as const })),
    });
  });

  afterAll(async () => {
    await client.transaction.deleteMany({ where: { merchant: { in: [mA, mB] } } });
    await client.importBatch.deleteMany({ where: { fileName: `${marker}.pdf` } });
    await client.$disconnect();
  });

  async function post(body: unknown) {
    const { POST } = await import("@/app/api/reports/route");
    return POST(
      new Request("http://test/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  }

  it("generates the report from the DB and creates the Notion row", async () => {
    const response = await post({ month: "1998-03" });
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.action).toBe("created");
    // Hand-computed: 40 + 10 + 25.50 = 75.50 over 31 days → 2.44/day.
    expect(body.report.totalSpend).toBe(75.5);
    expect(body.report.transactionCount).toBe(3);
    expect(body.report.averageDailySpend).toBe(2.44);

    expect(fakeNotion.pages).toHaveLength(1);
    const page = fakeNotion.pages[0];
    expect(page.properties).toEqual({
      Month: { title: [{ text: { content: "1998-03" } }] },
      "Total Spend": { number: 75.5 },
      "Transaction Count": { number: 3 },
      "Average Daily Spend": { number: 2.44 },
    });
    const blocks = JSON.stringify(page.blocks);
    expect(blocks).toContain("Top Categories");
    expect(blocks).toContain(`${catX} — $50.00`);
    expect(blocks).toContain("Top Merchants");
    expect(blocks).toContain(`${mA} — $65.50 (2×)`);
  });

  it("re-running the same month updates the row instead of duplicating", async () => {
    const response = await post({ month: "1998-03" });
    expect((await response.json()).action).toBe("updated");
    expect(fakeNotion.pages).toHaveLength(1);
  });

  it("rejects a malformed month", async () => {
    expect((await post({ month: "March 1998" })).status).toBe(400);
    expect((await post({})).status).toBe(400);
  });
});
