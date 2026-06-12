// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { FakeNotion } from "./helpers/fake-notion";
import { probeTestDb } from "./helpers/db";

// Notion MOCKED; one shared fake so the upsert assertions span calls.
const fakeNotion = new FakeNotion();
vi.mock("@/lib/notion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notion")>()),
  createNotionApi: () => fakeNotion,
}));

// OpenAI MOCKED with a spy: the report path must never generate insights.
const generateMock = vi.fn(async () => ({ insights: ["x", "y", "z"] }));
vi.mock("@/lib/openai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/openai")>()),
  createOpenAIInsightsGenerator: () => ({ generate: generateMock }),
}));

const db = await probeTestDb("reports-insights.test");

describe.skipIf(!db.available)("POST /api/reports — Insights section", () => {
  const client = db.client!;
  const marker = `repins-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const merchant = `M-${marker}`;
  const category = `Cat-${marker}`;
  // September/October 1995: isolated months no other test writes to.
  const WITH_INSIGHTS = "1995-09";
  const WITHOUT_INSIGHTS = "1995-10";
  const STORED = [
    "Dining rose 14% month over month.",
    "HEB was the largest merchant.",
    "Spending concentrated mid-month.",
  ];

  beforeAll(async () => {
    process.env.NOTION_DATABASE_ID = "db-test";
    const batch = await client.importBatch.create({
      data: { fileName: `${marker}.pdf`, transactionCount: 2 },
    });
    await client.transaction.createMany({
      data: [
        { date: new Date("1995-09-05"), merchant, category, amount: "20.00" },
        { date: new Date("1995-10-05"), merchant, category, amount: "30.00" },
      ].map((t) => ({ ...t, importBatchId: batch.id, categorySource: "ai" as const })),
    });
    await client.monthlyInsight.create({
      data: {
        month: WITH_INSIGHTS,
        insights: STORED,
        analyticsFingerprint: "fp-test",
      },
    });
  });

  afterAll(async () => {
    await client.transaction.deleteMany({ where: { merchant } });
    await client.importBatch.deleteMany({ where: { fileName: `${marker}.pdf` } });
    await client.monthlyInsight.deleteMany({ where: { month: WITH_INSIGHTS } });
    await client.$disconnect();
  });

  async function post(month: string) {
    const { POST } = await import("@/app/api/reports/route");
    return POST(
      new Request("http://test/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ month }),
      })
    );
  }

  function bulletTexts(blocks: Record<string, unknown>[]): (string | undefined)[] {
    return blocks.map((block) =>
      block.type === "heading_2"
        ? (block.heading_2 as { rich_text: { text: { content: string } }[] }).rich_text[0]
            .text.content
        : (block.bulleted_list_item as { rich_text: { text: { content: string } }[] })
            ?.rich_text[0].text.content
    );
  }

  it("appends the Insights section after Top Merchants using the exact stored strings", async () => {
    const response = await post(WITH_INSIGHTS);
    expect(response.status).toBe(200);

    const page = fakeNotion.pages.find((p) => p.month === WITH_INSIGHTS)!;
    const texts = bulletTexts(page.blocks);

    const insightsIndex = texts.indexOf("Insights");
    expect(insightsIndex).toBeGreaterThan(texts.indexOf("Top Merchants"));
    expect(texts.slice(insightsIndex + 1)).toEqual(STORED);

    // Overview properties unchanged.
    expect(page.properties).toEqual({
      Month: { title: [{ text: { content: WITH_INSIGHTS } }] },
      "Total Spend": { number: 20.0 },
      "Transaction Count": { number: 1 },
      "Average Daily Spend": { number: 0.67 },
    });
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("omits the Insights section entirely when none are stored — and never generates", async () => {
    const response = await post(WITHOUT_INSIGHTS);
    expect(response.status).toBe(200);

    const page = fakeNotion.pages.find((p) => p.month === WITHOUT_INSIGHTS)!;
    const texts = bulletTexts(page.blocks);
    expect(texts).not.toContain("Insights");
    expect(texts).toContain("Top Categories");
    expect(texts).toContain("Top Merchants");
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("still upserts a single Notion row per month", async () => {
    const response = await post(WITH_INSIGHTS);
    expect((await response.json()).action).toBe("updated");

    const pages = fakeNotion.pages.filter((p) => p.month === WITH_INSIGHTS);
    expect(pages).toHaveLength(1);
    // The refreshed body still ends with the stored insights.
    expect(bulletTexts(pages[0].blocks).slice(-3)).toEqual(STORED);
    expect(generateMock).not.toHaveBeenCalled();
  });
});
