import type { TransactionJson } from "@/lib/transactions";

const SOURCE_META: Record<
  TransactionJson["categorySource"],
  { label: string; tooltip: string; className: string }
> = {
  rule: {
    label: "Rule",
    tooltip: "Categorized using a saved merchant rule.",
    className: "bg-cream-100 text-stone-500",
  },
  ai: {
    label: "AI",
    tooltip: "Categorized by AI because no merchant rule existed.",
    className: "bg-blush-100/60 text-blush-800",
  },
  manual: {
    label: "Manual",
    tooltip: "Manually edited by the user.",
    className: "bg-stone-100 text-stone-600",
  },
};

/** Small pill showing how a transaction's category was assigned. */
export function SourceBadge({ source }: { source: TransactionJson["categorySource"] }) {
  const meta = SOURCE_META[source];
  return (
    <span
      title={meta.tooltip}
      className={`inline-block shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium uppercase tracking-wide ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}
