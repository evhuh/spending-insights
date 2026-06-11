const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatUsd(amount: number): string {
  return usd.format(amount);
}

export function formatDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Categorical palette shared by the pie chart and the table's category dots.
export const CHART_COLORS = [
  "#b35273", // rose
  "#d68a4e", // apricot
  "#9c6bb3", // mauve
  "#c0972f", // gold
  "#cf6a55", // terracotta
  "#7d9a6a", // sage
  "#5f8ea3", // dusty blue
  "#c97fa5", // pink
  "#8a6f5c", // mocha
  "#a8a29e", // stone
];
