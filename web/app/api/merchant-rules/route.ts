import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export async function GET(): Promise<Response> {
  const rules = await prisma.merchantRule.findMany({ orderBy: { createdAt: "desc" } });
  return Response.json({ rules });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { merchantPattern, category } = (body ?? {}) as {
    merchantPattern?: unknown;
    category?: unknown;
  };
  if (typeof merchantPattern !== "string" || merchantPattern.trim() === "") {
    return Response.json(
      { error: "merchantPattern must be a non-empty string" },
      { status: 400 }
    );
  }
  if (typeof category !== "string" || category.trim() === "") {
    return Response.json({ error: "category must be a non-empty string" }, { status: 400 });
  }

  try {
    const rule = await prisma.merchantRule.create({
      data: { merchantPattern: merchantPattern.trim(), category: category.trim() },
    });
    return Response.json({ rule }, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return Response.json(
        { error: "a rule for this merchant pattern already exists" },
        { status: 409 }
      );
    }
    throw error;
  }
}
