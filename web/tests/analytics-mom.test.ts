// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  buildInsightsPayload,
  computeMomChanges,
  fingerprintAnalytics,
  type AnalyticsTransaction,
} from "@/lib/analytics";

function txn(date: string, merchant: string, category: string, amount: number): AnalyticsTransaction {
  return { date: new Date(date), merchant, category, amount };
}

// Two consecutive seeded months with hand-computed MoM changes:
//   Dining:  100.00 → 114.00  = +14%
//   Travel:  200.00 → 156.00  = -22%
//   Rent:    900.00 → 900.00  =  0%
//   Hobbies:  50.00 → (gone)  = -100%
//   Pets:    (new) → 40.00    = omitted (no prior baseline)
const MAY = [
  txn("2026-05-03", "Chick-fil-A", "Dining", 100.0),
  txn("2026-05-10", "Delta", "Travel", 200.0),
  txn("2026-05-01", "Landlord", "Rent", 900.0),
  txn("2026-05-12", "Yarn Shop", "Hobbies", 50.0),
];
const JUNE = [
  txn("2026-06-04", "Chick-fil-A", "Dining", 64.0),
  txn("2026-06-18", "Nice Day Chinese", "Dining", 50.0),
  txn("2026-06-09", "Delta", "Travel", 156.0),
  txn("2026-06-01", "Landlord", "Rent", 900.0),
  txn("2026-06-20", "Petco", "Pets", 40.0),
];

describe("computeMomChanges", () => {
  it("computes exact change percentages against seeded consecutive months", () => {
    expect(computeMomChanges(JUNE, MAY)).toEqual([
      { category: "Dining", changePct: 14 },
      { category: "Hobbies", changePct: -100 },
      { category: "Rent", changePct: 0 },
      { category: "Travel", changePct: -22 },
    ]);
  });

  it("omits categories with no prior-month baseline", () => {
    const categories = computeMomChanges(JUNE, MAY).map((c) => c.category);
    expect(categories).not.toContain("Pets");
  });

  it("returns empty momChanges when there is no prior month", () => {
    expect(computeMomChanges(JUNE, [])).toEqual([]);
  });

  it("rounds to whole percents using cent-exact sums", () => {
    // 10.00 → 10.15 = +1.5% → rounds to 2
    const prior = [txn("2026-05-01", "M", "Dining", 10.0)];
    const current = [txn("2026-06-01", "M", "Dining", 10.15)];
    expect(computeMomChanges(current, prior)).toEqual([
      { category: "Dining", changePct: 2 },
    ]);
  });
});

describe("buildInsightsPayload", () => {
  it("matches the canonical shape exactly", () => {
    expect(buildInsightsPayload("2026-06", JUNE, MAY)).toEqual({
      month: "2026-06",
      totalSpend: 1210.0,
      topCategories: [
        { category: "Rent", amount: 900.0 },
        { category: "Travel", amount: 156.0 },
        { category: "Dining", amount: 114.0 },
        { category: "Pets", amount: 40.0 },
      ],
      topMerchants: [
        { merchant: "Landlord", amount: 900.0 },
        { merchant: "Delta", amount: 156.0 },
        { merchant: "Chick-fil-A", amount: 64.0 },
        { merchant: "Nice Day Chinese", amount: 50.0 },
        { merchant: "Petco", amount: 40.0 },
      ],
      momChanges: [
        { category: "Dining", changePct: 14 },
        { category: "Hobbies", changePct: -100 },
        { category: "Rent", changePct: 0 },
        { category: "Travel", changePct: -22 },
      ],
    });
  });

  it("yields empty momChanges (no error) for a first month with no prior data", () => {
    const payload = buildInsightsPayload("2026-05", MAY, []);
    expect(payload.momChanges).toEqual([]);
    expect(payload.totalSpend).toBe(1250.0);
  });
});

describe("fingerprintAnalytics", () => {
  it("is stable across calls and across key order", () => {
    const a = fingerprintAnalytics(buildInsightsPayload("2026-06", JUNE, MAY));
    const b = fingerprintAnalytics(buildInsightsPayload("2026-06", JUNE, MAY));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);

    // Same data, different key insertion order → same canonical hash.
    const payload = buildInsightsPayload("2026-06", JUNE, MAY);
    const reordered = {
      momChanges: payload.momChanges,
      topMerchants: payload.topMerchants.map(({ amount, merchant }) => ({ amount, merchant })),
      topCategories: payload.topCategories,
      totalSpend: payload.totalSpend,
      month: payload.month,
    };
    expect(fingerprintAnalytics(reordered)).toBe(a);
  });

  it("changes when the underlying data changes", () => {
    const before = fingerprintAnalytics(buildInsightsPayload("2026-06", JUNE, MAY));

    // Simulate an inline edit: one June transaction's amount changes.
    const edited = JUNE.map((t) =>
      t.merchant === "Petco" ? { ...t, amount: 41.0 } : t
    );
    const after = fingerprintAnalytics(buildInsightsPayload("2026-06", edited, MAY));

    expect(after).not.toBe(before);
  });
});
