// Shared probe for DB-backed tests: connect to TEST_DATABASE_URL or skip.
import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma/client";

export interface TestDb {
  client: PrismaClient | undefined;
  available: boolean;
  reason: string;
}

export async function probeTestDb(label: string): Promise<TestDb> {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    const reason = "TEST_DATABASE_URL is not set";
    console.warn(`[${label}] SKIPPED: ${reason}`);
    return { client: undefined, available: false, reason };
  }
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    await client.$queryRaw`SELECT 1`;
  } catch (error) {
    const reason = `test database unreachable: ${String(error)}`;
    console.warn(`[${label}] SKIPPED: ${reason}`);
    return { client, available: false, reason };
  }
  // Route handlers under test must hit the test database too.
  process.env.DATABASE_URL = connectionString;
  return { client, available: true, reason: "" };
}
