import { render, screen, within } from "@testing-library/react";
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
    notes: null,
    importBatchId: "b1",
    categorySource: "rule",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    id: "t3",
    date: "2026-04-28",
    merchant: "HEB",
    amount: 54.1,
    category: "Groceries",
    notes: null,
    importBatchId: "b1",
    categorySource: "manual",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
];

const ANALYTICS = {
  totalSpend: 95.17,
  transactionCount: 3,
  averageDailySpend: 3.17,
  spendByCategory: [
    { category: "Dining", total: 41.07 },
    { category: "Groceries", total: 54.1 },
  ],
  topMerchants: [{ merchant: "HEB", total: 54.1, count: 1 }],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetchMock() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as object) : undefined;

      if (method === "GET" && url.startsWith("/api/transactions")) {
        return jsonResponse({ transactions: TRANSACTIONS });
      }
      if (method === "GET" && url.startsWith("/api/analytics")) {
        return jsonResponse(ANALYTICS);
      }
      if (method === "PATCH" && url.startsWith("/api/transactions/")) {
        const id = url.split("/").pop();
        const existing = TRANSACTIONS.find((t) => t.id === id)!;
        // Mirrors the real PATCH route: a category change flips the source to
        // manual; nothing else touches category_source.
        const categoryChanged =
          body !== undefined && "category" in body && body.category !== existing.category;
        const patched = {
          ...existing,
          ...body,
          ...(categoryChanged ? { categorySource: "manual" as const } : {}),
        } as TransactionJson;
        return jsonResponse({ transaction: patched, promptApplyToFuture: categoryChanged });
      }
      throw new Error(`unmocked fetch: ${method} ${url}`);
    })
  );
}

function rowFor(merchant: string): HTMLElement {
  const table = screen.getByRole("region", { name: "Transactions" });
  const row = within(table).getByText(merchant).closest("tr");
  expect(row).not.toBeNull();
  return row!;
}

beforeEach(() => {
  window.localStorage.clear();
  installFetchMock();
});
afterEach(() => vi.unstubAllGlobals());

describe("category source badge", () => {
  it("renders the correct badge label and tooltip for each category_source", async () => {
    render(<Dashboard />);
    await screen.findAllByText("Chick-fil-A");

    const aiBadge = within(rowFor("Chick-fil-A")).getByText("AI");
    expect(aiBadge).toHaveAttribute(
      "title",
      "Categorized by AI because no merchant rule existed."
    );

    const ruleBadge = within(rowFor("Nice Day Chinese")).getByText("Rule");
    expect(ruleBadge).toHaveAttribute(
      "title",
      "Categorized using a saved merchant rule."
    );

    const manualBadge = within(rowFor("HEB")).getByText("Manual");
    expect(manualBadge).toHaveAttribute("title", "Manually edited by the user.");
  });

  it("flips the badge to Manual after an inline category edit", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    await screen.findAllByText("Chick-fil-A");

    expect(within(rowFor("Chick-fil-A")).getByText("AI")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit category for Chick-fil-A" }));
    const input = screen.getByRole("combobox", { name: "category for Chick-fil-A" });
    await user.clear(input);
    await user.type(input, "Shopping{Enter}");

    // The apply-to-future prompt appears (base-app behavior intact); decline it.
    const dialog = await screen.findByRole("dialog", {
      name: "Apply category to future transactions",
    });
    await user.click(within(dialog).getByRole("button", { name: "Just this once" }));

    const row = rowFor("Chick-fil-A");
    expect(within(row).getByText("Shopping")).toBeInTheDocument();
    expect(within(row).getByText("Manual")).toHaveAttribute(
      "title",
      "Manually edited by the user."
    );
    expect(within(row).queryByText("AI")).not.toBeInTheDocument();
  });

  it("a non-category edit does not change the badge", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    await screen.findAllByText("Chick-fil-A");

    await user.click(screen.getByRole("button", { name: "Edit notes for Chick-fil-A" }));
    const input = screen.getByRole("textbox", { name: "notes for Chick-fil-A" });
    await user.type(input, "lunch{Enter}");

    const row = rowFor("Chick-fil-A");
    expect(await within(row).findByText("lunch")).toBeInTheDocument();
    expect(within(row).getByText("AI")).toBeInTheDocument();
  });
});
