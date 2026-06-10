// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { classifyTransactions, rulesToMap } from "@/lib/classify";
import type { ExtractedTransaction } from "@/lib/extractor-client";
import type OpenAI from "openai";
import { createOpenAICategorizer } from "@/lib/openai";

function txn(merchant: string, amount = 10): ExtractedTransaction {
  return {
    date: "2026-04-22",
    merchant,
    rawDescription: `RAW ${merchant.toUpperCase()}`,
    amount,
  };
}

function fakeCategorizer(categories: Record<string, string>) {
  const categorizeMany = vi.fn(
    async (merchants: string[]) =>
      new Map(merchants.map((m) => [m, categories[m]]).filter(([, c]) => c) as [
        string,
        string,
      ][])
  );
  return { categorizeMany };
}

describe("classifyTransactions", () => {
  it("applies a matching rule with categorySource=rule (case-insensitive)", async () => {
    const rules = rulesToMap([{ merchantPattern: "NICE DAY CHINESE", category: "Dining" }]);
    const categorizer = fakeCategorizer({});

    const [result] = await classifyTransactions([txn("Nice Day Chinese")], rules, categorizer);

    expect(result.category).toBe("Dining");
    expect(result.categorySource).toBe("rule");
    expect(categorizer.categorizeMany).toHaveBeenCalledWith([]);
  });

  it("falls back to AI for unmatched merchants with categorySource=ai", async () => {
    const rules = rulesToMap([{ merchantPattern: "Nice Day Chinese", category: "Dining" }]);
    const categorizer = fakeCategorizer({ "Chick-fil-A": "Dining", Atticus: "Shopping" });

    const results = await classifyTransactions(
      [txn("Nice Day Chinese"), txn("Chick-fil-A"), txn("Atticus")],
      rules,
      categorizer
    );

    expect(results.map((r) => [r.category, r.categorySource])).toEqual([
      ["Dining", "rule"],
      ["Dining", "ai"],
      ["Shopping", "ai"],
    ]);
  });

  it("sends only unique unmatched merchants to the AI", async () => {
    const rules = rulesToMap([{ merchantPattern: "Nice Day Chinese", category: "Dining" }]);
    const categorizer = fakeCategorizer({ "Chick-fil-A": "Dining" });

    await classifyTransactions(
      [txn("Nice Day Chinese"), txn("Chick-fil-A"), txn("Chick-fil-A")],
      rules,
      categorizer
    );

    expect(categorizer.categorizeMany).toHaveBeenCalledExactlyOnceWith(["Chick-fil-A"]);
  });

  it("uses Other when the AI does not return a category", async () => {
    const [result] = await classifyTransactions(
      [txn("Mystery Vendor")],
      new Map(),
      fakeCategorizer({})
    );

    expect(result.category).toBe("Other");
    expect(result.categorySource).toBe("ai");
  });
});

describe("createOpenAICategorizer", () => {
  function fakeOpenAI(content: string) {
    const create = vi.fn(async () => ({
      choices: [{ message: { content } }],
    }));
    return {
      client: { chat: { completions: { create } } } as unknown as OpenAI,
      create,
    };
  }

  it("parses the mocked completion into a category map", async () => {
    const { client, create } = fakeOpenAI(
      JSON.stringify({ categories: { "Chick-fil-A": "Dining", Atticus: "Shopping" } })
    );
    const categorizer = createOpenAICategorizer(client, "test-model");

    const result = await categorizer.categorizeMany(["Chick-fil-A", "Atticus"]);

    expect(result).toEqual(
      new Map([
        ["Chick-fil-A", "Dining"],
        ["Atticus", "Shopping"],
      ])
    );
    expect(create).toHaveBeenCalledOnce();
  });

  it("coerces unknown categories to Other", async () => {
    const { client } = fakeOpenAI(
      JSON.stringify({ categories: { "Chick-fil-A": "Fried Chicken Emporium" } })
    );
    const result = await createOpenAICategorizer(client).categorizeMany(["Chick-fil-A"]);

    expect(result.get("Chick-fil-A")).toBe("Other");
  });

  it("skips the API entirely for an empty merchant list", async () => {
    const { client, create } = fakeOpenAI("{}");
    const result = await createOpenAICategorizer(client).categorizeMany([]);

    expect(result.size).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });
});
