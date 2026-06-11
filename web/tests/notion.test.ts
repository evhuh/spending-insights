// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Analytics } from "@/lib/analytics";
import {
  buildMonthlyReport,
  createNotionApi,
  reportBodyBlocks,
  reportProperties,
  syncMonthlyReport,
} from "@/lib/notion";

import { FakeNotion } from "./helpers/fake-notion";

const ANALYTICS: Analytics = {
  totalSpend: 75.5,
  transactionCount: 3,
  averageDailySpend: 2.44,
  spendByCategory: [
    { category: "CatX", total: 50.0 },
    { category: "CatY", total: 25.5 },
  ],
  topMerchants: [
    { merchant: "M-A", total: 65.5, count: 2 },
    { merchant: "M-B", total: 10.0, count: 1 },
  ],
};

const REPORT = buildMonthlyReport("1998-03", ANALYTICS);

describe("report payloads", () => {
  it("builds exactly the agreed property schema", () => {
    expect(reportProperties(REPORT)).toEqual({
      Month: { title: [{ text: { content: "1998-03" } }] },
      "Total Spend": { number: 75.5 },
      "Transaction Count": { number: 3 },
      "Average Daily Spend": { number: 2.44 },
    });
  });

  it("puts top categories and merchants in body blocks, not properties", () => {
    const blocks = reportBodyBlocks(REPORT);
    const texts = blocks.map((b) => {
      const block = b as {
        type: string;
        [key: string]: unknown;
      };
      const content = block[block.type] as { rich_text: { text: { content: string } }[] };
      return `${block.type}: ${content.rich_text[0].text.content}`;
    });

    expect(texts).toEqual([
      "heading_2: Top Categories",
      "bulleted_list_item: CatX — $50.00",
      "bulleted_list_item: CatY — $25.50",
      "heading_2: Top Merchants",
      "bulleted_list_item: M-A — $65.50 (2×)",
      "bulleted_list_item: M-B — $10.00 (1×)",
    ]);

    // None of the body content leaks into properties.
    const properties = reportProperties(REPORT);
    expect(JSON.stringify(properties)).not.toContain("CatX");
    expect(JSON.stringify(properties)).not.toContain("M-A");
  });

  it("caps both top lists at 5", () => {
    const many: Analytics = {
      ...ANALYTICS,
      spendByCategory: Array.from({ length: 8 }, (_, i) => ({
        category: `C${i}`,
        total: 8 - i,
      })),
    };
    expect(buildMonthlyReport("1998-03", many).topCategories).toHaveLength(5);
  });
});

describe("syncMonthlyReport (upsert)", () => {
  it("creates a page when the month has none", async () => {
    const notion = new FakeNotion();
    const result = await syncMonthlyReport(notion, "db-1", REPORT);

    expect(result.action).toBe("created");
    expect(notion.pages).toHaveLength(1);
    expect(notion.pages[0].month).toBe("1998-03");
    expect(notion.pages[0].blocks).toHaveLength(6);
  });

  it("updates the existing page on re-run instead of duplicating", async () => {
    const notion = new FakeNotion();
    const first = await syncMonthlyReport(notion, "db-1", REPORT);

    const revised = buildMonthlyReport("1998-03", {
      ...ANALYTICS,
      totalSpend: 99.99,
      spendByCategory: [{ category: "CatZ", total: 99.99 }],
    });
    const second = await syncMonthlyReport(notion, "db-1", revised);

    expect(second.action).toBe("updated");
    expect(second.pageId).toBe(first.pageId);
    expect(notion.pages).toHaveLength(1);

    // Properties were replaced…
    expect(notion.pages[0].properties["Total Spend"]).toEqual({ number: 99.99 });
    // …and the old body blocks were cleared before the new ones were appended.
    expect(notion.deletedBlockIds).toHaveLength(6);
    const body = JSON.stringify(notion.pages[0].blocks);
    expect(body).toContain("CatZ");
    expect(body).not.toContain("CatX");
  });

  it("keeps one page per month across different months", async () => {
    const notion = new FakeNotion();
    await syncMonthlyReport(notion, "db-1", REPORT);
    await syncMonthlyReport(notion, "db-1", buildMonthlyReport("1998-04", ANALYTICS));

    expect(notion.pages.map((p) => p.month)).toEqual(["1998-03", "1998-04"]);
  });
});


describe("createNotionApi database-id resolution", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubNotion(routes: Record<string, { status: number; body: unknown }>) {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const key = `${init?.method ?? "GET"} ${String(input).replace("https://api.notion.com/v1", "")}`;
        calls.push(key);
        const route = routes[key];
        if (!route) throw new Error(`unmocked notion call: ${key}`);
        return new Response(JSON.stringify(route.body), { status: route.status });
      })
    );
    return calls;
  }

  it("uses the configured id directly when it is a database", async () => {
    const calls = stubNotion({
      "GET /databases/db-1": { status: 200, body: {} },
      "POST /databases/db-1/query": { status: 200, body: { results: [] } },
    });
    const api = createNotionApi("key");
    expect(await api.findPageByMonth("db-1", "2026-04")).toBeNull();
    expect(calls).toContain("POST /databases/db-1/query");
  });

  it("resolves a PAGE id to the database inside it", async () => {
    const calls = stubNotion({
      "GET /databases/page-1": { status: 400, body: { message: "is a page" } },
      "GET /blocks/page-1/children?page_size=100": {
        status: 200,
        body: { results: [{ id: "real-db", type: "child_database" }] },
      },
      "POST /databases/real-db/query": {
        status: 200,
        body: { results: [{ id: "existing-page" }] },
      },
    });
    const api = createNotionApi("key");
    expect(await api.findPageByMonth("page-1", "2026-04")).toBe("existing-page");
    expect(calls).toContain("POST /databases/real-db/query");
  });

  it("explains clearly when the page contains no database", async () => {
    stubNotion({
      "GET /databases/page-1": { status: 400, body: { message: "is a page" } },
      "GET /blocks/page-1/children?page_size=100": {
        status: 200,
        body: { results: [{ id: "b1", type: "paragraph" }] },
      },
    });
    await expect(createNotionApi("key").findPageByMonth("page-1", "2026-04")).rejects.toThrow(
      /is not a database and contains no database/
    );
  });
});
