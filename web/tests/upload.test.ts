// @vitest-environment node
import "dotenv/config";

import fs from "node:fs";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { ExtractResult } from "@/lib/extractor-client";
import { PrismaClient } from "@/lib/generated/prisma/client";

// The extractor HTTP call and OpenAI are external boundaries — both mocked.
const FIXTURE_RESULT: ExtractResult = {
  statementPeriod: { year: 2026, closingDate: "2026-05-20", yearResolved: true },
  transactions: [
    {
      date: "2026-04-22",
      merchant: "Chick-fil-A",
      rawDescription: "CHICK-FIL-A #03663 NORTH HAVEN CT",
      amount: 12.66,
    },
    {
      date: "2026-04-25",
      merchant: "Nice Day Chinese",
      rawDescription: "SQ *NICE DAY CHINESE NEW gosq.com CT",
      amount: 28.41,
    },
    {
      date: "2026-05-02",
      merchant: "Nice Day Chinese",
      rawDescription: "SQ *NICE DAY CHINESE NEW gosq.com CT",
      amount: 19.92,
    },
    {
      date: "2026-05-05",
      merchant: "Atticus Bookstore Cafe",
      rawDescription: "TST*ATTICUS BOOKSTORE CA New Haven CT",
      amount: 31.5,
    },
  ],
  validation: { extractedPurchaseTotal: 92.49, statementPurchaseTotal: 92.49, match: true },
};

const AI_CATEGORIES: Record<string, string> = {
  "Chick-fil-A": "Dining",
  "Atticus Bookstore Cafe": "Shopping",
};

vi.mock("@/lib/extractor-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/extractor-client")>()),
  extractStatement: vi.fn(async () => FIXTURE_RESULT),
}));

vi.mock("@/lib/openai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/openai")>()),
  createOpenAICategorizer: () => ({
    categorizeMany: async (merchants: string[]) =>
      new Map(merchants.map((m) => [m, AI_CATEGORIES[m] ?? "Other"])),
  }),
}));

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
  console.warn(`[upload.test] SKIPPED: ${skipReason}`);
}

describe.skipIf(!dbAvailable)("POST /api/upload", () => {
  const fileName = `upload-test-${Date.now()}.pdf`;
  const merchants = [...new Set(FIXTURE_RESULT.transactions.map((t) => t.merchant))];
  let batchId: string;

  beforeAll(async () => {
    // The route's prisma singleton must hit the TEST database.
    process.env.DATABASE_URL = connectionString;
    await client!.transaction.deleteMany({ where: { merchant: { in: merchants } } });
    await client!.merchantRule.deleteMany({
      where: { merchantPattern: "Nice Day Chinese" },
    });
    await client!.merchantRule.create({
      data: { merchantPattern: "Nice Day Chinese", category: "Dining" },
    });
  });

  afterAll(async () => {
    await client!.transaction.deleteMany({ where: { merchant: { in: merchants } } });
    await client!.merchantRule.deleteMany({
      where: { merchantPattern: "Nice Day Chinese" },
    });
    await client!.importBatch.deleteMany({ where: { fileName } });
    await client!.$disconnect();
  });

  it("uploads, classifies (rule beats AI), and stores everything", async () => {
    const writeSpies = [
      vi.spyOn(fs, "writeFileSync"),
      vi.spyOn(fs.promises, "writeFile"),
      vi.spyOn(fs, "createWriteStream"),
    ];

    const { POST } = await import("@/app/api/upload/route");
    const form = new FormData();
    form.append(
      "file",
      new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], fileName, {
        type: "application/pdf",
      })
    );

    const response = await POST(
      new Request("http://test/api/upload", { method: "POST", body: form })
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    batchId = body.importBatchId;
    expect(body.transactionCount).toBe(4);
    expect(body.validation.match).toBe(true);

    const batch = await client!.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.fileName).toBe(fileName);
    expect(batch.transactionCount).toBe(4);

    const stored = await client!.transaction.findMany({
      where: { importBatchId: batchId },
      orderBy: { date: "asc" },
    });
    expect(stored).toHaveLength(4);

    // Seeded rule applies to both Nice Day rows; everything else is AI.
    const bySource = Object.groupBy(stored, (t) => t.categorySource);
    expect(bySource.rule?.map((t) => t.merchant)).toEqual([
      "Nice Day Chinese",
      "Nice Day Chinese",
    ]);
    expect(bySource.rule?.every((t) => t.category === "Dining")).toBe(true);
    expect(bySource.ai?.map((t) => [t.merchant, t.category])).toEqual([
      ["Chick-fil-A", "Dining"],
      ["Atticus Bookstore Cafe", "Shopping"],
    ]);

    // Amounts are positive decimals; raw descriptions are NOT stored (no column).
    expect(stored.map((t) => t.amount.toFixed(2))).toEqual([
      "12.66",
      "28.41",
      "19.92",
      "31.50",
    ]);

    // The PDF never touches disk.
    for (const spy of writeSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("rejects a request without a file", async () => {
    const { POST } = await import("@/app/api/upload/route");
    const response = await POST(
      new Request("http://test/api/upload", { method: "POST", body: new FormData() })
    );
    expect(response.status).toBe(400);
  });
});
