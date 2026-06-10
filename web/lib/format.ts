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
  "#0f766e",
  "#b45309",
  "#6d28d9",
  "#be185d",
  "#1d4ed8",
  "#4d7c0f",
  "#c2410c",
  "#0e7490",
  "#9333ea",
  "#57534e",
];
