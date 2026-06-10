"use client";

export interface Filters {
  month: string;
  category: string;
  merchant: string;
}

const inputClass =
  "rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-800 " +
  "shadow-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20";

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
    <div className="mb-6 flex flex-wrap items-end gap-4">
      <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
        Month
        <input
          type="month"
          className={inputClass}
          value={filters.month}
          onChange={(e) => onChange({ ...filters, month: e.target.value })}
        />
      </label>
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
      {(filters.month || filters.category || filters.merchant) && (
        <button
          type="button"
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-teal-700 hover:bg-teal-50"
          onClick={() => onChange({ month: "", category: "", merchant: "" })}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
