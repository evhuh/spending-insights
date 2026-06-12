"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import type { CategorySpend } from "@/lib/analytics";
import { formatUsd } from "@/lib/format";

export function CategoryPie({
  data,
  colorFor,
}: {
  data: CategorySpend[];
  colorFor: (category: string) => string;
}) {
  const total = data.reduce((sum, d) => sum + d.total, 0);

  return (
    <section
      aria-label="Spending by category"
      className="rounded-xl border border-cream-200 bg-white p-5 shadow-sm"
    >
      <h2 className="text-sm font-semibold text-stone-900">Spending by category</h2>
      {data.length === 0 ? (
        <p className="mt-4 text-sm text-stone-400">Nothing to chart yet.</p>
      ) : (
        <>
          <div className="mt-2 h-48" data-testid="category-pie-chart">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="total"
                  nameKey="category"
                  innerRadius="55%"
                  outerRadius="85%"
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {data.map((entry) => (
                    <Cell key={entry.category} fill={colorFor(entry.category)} />
                  ))}
                </Pie>
                <Tooltip
                  // Match the table/body text color instead of the slice color.
                  itemStyle={{ color: "#2a211c" }}
                  formatter={(value) => formatUsd(Number(value))}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-4 space-y-1.5 text-sm">
            {data.map((entry) => (
              <li key={entry.category} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: colorFor(entry.category) }}
                />
                <span className="flex-1 truncate text-stone-700">{entry.category}</span>
                <span className="tabular-nums font-medium text-stone-900">
                  {formatUsd(entry.total)}
                </span>
                <span className="w-12 text-right tabular-nums text-xs text-stone-400">
                  {total > 0 ? `${Math.round((entry.total / total) * 100)}%` : ""}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
