"use client";

import type { Analytics } from "@/lib/analytics";
import { formatUsd } from "@/lib/format";

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-stone-500">{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

const big = "text-2xl font-semibold tabular-nums tracking-tight text-stone-900";

export function MetricCards({ analytics }: { analytics: Analytics }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card label="Total Spend">
        <p className={big}>{formatUsd(analytics.totalSpend)}</p>
      </Card>
      <Card label="Transactions">
        <p className={big}>{analytics.transactionCount}</p>
      </Card>
      <Card label="Average Daily Spend">
        <p className={big}>{formatUsd(analytics.averageDailySpend)}</p>
      </Card>
      <Card label="Top Merchants">
        <ol className="space-y-1 text-sm">
          {analytics.topMerchants.map((m) => (
            <li key={m.merchant} className="flex justify-between gap-3">
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
      </Card>
    </div>
  );
}
