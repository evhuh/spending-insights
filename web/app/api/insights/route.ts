// Insights API (CLAUDE.md §9): POST is the only path that generates (the
// Generate/Regenerate button); GET only reads stored rows — never the LLM.

import {
  generateInsights,
  getInsights,
  InsightsGenerationError,
  InsightsNoDataError,
} from "@/lib/insights";
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

  try {
    return Response.json(await generateInsights(month));
  } catch (error) {
    if (error instanceof InsightsNoDataError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    if (error instanceof InsightsGenerationError) {
      return Response.json({ error: error.message }, { status: 502 });
    }
    throw error;
  }
}

export async function GET(request: Request): Promise<Response> {
  const month = new URL(request.url).searchParams.get("month");
  if (month === null || monthRange(month) === null) {
    return Response.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }

  const stored = await getInsights(month);
  if (stored === null) {
    // Empty state: nothing generated for this month yet.
    return Response.json({ month, insights: null });
  }
  return Response.json(stored);
}
