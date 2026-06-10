import { prisma } from "@/lib/prisma";
import { serializeTransaction, transactionWhereFromParams } from "@/lib/transactions";

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const filter = transactionWhereFromParams(searchParams);
  if (!filter.ok) {
    return Response.json({ error: filter.error }, { status: 400 });
  }

  const transactions = await prisma.transaction.findMany({
    where: filter.where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  return Response.json({ transactions: transactions.map(serializeTransaction) });
}
