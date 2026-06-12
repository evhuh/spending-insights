import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Dashboard } from "@/components/dashboard";
import type { TransactionJson } from "@/lib/transactions";

// recharts measures its container with ResizeObserver, which jsdom lacks.
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", FakeResizeObserver);

const TRANSACTIONS: TransactionJson[] = [
  {
    id: "t1",
    date: "2026-04-22",
    merchant: "Chick-fil-A",
    amount: 12.66,
    category: "Dining",
    notes: null,
    importBatchId: "b1",
    categorySource: "ai",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
];

const ANALYTICS = {
  totalSpend: 12.66,
  transactionCount: 1,
  averageDailySpend: 0.42,
  spendByCategory: [{ category: "Dining", total: 12.66 }],
  topMerchants: [{ merchant: "Chick-fil-A", total: 12.66, count: 1 }],
};

// Empty month: drives hasData=false on the card.
const ANALYTICS_EMPTY = {
  totalSpend: 0,
  transactionCount: 0,
  averageDailySpend: 0,
  spendByCategory: [],
  topMerchants: [],
};

// Per-test analytics payload returned by GET /api/analytics.
let analytics: typeof ANALYTICS | typeof ANALYTICS_EMPTY;

const GENERATED = ["Dining rose 14% month over month.", "HEB was the largest merchant.", "Spending concentrated mid-month."];

// What GET /api/insights returns, settable per test.
let storedInsights: { insights: string[] | null; generatedAt?: string; stale?: boolean };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchCalls: { url: string; method: string; body: unknown }[];

function installFetchMock() {
  fetchCalls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      fetchCalls.push({ url, method, body });

      if (method === "GET" && url.startsWith("/api/transactions")) {
        return jsonResponse({ transactions: TRANSACTIONS });
      }
      if (method === "GET" && url.startsWith("/api/analytics")) {
        return jsonResponse(analytics);
      }
      if (method === "GET" && url.startsWith("/api/insights")) {
        const month = new URL(url, "http://test").searchParams.get("month");
        return jsonResponse({ month, ...storedInsights });
      }
      if (method === "POST" && url === "/api/insights") {
        const month = (body as { month: string }).month;
        storedInsights = {
          insights: GENERATED,
          generatedAt: "2026-06-11T00:00:00.000Z",
          stale: false,
        };
        return jsonResponse({ month, ...storedInsights });
      }
      if (method === "PATCH" && url.startsWith("/api/transactions/")) {
        const patched = { ...TRANSACTIONS[0], ...(body as object) } as TransactionJson;
        return jsonResponse({ transaction: patched, promptApplyToFuture: false });
      }
      throw new Error(`unmocked fetch: ${method} ${url}`);
    })
  );
}

function insightsPosts() {
  return fetchCalls.filter((c) => c.method === "POST" && c.url === "/api/insights");
}

const CURRENT_MONTH = new Date().toISOString().slice(0, 7);

beforeEach(() => {
  window.localStorage.clear();
  storedInsights = { insights: null };
  analytics = ANALYTICS;
  installFetchMock();
});
afterEach(() => vi.unstubAllGlobals());

describe("InsightsCard", () => {
  it("never generates on mount: only GET /api/insights is called, for the current month", async () => {
    render(<Dashboard />);
    const card = screen.getByRole("region", { name: "Insights" });
    await within(card).findByText("No insights generated for this month yet.");

    const gets = fetchCalls.filter(
      (c) => c.method === "GET" && c.url.startsWith("/api/insights")
    );
    expect(gets.length).toBeGreaterThan(0);
    expect(gets[0].url).toBe(`/api/insights?month=${CURRENT_MONTH}`);
    expect(insightsPosts()).toHaveLength(0);
  });

  it("empty state: Generate Insights fires POST for the month and renders 3 bullets", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    const card = screen.getByRole("region", { name: "Insights" });

    await user.click(
      await within(card).findByRole("button", { name: "Generate Insights" })
    );

    expect(insightsPosts()).toHaveLength(1);
    expect(insightsPosts()[0].body).toEqual({ month: CURRENT_MONTH });

    const bullets = within(card).getAllByRole("listitem");
    expect(bullets.map((li) => li.textContent)).toEqual(GENERATED);
    expect(
      within(card).queryByText("data changed since these were generated")
    ).not.toBeInTheDocument();
  });

  it("fresh stored insights render as bullets with no Regenerate button and no POST", async () => {
    storedInsights = {
      insights: GENERATED,
      generatedAt: "2026-06-10T00:00:00.000Z",
      stale: false,
    };
    render(<Dashboard />);
    const card = screen.getByRole("region", { name: "Insights" });

    expect(await within(card).findAllByRole("listitem")).toHaveLength(3);
    expect(within(card).queryByRole("button")).not.toBeInTheDocument();
    expect(insightsPosts()).toHaveLength(0);
  });

  it("stale stored insights show the badge and an enabled Regenerate button that POSTs", async () => {
    const user = userEvent.setup();
    storedInsights = {
      insights: GENERATED,
      generatedAt: "2026-06-10T00:00:00.000Z",
      stale: true,
    };
    render(<Dashboard />);
    const card = screen.getByRole("region", { name: "Insights" });

    expect(
      await within(card).findByText("data changed since these were generated")
    ).toBeInTheDocument();
    const regenerate = within(card).getByRole("button", { name: "Regenerate" });
    expect(regenerate).toBeEnabled();

    await user.click(regenerate);
    expect(insightsPosts()).toHaveLength(1);
    // Regenerated set is fresh again: badge and button gone.
    expect(
      within(card).queryByText("data changed since these were generated")
    ).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Regenerate" })).not.toBeInTheDocument();
  });

  it("respects the dashboard month filter for both GET and POST", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    const card = screen.getByRole("region", { name: "Insights" });
    await within(card).findByText("No insights generated for this month yet.");

    fireEvent.change(screen.getByLabelText("Month"), { target: { value: "2026-04" } });

    await within(card).findByText("Insights — 2026-04");
    expect(
      fetchCalls.some(
        (c) => c.method === "GET" && c.url === "/api/insights?month=2026-04"
      )
    ).toBe(true);

    await user.click(
      await within(card).findByRole("button", { name: "Generate Insights" })
    );
    expect(insightsPosts()[0].body).toEqual({ month: "2026-04" });
  });

  it("blocks generation when the month has no spending", async () => {
    analytics = ANALYTICS_EMPTY;
    render(<Dashboard />);
    const card = screen.getByRole("region", { name: "Insights" });

    expect(
      await within(card).findByText("No transactions for this month — nothing to generate.")
    ).toBeInTheDocument();
    expect(
      within(card).queryByRole("button", { name: "Generate Insights" })
    ).not.toBeInTheDocument();
    expect(insightsPosts()).toHaveLength(0);
  });

  it("hides the insights card in Year view and never hits the insights API", async () => {
    render(<Dashboard />);
    await screen.findByText("No insights generated for this month yet.");
    const before = fetchCalls.length;

    fireEvent.change(screen.getByLabelText("View"), { target: { value: "year" } });

    const card = await screen.findByRole("region", { name: "Insights" });
    expect(card).toHaveTextContent("Insights are generated per month");
    // Analytics refetched with a year= param; no further insights calls.
    const after = fetchCalls.slice(before);
    expect(after.some((c) => c.url.includes("/api/analytics") && c.url.includes("year=")))
      .toBe(true);
    expect(after.some((c) => c.url.startsWith("/api/insights"))).toBe(false);
  });
});
