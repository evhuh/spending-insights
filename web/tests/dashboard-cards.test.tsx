import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Dashboard } from "@/components/dashboard";

// recharts measures its container with ResizeObserver, which jsdom lacks.
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", FakeResizeObserver);

const ANALYTICS = {
  totalSpend: 41.07,
  transactionCount: 2,
  averageDailySpend: 1.37,
  spendByCategory: [{ category: "Dining", total: 41.07 }],
  topMerchants: [{ merchant: "Nice Day Chinese", total: 41.07, count: 2 }],
};

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "GET" && url.startsWith("/api/transactions")) {
        return jsonResponse({ transactions: [] });
      }
      if (method === "GET" && url.startsWith("/api/analytics")) {
        return jsonResponse(ANALYTICS);
      }
      if (method === "GET" && url.startsWith("/api/insights")) {
        const month = new URL(url, "http://test").searchParams.get("month");
        return jsonResponse({ month, insights: null });
      }
      throw new Error(`unmocked fetch: ${method} ${url}`);
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("dashboard top metric row", () => {
  it("keeps Total Spend and Top Merchants, adds Insights, and drops the removed cards", async () => {
    render(<Dashboard />);
    await screen.findAllByText("$41.07");

    const summary = screen.getByRole("region", { name: "Summary" });
    expect(within(summary).getByText("Total Spend")).toBeInTheDocument();
    expect(within(summary).getByText("Top Merchants")).toBeInTheDocument();

    // The Insights card sits in the top row.
    expect(screen.getByRole("region", { name: "Insights" })).toBeInTheDocument();

    // Removed metric cards: the labels appear nowhere in the summary row.
    expect(within(summary).queryByText("Transactions")).not.toBeInTheDocument();
    expect(screen.queryByText("Average Daily Spend")).not.toBeInTheDocument();
    expect(screen.queryByText("Transaction Count")).not.toBeInTheDocument();
  });
});
