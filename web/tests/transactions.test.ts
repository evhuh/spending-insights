// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { probeTestDb } from "./helpers/db";

const db = await probeTestDb("transactions.test");

describe.skipIf(!db.available)("transactions API", () => {
  const client = db.client!;
  const marker = `tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const alpha = `M-Alpha-${marker}`;
  const beta = `M-Beta-${marker}`;
  const dining = `Cat-Dining-${marker}`;
  const books = `Cat-Books-${marker}`;
  const ids: Record<"a" | "b" | "c", string> = { a: "", b: "", c: "" };

  beforeAll(async () => {
    const batch = await client.importBatch.create({
      data: { fileName: `${marker}.pdf`, transactionCount: 3 },
    });
    const make = (date: string, merchant: string, category: string, source: "rule" | "ai") =>
      client.transaction.create({
        data: {
          date: new Date(date),
          merchant,
          amount: "10.00",
          category,
          importBatchId: batch.id,
          categorySource: source,
        },
      });
    ids.a = (await make("2026-04-22", alpha, dining, "ai")).id;
    ids.b = (await make("2026-05-02", beta, dining, "rule")).id;
    ids.c = (await make("2026-05-05", alpha, books, "ai")).id;
  });

  afterAll(async () => {
    await client.transaction.deleteMany({ where: { merchant: { in: [alpha, beta] } } });
    await client.importBatch.deleteMany({ where: { fileName: `${marker}.pdf` } });
    await client.$disconnect();
  });

  async function getTransactions(query: string) {
    const { GET } = await import("@/app/api/transactions/route");
    const response = await GET(new Request(`http://test/api/transactions${query}`));
    return response;
  }

  /** Only the rows this test created, so parallel/leftover data can't interfere. */
  function ours(body: { transactions: { merchant: string; id: string }[] }) {
    return body.transactions.filter((t) => [alpha, beta].includes(t.merchant));
  }

  it("filters by month", async () => {
    const response = await getTransactions("?month=2026-05");
    expect(response.status).toBe(200);
    const mine = ours(await response.json());
    expect(mine.map((t) => t.id).sort()).toEqual([ids.b, ids.c].sort());
  });

  it("filters by category (case-insensitive)", async () => {
    const response = await getTransactions(`?category=${dining.toLowerCase()}`);
    const mine = ours(await response.json());
    expect(mine.map((t) => t.id).sort()).toEqual([ids.a, ids.b].sort());
  });

  it("filters by merchant (case-insensitive) combined with month", async () => {
    const response = await getTransactions(`?merchant=${alpha.toUpperCase()}&month=2026-04`);
    const mine = ours(await response.json());
    expect(mine.map((t) => t.id)).toEqual([ids.a]);
  });

  it("rejects a malformed month", async () => {
    const response = await getTransactions("?month=April-2026");
    expect(response.status).toBe(400);
  });

  async function patch(id: string, body: unknown) {
    const { PATCH } = await import("@/app/api/transactions/[id]/route");
    return PATCH(
      new Request(`http://test/api/transactions/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) }
    );
  }

  it("updates editable fields without touching categorySource", async () => {
    const response = await patch(ids.a, {
      date: "2026-04-23",
      merchant: `${alpha} Renamed`,
      amount: 13.37,
      notes: "lunch",
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.promptApplyToFuture).toBe(false);
    expect(body.transaction).toMatchObject({
      date: "2026-04-23",
      merchant: `${alpha} Renamed`,
      amount: 13.37,
      notes: "lunch",
      categorySource: "ai",
    });
    // restore the merchant so other assertions/cleanup still match
    await client.transaction.update({ where: { id: ids.a }, data: { merchant: alpha } });
  });

  it("flips categorySource to manual on a category change and signals the prompt", async () => {
    const response = await patch(ids.b, { category: books });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.promptApplyToFuture).toBe(true);
    expect(body.transaction.categorySource).toBe("manual");

    // Decline path: no rule gets created unless POST /api/merchant-rules is called.
    expect(await client.merchantRule.count({ where: { merchantPattern: beta } })).toBe(0);
  });

  it("does not prompt when the category is unchanged", async () => {
    const response = await patch(ids.c, { category: books });
    const body = await response.json();
    expect(body.promptApplyToFuture).toBe(false);
    expect(body.transaction.categorySource).toBe("ai");
  });

  it.each([
    { categorySource: "manual" },
    { importBatchId: "forged-batch" },
    { id: "11111111-1111-1111-1111-111111111111" },
    { createdAt: "2020-01-01T00:00:00.000Z" },
    { updatedAt: "2020-01-01T00:00:00.000Z" },
  ])("rejects non-editable field %s", async (body) => {
    const response = await patch(ids.a, body);
    expect(response.status).toBe(400);
    const error = (await response.json()).error as string;
    expect(error).toContain("non-editable");

    const unchanged = await client.transaction.findUniqueOrThrow({ where: { id: ids.a } });
    expect(unchanged.categorySource).toBe("ai");
  });

  it("rejects a non-positive amount", async () => {
    const response = await patch(ids.a, { amount: -5 });
    expect(response.status).toBe(400);
  });

  it("404s on an unknown id", async () => {
    const response = await patch("00000000-0000-0000-0000-000000000000", {
      notes: "ghost",
    });
    expect(response.status).toBe(404);
  });
});
