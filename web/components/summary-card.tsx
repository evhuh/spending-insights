"use client";

import type { Analytics } from "@/lib/analytics";
import { formatUsd } from "@/lib/format";

/** Compact summary strip: total spend + top 3 merchants in one container. */
export function SummaryCard({ analytics }: { analytics: Analytics }) {
  return (
    <section
      aria-label="Summary"
      className="flex flex-wrap items-center gap-x-12 gap-y-4 rounded-2xl border border-cream-200 bg-white px-6 py-4 shadow-sm"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-stone-500">
          Total Spend
        </p>
        <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-stone-900">
          {formatUsd(analytics.totalSpend)}
        </p>
      </div>
      <div className="w-full max-w-xs">
        <p className="text-xs font-semibold uppercase tracking-wider text-stone-500">
          Top Merchants
        </p>
        <ol className="mt-1 space-y-0.5 text-sm">
          {analytics.topMerchants.slice(0, 3).map((m) => (
            <li key={m.merchant} className="flex justify-between gap-6">
              <span className="truncate text-stone-700">{m.merchant}</span>
              <span className="tabular-nums font-medium text-stone-900">
                {formatUsd(m.total)}
              </span>
            </li>
          ))}
          {analytics.topMerchants.length === 0 && (
            <li className="text-stone-400">No spending yet</li>
          )}
        </ol>
      </div>
    </section>
  );
}
