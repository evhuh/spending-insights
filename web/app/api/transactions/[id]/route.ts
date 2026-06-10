import { prisma } from "@/lib/prisma";
import { serializeTransaction, validateEdit } from "@/lib/transactions";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const validation = validateEdit(body);
  if (!validation.ok) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  const existing = await prisma.transaction.findUnique({ where: { id } });
  if (existing === null) {
    return Response.json({ error: "transaction not found" }, { status: 404 });
  }

  const data = { ...validation.data };
  const categoryChanged =
    validation.categoryProvided && data.category !== existing.category;
  if (categoryChanged) {
    // A manual category edit flips the source (CLAUDE.md §5); this is the only
    // way category_source changes through this API.
    data.categorySource = "manual";
  }

  const updated = await prisma.transaction.update({ where: { id }, data });

  return Response.json({
    transaction: serializeTransaction(updated),
    // Signals the dashboard to ask: "apply this category to future transactions
    // from this merchant?" — accept calls POST /api/merchant-rules.
    promptApplyToFuture: categoryChanged,
  });
}
