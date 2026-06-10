// Classification per CLAUDE.md §5: merchant rules first, AI fallback.

import type { ExtractedTransaction } from "@/lib/extractor-client";
import type { Categorizer } from "@/lib/openai";

export type AutoCategorySource = "rule" | "ai";

export interface ClassifiedTransaction extends ExtractedTransaction {
  category: string;
  categorySource: AutoCategorySource;
}

/** Build a lookup from merchant_rules rows; matching is case-insensitive. */
export function rulesToMap(
  rules: { merchantPattern: string; category: string }[]
): Map<string, string> {
  return new Map(rules.map((rule) => [rule.merchantPattern.toLowerCase(), rule.category]));
}

export async function classifyTransactions(
  transactions: ExtractedTransaction[],
  rules: Map<string, string>,
  categorizer: Categorizer
): Promise<ClassifiedTransaction[]> {
  const unmatched = [
    ...new Set(
      transactions
        .filter((t) => !rules.has(t.merchant.toLowerCase()))
        .map((t) => t.merchant)
    ),
  ];
  const aiCategories = await categorizer.categorizeMany(unmatched);

  return transactions.map((transaction) => {
    const ruleCategory = rules.get(transaction.merchant.toLowerCase());
    if (ruleCategory !== undefined) {
      return { ...transaction, category: ruleCategory, categorySource: "rule" as const };
    }
    return {
      ...transaction,
      category: aiCategories.get(transaction.merchant) ?? "Other",
      categorySource: "ai" as const,
    };
  });
}
