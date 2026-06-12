"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { CategoryPie } from "@/components/category-pie";
import { FilterBar, currentPeriod, type Filters } from "@/components/filter-bar";
import { InsightsCard } from "@/components/insights-card";
import { ReportSync } from "@/components/report-sync";
import { SummaryCard } from "@/components/summary-card";
import { RulePrompt } from "@/components/rule-prompt";
import { TransactionsTable } from "@/components/transactions-table";
import { UploadButton } from "@/components/upload-button";
import type { Analytics } from "@/lib/analytics";
import { useCategoryColors } from "@/lib/category-colors";
import { sortCategoriesOtherLast } from "@/lib/openai";
import type { TransactionJson } from "@/lib/transactions";

// Default to the current month — there is no all-time view.
const DEFAULT_FILTERS: Filters = {
  granularity: "month",
  period: currentPeriod("month"),
  category: "",
  merchant: "",
};

function query(filters: Filters): string {
  const params = new URLSearchParams();
  const period = filters.period || currentPeriod(filters.granularity);
  params.set(filters.granularity === "year" ? "year" : "month", period);
  if (filters.category) params.set("category", filters.category);
  if (filters.merchant) params.set("merchant", filters.merchant);
  return params.toString();
}

export function Dashboard() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [transactions, setTransactions] = useState<TransactionJson[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [rulePrompt, setRulePrompt] = useState<{ merchant: string; category: string } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  // Bumped after edits so the insights card re-reads staleness (GET only).
  const [insightsRefresh, setInsightsRefresh] = useState(0);

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

  const { colorFor, setColor } = useCategoryColors();

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
      setInsightsRefresh((n) => n + 1);
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
    () => sortCategoriesOtherLast(transactions.map((t) => t.category)),
    [transactions]
  );

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-stone-900">
            spending insights
          </h1>
        </div>
        <div className="flex flex-col items-end gap-3">
          <UploadButton onUploaded={() => void load(filters)} />
          <ReportSync />
        </div>
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

      <div className="grid items-stretch gap-4 lg:grid-cols-[1fr_1.2fr]">
        {analytics && <SummaryCard analytics={analytics} />}
        {filters.granularity === "month" ? (
          <InsightsCard
            month={filters.period || currentPeriod("month")}
            // Generation is blocked when the month has no spending.
            hasData={(analytics?.transactionCount ?? 0) > 0}
            refreshKey={insightsRefresh}
          />
        ) : (
          <section
            aria-label="Insights"
            className="flex items-center rounded-xl border border-cream-200 bg-white px-6 py-4 text-sm text-stone-400 shadow-sm"
          >
            Insights are generated per month — switch the view to Month to use them.
          </section>
        )}
      </div>

      <div className="mt-5 grid items-stretch gap-6 lg:grid-cols-[2fr_3fr]">
        {analytics && (
          <CategoryPie data={analytics.spendByCategory} colorFor={colorFor} />
        )}
        <TransactionsTable
          transactions={transactions}
          colorFor={colorFor}
          onSetColor={setColor}
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
