"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { CategoryPie } from "@/components/category-pie";
import { FilterBar, type Filters } from "@/components/filter-bar";
import { MetricCards } from "@/components/metric-cards";
import { RulePrompt } from "@/components/rule-prompt";
import { TransactionsTable } from "@/components/transactions-table";
import { UploadButton } from "@/components/upload-button";
import type { Analytics } from "@/lib/analytics";
import { CHART_COLORS } from "@/lib/format";
import type { TransactionJson } from "@/lib/transactions";

const EMPTY_FILTERS: Filters = { month: "", category: "", merchant: "" };

function query(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.month) params.set("month", filters.month);
  if (filters.category) params.set("category", filters.category);
  if (filters.merchant) params.set("merchant", filters.merchant);
  return params.toString();
}

export function Dashboard() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [transactions, setTransactions] = useState<TransactionJson[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [rulePrompt, setRulePrompt] = useState<{ merchant: string; category: string } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (activeFilters: Filters) => {
    try {
      const qs = query(activeFilters);
      const [txResponse, analyticsResponse] = await Promise.all([
        fetch(`/api/transactions?${qs}`),
        fetch(`/api/analytics?${qs}`),
      ]);
      if (!txResponse.ok || !analyticsResponse.ok) {
        throw new Error("failed to load data");
      }
      setTransactions((await txResponse.json()).transactions);
      setAnalytics(await analyticsResponse.json());
      setError(null);
    } catch (loadError) {
      setError(String(loadError));
    }
  }, []);

  useEffect(() => {
    // False positive: `load` is async — its setStates run after awaits, not
    // synchronously within the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(filters);
  }, [filters, load]);

  const categoryColors = useMemo(() => {
    const map = new Map<string, string>();
    analytics?.spendByCategory.forEach(({ category }, index) => {
      map.set(category, CHART_COLORS[index % CHART_COLORS.length]);
    });
    return map;
  }, [analytics]);

  const handleEdit = useCallback(
    async (id: string, field: string, value: unknown): Promise<boolean> => {
      const response = await fetch(`/api/transactions/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!response.ok) {
        setError((await response.json()).error ?? "update failed");
        return false;
      }
      const body = (await response.json()) as {
        transaction: TransactionJson;
        promptApplyToFuture: boolean;
      };
      setTransactions((current) =>
        current.map((t) => (t.id === id ? body.transaction : t))
      );
      setError(null);
      if (body.promptApplyToFuture) {
        setRulePrompt({
          merchant: body.transaction.merchant,
          category: body.transaction.category,
        });
      }
      // Metrics changed; refresh them in the background.
      void fetch(`/api/analytics?${query(filters)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((a) => a && setAnalytics(a));
      return true;
    },
    [filters]
  );

  const acceptRule = useCallback(async () => {
    if (!rulePrompt) return;
    const response = await fetch("/api/merchant-rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        merchantPattern: rulePrompt.merchant,
        category: rulePrompt.category,
      }),
    });
    // 409 means an identical-merchant rule already exists — nothing to surface.
    if (!response.ok && response.status !== 409) {
      setError((await response.json()).error ?? "could not create rule");
    }
    setRulePrompt(null);
  }, [rulePrompt]);

  const categories = useMemo(
    () => [...new Set(transactions.map((t) => t.category))].sort(),
    [transactions]
  );

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-700">
            Finance Intelligence
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-stone-900">
            Spending Insights
          </h1>
        </div>
        <UploadButton onUploaded={() => void load(filters)} />
      </header>

      {error && (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      <FilterBar filters={filters} categories={categories} onChange={setFilters} />

      {analytics && <MetricCards analytics={analytics} />}

      <div className="mt-6 grid gap-6 lg:grid-cols-[2fr_3fr]">
        {analytics && (
          <CategoryPie data={analytics.spendByCategory} colors={categoryColors} />
        )}
        <TransactionsTable
          transactions={transactions}
          categoryColors={categoryColors}
          onEdit={handleEdit}
        />
      </div>

      {rulePrompt && (
        <RulePrompt
          merchant={rulePrompt.merchant}
          category={rulePrompt.category}
          onAccept={() => void acceptRule()}
          onDecline={() => setRulePrompt(null)}
        />
      )}
    </main>
  );
}
