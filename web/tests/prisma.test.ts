// @vitest-environment node
import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/lib/generated/prisma/client";

// Self-tests run against the local test database only — never real data.
const connectionString = process.env.TEST_DATABASE_URL;

let client: PrismaClient | undefined;
let dbAvailable = false;
let skipReason = "TEST_DATABASE_URL is not set";

if (connectionString) {
  client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    await client.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch (error) {
    skipReason = `test database unreachable at TEST_DATABASE_URL: ${String(error)}`;
  }
}

if (!dbAvailable) {
  // Surface the skip loudly rather than faking a pass (see IMPLEMENTATION_PLAN
  // Phase 1): these tests need a reachable local Postgres.
  console.warn(`[prisma.test] SKIPPED: ${skipReason}`);
}

describe.skipIf(!dbAvailable)("prisma models round-trip", () => {
  const marker = `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  afterAll(async () => {
    if (!client) return;
    await client.transaction.deleteMany({ where: { merchant: marker } });
    await client.merchantRule.deleteMany({ where: { merchantPattern: marker } });
    await client.importBatch.deleteMany({ where: { fileName: marker } });
    await client.$disconnect();
  });

  it("inserts and reads back an import batch + transaction", async () => {
    const batch = await client!.importBatch.create({
      data: { fileName: marker, transactionCount: 1 },
    });
    expect(batch.id).toMatch(/^[0-9a-f-]{36}$/);

    const created = await client!.transaction.create({
      data: {
        date: new Date("2026-04-22"),
        merchant: marker,
        amount: "12.66",
        category: "Dining",
        importBatchId: batch.id,
        categorySource: "ai",
      },
    });

    const found = await client!.transaction.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(found.merchant).toBe(marker);
    expect(found.amount.toString()).toBe("12.66");
    expect(found.categorySource).toBe("ai");
    expect(found.importBatchId).toBe(batch.id);
    expect(found.createdAt).toBeInstanceOf(Date);
    expect(found.updatedAt).toBeInstanceOf(Date);
  });

  it("inserts and reads back a merchant rule; pattern is UNIQUE", async () => {
    const rule = await client!.merchantRule.create({
      data: { merchantPattern: marker, category: "Dining" },
    });

    const found = await client!.merchantRule.findUniqueOrThrow({
      where: { merchantPattern: marker },
    });
    expect(found.id).toBe(rule.id);
    expect(found.category).toBe("Dining");

    await expect(
      client!.merchantRule.create({
        data: { merchantPattern: marker, category: "Other" },
      })
    ).rejects.toThrow();
  });
});
