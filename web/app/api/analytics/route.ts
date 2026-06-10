import { computeAnalytics } from "@/lib/analytics";
import { prisma } from "@/lib/prisma";
import { transactionWhereFromParams } from "@/lib/transactions";

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const filter = transactionWhereFromParams(searchParams);
  if (!filter.ok) {
    return Response.json({ error: filter.error }, { status: 400 });
  }

  const rows = await prisma.transaction.findMany({
    where: filter.where,
    select: { date: true, merchant: true, category: true, amount: true },
  });

  const analytics = computeAnalytics(
    rows.map((row) => ({ ...row, amount: Number(row.amount) })),
    { month: searchParams.get("month") ?? undefined }
  );
  return Response.json(analytics);
}
