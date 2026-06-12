// Mockable OpenAI wrapper for merchant categorization.
// Tests inject a fake Categorizer / OpenAI client; the real client is created
// lazily so no module ever requires OPENAI_API_KEY at import time.

import OpenAI from "openai";

export const CATEGORIES = [
  "Dining",
  "Groceries",
  "Shopping",
  "Transport",
  "Travel",
  "Entertainment",
  "Health",
  "Services",
  "Education",
  "Utilities",
  "Rent",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Alphabetical, with "Other" pinned last (kept only if present). */
export function sortCategoriesOtherLast(categories: Iterable<string>): string[] {
  const unique = [...new Set(categories)];
  return unique
    .filter((category) => category !== "Other")
    .sort((a, b) => a.localeCompare(b))
    .concat(unique.includes("Other") ? ["Other"] : []);
}

export interface Categorizer {
  /** Returns a category for each input merchant, keyed by merchant name. */
  categorizeMany(merchants: string[]): Promise<Map<string, string>>;
}

const SYSTEM_PROMPT = `You categorize credit-card merchants into spending categories.
For each merchant in the user's JSON array, pick exactly one category from:
${CATEGORIES.join(", ")}.
Respond with JSON: {"categories": {"<merchant>": "<category>", ...}} containing
every input merchant.`;

/** LLM boundary for monthly insights. Receives ONLY the aggregated analytics
 * payload (CLAUDE.md §9) and returns the raw parsed JSON; validation and
 * retry live in lib/insights.ts so they're testable with this mocked. */
export interface InsightsGenerator {
  generate(payload: unknown): Promise<unknown>;
}

// Constrained prompt from the feature plan — keep verbatim.
const INSIGHTS_PROMPT = `Generate 3 concise spending observations for the month. Focus on:
- notable category changes
- largest merchants
- unusual spending concentrations
- month-over-month trends
Keep insights factual, neutral, and under 20 words each.
Return JSON: { "insights": ["...", "...", "..."] }`;

export function createOpenAIInsightsGenerator(
  client?: OpenAI,
  model: string = process.env.OPENAI_MODEL ?? "gpt-4o-mini"
): InsightsGenerator {
  return {
    async generate(payload: unknown): Promise<unknown> {
      const openai = client ?? new OpenAI();
      const completion = await openai.chat.completions.create({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: INSIGHTS_PROMPT },
          { role: "user", content: JSON.stringify(payload) },
        ],
      });
      return JSON.parse(completion.choices[0]?.message?.content ?? "{}");
    },
  };
}

export function createOpenAICategorizer(
  client?: OpenAI,
  model: string = process.env.OPENAI_MODEL ?? "gpt-4o-mini"
): Categorizer {
  return {
    async categorizeMany(merchants: string[]): Promise<Map<string, string>> {
      if (merchants.length === 0) {
        return new Map();
      }
      const openai = client ?? new OpenAI();
      const completion = await openai.chat.completions.create({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(merchants) },
        ],
      });
      const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as {
        categories?: Record<string, string>;
      };
      const result = new Map<string, string>();
      for (const merchant of merchants) {
        const category = parsed.categories?.[merchant];
        result.set(
          merchant,
          category && (CATEGORIES as readonly string[]).includes(category)
            ? category
            : "Other"
        );
      }
      return result;
    },
  };
}
