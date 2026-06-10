import { classifyTransactions, rulesToMap } from "@/lib/classify";
import { extractStatement } from "@/lib/extractor-client";
import { createOpenAICategorizer } from "@/lib/openai";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request): Promise<Response> {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "missing 'file' upload" }, { status: 400 });
  }
  const yearField = formData.get("statementYear");
  const statementYear =
    typeof yearField === "string" && yearField !== "" ? Number(yearField) : undefined;

  // The PDF stays in memory and is forwarded as bytes — never persisted
  // (CLAUDE.md invariant 1).
  let extracted;
  try {
    extracted = await extractStatement(await file.arrayBuffer(), file.name, statementYear);
  } catch (error) {
    return Response.json(
      { error: `extraction failed: ${String(error)}` },
      { status: 502 }
    );
  }

  if (!extracted.statementPeriod.yearResolved) {
    return Response.json(
      {
        error:
          "statement year could not be resolved; re-upload with a statementYear field",
      },
      { status: 422 }
    );
  }

  const ruleRows = await prisma.merchantRule.findMany();
  const classified = await classifyTransactions(
    extracted.transactions,
    rulesToMap(ruleRows),
    createOpenAICategorizer()
  );

  const batch = await prisma.importBatch.create({
    data: { fileName: file.name, transactionCount: classified.length },
  });
  await prisma.transaction.createMany({
    data: classified.map((t) => ({
      date: new Date(t.date),
      merchant: t.merchant,
      amount: t.amount.toFixed(2),
      category: t.category,
      importBatchId: batch.id,
      categorySource: t.categorySource,
    })),
  });

  return Response.json(
    {
      importBatchId: batch.id,
      transactionCount: classified.length,
      statementPeriod: extracted.statementPeriod,
      validation: extracted.validation,
    },
    { status: 201 }
  );
}
