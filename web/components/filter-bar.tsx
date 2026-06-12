"use client";

export type Granularity = "month" | "year";

export interface Filters {
  granularity: Granularity;
  period: string; // YYYY-MM when granularity is "month", YYYY when "year"
  category: string;
  merchant: string;
}

/** Current period for a granularity — used as the default and on view switch. */
export function currentPeriod(granularity: Granularity): string {
  const now = new Date();
  return granularity === "year"
    ? String(now.getUTCFullYear())
    : now.toISOString().slice(0, 7);
}

const inputClass =
  "rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-800 " +
  "shadow-sm outline-none focus:border-blush-600 focus:ring-2 focus:ring-blush-600/20";

export function FilterBar({
  filters,
  categories,
  onChange,
}: {
  filters: Filters;
  categories: string[];
  onChange: (filters: Filters) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-4">
      <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
        View
        <select
          className={inputClass}
          value={filters.granularity}
          onChange={(e) => {
            const granularity = e.target.value as Granularity;
            // Always keep a concrete period — there is no all-time view.
            onChange({ ...filters, granularity, period: currentPeriod(granularity) });
          }}
        >
          <option value="month">Month</option>
          <option value="year">Year</option>
        </select>
      </label>

      {filters.granularity === "month" ? (
        <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
          Month
          <input
            type="month"
            className={inputClass}
            value={filters.period}
            onChange={(e) =>
              onChange({
                ...filters,
                period: e.target.value || currentPeriod("month"),
              })
            }
          />
        </label>
      ) : (
        <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
          Year
          <input
            type="number"
            min={2000}
            max={2100}
            step={1}
            className={`${inputClass} w-28`}
            value={filters.period}
            onChange={(e) =>
              onChange({
                ...filters,
                period: e.target.value || currentPeriod("year"),
              })
            }
          />
        </label>
      )}

      <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
        Category
        <select
          className={inputClass}
          value={filters.category}
          onChange={(e) => onChange({ ...filters, category: e.target.value })}
        >
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
        Merchant
        <input
          type="search"
          placeholder="Exact merchant name"
          className={inputClass}
          value={filters.merchant}
          onChange={(e) => onChange({ ...filters, merchant: e.target.value })}
        />
      </label>
      {(filters.category || filters.merchant) && (
        <button
          type="button"
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-blush-700 hover:bg-blush-100/40"
          onClick={() => onChange({ ...filters, category: "", merchant: "" })}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
