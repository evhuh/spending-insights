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
  {
    id: "t2",
    date: "2026-04-25",
    merchant: "Nice Day Chinese",
    amount: 28.41,
    category: "Dining",
    notes: "dumplings",
    importBatchId: "b1",
    categorySource: "rule",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
];

const ANALYTICS = {
  totalSpend: 41.07,
  transactionCount: 2,
  averageDailySpend: 1.37,
  spendByCategory: [{ category: "Dining", total: 41.07 }],
  topMerchants: [
    { merchant: "Nice Day Chinese", total: 28.41, count: 1 },
    { merchant: "Chick-fil-A", total: 12.66, count: 1 },
  ],
};

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
        return jsonResponse(ANALYTICS);
      }
      if (method === "PATCH" && url.startsWith("/api/transactions/")) {
        const id = url.split("/").pop();
        const existing = TRANSACTIONS.find((t) => t.id === id)!;
        const patched = { ...existing, ...(body as object) } as TransactionJson;
        return jsonResponse({
          transaction: patched,
          promptApplyToFuture: "category" in (body as object),
        });
      }
      if (method === "POST" && url === "/api/merchant-rules") {
        return jsonResponse({ rule: body }, 201);
      }
      if (method === "POST" && url === "/api/reports") {
        return jsonResponse({ action: "created", report: {} });
      }
      throw new Error(`unmocked fetch: ${method} ${url}`);
    })
  );
}

beforeEach(() => {
  window.localStorage.clear();
  installFetchMock();
});
afterEach(() => vi.unstubAllGlobals());

describe("Dashboard", () => {
  it("renders metrics, chart legend, and transaction rows from the APIs", async () => {
    render(<Dashboard />);

    // Summary card: total spend + top 3 merchants in one container
    await screen.findAllByText("$41.07");
    const summary = screen.getByRole("region", { name: "Summary" });
    expect(within(summary).getByText("Total Spend")).toBeInTheDocument();
    expect(within(summary).getByText("$41.07")).toBeInTheDocument();
    expect(within(summary).getByText("Nice Day Chinese")).toBeInTheDocument();

    // Pie chart card renders with its legend
    const chart = screen.getByRole("region", { name: "Spending by category" });
    expect(within(chart).getAllByText("Dining").length).toBeGreaterThan(0);
    expect(screen.getByTestId("category-pie-chart")).toBeInTheDocument();

    // Table rows
    const table = screen.getByRole("region", { name: "Transactions" });
    expect(within(table).getByText("Chick-fil-A")).toBeInTheDocument();
    expect(within(table).getByText("Nice Day Chinese")).toBeInTheDocument();
    expect(within(table).getByText("$12.66")).toBeInTheDocument();
    expect(within(table).getByText("dumplings")).toBeInTheDocument();
  });

  it("commits an inline notes edit via PATCH", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    await screen.findAllByText("Chick-fil-A");

    await user.click(screen.getByRole("button", { name: "Edit notes for Chick-fil-A" }));
    const input = screen.getByRole("textbox", { name: "notes for Chick-fil-A" });
    await user.type(input, "lunch{Enter}");

    const patch = fetchCalls.find((c) => c.method === "PATCH");
    expect(patch).toBeDefined();
    expect(patch!.url).toBe("/api/transactions/t1");
    expect(patch!.body).toEqual({ notes: "lunch" });

    // The updated value renders without a reload.
    expect(await screen.findByText("lunch")).toBeInTheDocument();
  });

  it("shows the apply-to-future prompt on a category edit and creates a rule on accept", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    await screen.findAllByText("Chick-fil-A");

    await user.click(
      screen.getByRole("button", { name: "Edit category for Chick-fil-A" })
    );
    const input = screen.getByRole("combobox", { name: "category for Chick-fil-A" });
    await user.clear(input);
    await user.type(input, "Shopping{Enter}");

    const dialog = await screen.findByRole("dialog", {
      name: "Apply category to future transactions",
    });
    expect(dialog).toHaveTextContent("Chick-fil-A");
    expect(dialog).toHaveTextContent("Shopping");

    await user.click(within(dialog).getByRole("button", { name: "Apply to future" }));

    const rulePost = fetchCalls.find(
      (c) => c.method === "POST" && c.url === "/api/merchant-rules"
    );
    expect(rulePost).toBeDefined();
    expect(rulePost!.body).toEqual({
      merchantPattern: "Chick-fil-A",
      category: "Shopping",
    });
  });

  it("declining the prompt creates no rule", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    await screen.findAllByText("Chick-fil-A");

    await user.click(
      screen.getByRole("button", { name: "Edit category for Chick-fil-A" })
    );
    await user.clear(screen.getByRole("combobox", { name: "category for Chick-fil-A" }));
    await user.type(
      screen.getByRole("combobox", { name: "category for Chick-fil-A" }),
      "Shopping{Enter}"
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Apply category to future transactions",
    });
    await user.click(within(dialog).getByRole("button", { name: "Just this once" }));

    expect(
      fetchCalls.some((c) => c.method === "POST" && c.url === "/api/merchant-rules")
    ).toBe(false);
    expect(
      screen.queryByRole("dialog", { name: "Apply category to future transactions" })
    ).not.toBeInTheDocument();
  });

  it("syncs a monthly report to Notion from the header control", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    await screen.findAllByText("Chick-fil-A");

    fireEvent.change(screen.getByLabelText("Report month"), {
      target: { value: "2026-04" },
    });
    await user.click(screen.getByRole("button", { name: "Sync to Notion" }));

    const post = fetchCalls.find((c) => c.method === "POST" && c.url === "/api/reports");
    expect(post).toBeDefined();
    expect(post!.body).toEqual({ month: "2026-04" });
    expect(await screen.findByText("Notion row created for 2026-04.")).toBeInTheDocument();
  });

  it("lists categories alphabetically with Other last", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    await screen.findAllByText("Chick-fil-A");

    await user.click(screen.getByRole("button", { name: "Edit category for Chick-fil-A" }));
    const listbox = screen.getByRole("listbox", { name: "Categories" });
    const optionNames = within(listbox)
      .getAllByRole("button")
      .map((b) => b.textContent)
      .filter((t): t is string => !!t && !t.startsWith("Edit color"));

    expect(optionNames).toEqual([
      "Dining",
      "Education",
      "Entertainment",
      "Groceries",
      "Health",
      "Rent",
      "Services",
      "Shopping",
      "Transport",
      "Travel",
      "Utilities",
      "Other",
    ]);
  });

  it("applies a category color only on Save", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    await screen.findAllByText("Chick-fil-A");

    await user.click(screen.getByRole("button", { name: "Edit category for Chick-fil-A" }));
    const listbox = screen.getByRole("listbox", { name: "Categories" });
    await user.click(within(listbox).getByRole("button", { name: "Edit color for Dining" }));

    fireEvent.change(screen.getByLabelText("Color value for Dining"), {
      target: { value: "#ff0000" },
    });
    // Sliding the picker alone must NOT persist anything.
    expect(window.localStorage.getItem("spending-insights.categoryColors")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(
      JSON.parse(window.localStorage.getItem("spending-insights.categoryColors")!)
    ).toMatchObject({ Dining: "#ff0000" });
    // The editor closed after saving.
    expect(screen.queryByLabelText("Color value for Dining")).not.toBeInTheDocument();
  });
});
