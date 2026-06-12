import { computeAnalytics } from "@/lib/analytics";
import { buildMonthlyReport, createNotionApi, syncMonthlyReport } from "@/lib/notion";
import { prisma } from "@/lib/prisma";
import { monthRange } from "@/lib/transactions";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { month } = (body ?? {}) as { month?: unknown };
  if (typeof month !== "string" || monthRange(month) === null) {
    return Response.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }

  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!databaseId) {
    return Response.json({ error: "NOTION_DATABASE_ID is not set" }, { status: 500 });
  }

  const [rows, storedInsights] = await Promise.all([
    prisma.transaction.findMany({
      where: { date: monthRange(month)! },
      select: { date: true, merchant: true, category: true, amount: true },
    }),
    // Reuse-only (CLAUDE.md §9): the report renders the stored insights
    // verbatim or omits the section; it never triggers generation.
    prisma.monthlyInsight.findUnique({ where: { month } }),
  ]);
  const analytics = computeAnalytics(
    rows.map((row) => ({ ...row, amount: Number(row.amount) })),
    { month }
  );
  const report = buildMonthlyReport(
    month,
    analytics,
    storedInsights === null ? null : (storedInsights.insights as string[])
  );

  try {
    const result = await syncMonthlyReport(createNotionApi(), databaseId, report);
    return Response.json({ ...result, report }, { status: 200 });
  } catch (error) {
    return Response.json({ error: `Notion sync failed: ${String(error)}` }, { status: 502 });
  }
}
