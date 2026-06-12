"use client";

import { useEffect, useState } from "react";

interface InsightsResponse {
  month: string;
  insights: string[] | null;
  generatedAt?: string;
  stale?: boolean;
}

/**
 * Monthly AI insights card. Read-only on mount and month change (GET only);
 * generation happens ONLY via the Generate/Regenerate button (CLAUDE.md §9).
 * `refreshKey` lets the dashboard re-read staleness after an edit — still GET.
 */
export function InsightsCard({
  month,
  hasData = true,
  refreshKey = 0,
}: {
  month: string;
  // When the selected month has no spending, generation is blocked.
  hasData?: boolean;
  refreshKey?: number;
}) {
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    fetch(`/api/insights?month=${month}`)
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error("failed to load insights"))
      )
      .then((body: InsightsResponse) => {
        if (!cancelled) {
          setData(body);
          setError(null);
        }
      })
      .catch((loadError) => {
        if (!cancelled) setError(String(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [month, refreshKey]);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const response = await fetch("/api/insights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ month }),
      });
      if (!response.ok) {
        throw new Error((await response.json()).error ?? "generation failed");
      }
      setData(await response.json());
    } catch (generateError) {
      setError(String(generateError));
    } finally {
      setGenerating(false);
    }
  };

  const button = (label: string) => (
    <button
      type="button"
      disabled={generating || !hasData}
      className="rounded-lg bg-blush-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blush-800 disabled:opacity-50"
      onClick={() => void generate()}
    >
      {generating ? "Generating…" : label}
    </button>
  );

  return (
    <section
      aria-label="Insights"
      className="rounded-xl border border-cream-200 bg-white px-6 py-4 shadow-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-stone-500">
          Insights — {month}
        </p>
        {data?.insights && data.stale && (
          <span className="rounded-full bg-cream-100 px-2 py-0.5 text-[11px] text-stone-500">
            data changed since these were generated
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {data === null && !error && <p className="mt-2 text-sm text-stone-400">Loading…</p>}

      {data?.insights === null && (
        <div className="mt-2 flex flex-col items-start gap-2">
          {hasData ? (
            <>
              <p className="text-sm text-stone-400">
                No insights generated for this month yet.
              </p>
              {button("Generate Insights")}
            </>
          ) : (
            <p className="text-sm text-stone-400">
              No transactions for this month — nothing to generate.
            </p>
          )}
        </div>
      )}

      {data?.insights && (
        <>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-700">
            {data.insights.map((insight) => (
              <li key={insight}>{insight}</li>
            ))}
          </ul>
          {data.stale && <div className="mt-3">{button("Regenerate")}</div>}
        </>
      )}
    </section>
  );
}
