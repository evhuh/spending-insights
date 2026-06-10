import { prisma } from "@/lib/prisma";
import { monthRange, serializeTransaction } from "@/lib/transactions";

import type { Prisma } from "@/lib/generated/prisma/client";

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const where: Prisma.TransactionWhereInput = {};

  const month = searchParams.get("month");
  if (month !== null) {
    const range = monthRange(month);
    if (range === null) {
      return Response.json({ error: "month must be YYYY-MM" }, { status: 400 });
    }
    where.date = range;
  }
  const category = searchParams.get("category");
  if (category !== null) {
    where.category = { equals: category, mode: "insensitive" };
  }
  const merchant = searchParams.get("merchant");
  if (merchant !== null) {
    where.merchant = { equals: merchant, mode: "insensitive" };
  }

  const transactions = await prisma.transaction.findMany({
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  return Response.json({ transactions: transactions.map(serializeTransaction) });
}
