// Monthly report → Notion sync.
//
// The Notion HTTP surface sits behind the `NotionApi` interface so tests inject
// a fake. The real implementation talks to Notion's REST API directly with a
// pinned Notion-Version header (no SDK churn).

import type { Analytics, CategorySpend, MerchantSpend } from "@/lib/analytics";
import { formatUsd } from "@/lib/format";

export const TOP_LIST_LIMIT = 5;

export interface MonthlyReport {
  month: string; // YYYY-MM
  totalSpend: number;
  transactionCount: number;
  averageDailySpend: number;
  topCategories: CategorySpend[];
  topMerchants: MerchantSpend[];
  // Stored insights, reused verbatim (CLAUDE.md §9). null → the report OMITS
  // the Insights section; the sync never generates them.
  insights: string[] | null;
}

export function buildMonthlyReport(
  month: string,
  analytics: Analytics,
  insights: string[] | null = null
): MonthlyReport {
  return {
    month,
    totalSpend: analytics.totalSpend,
    transactionCount: analytics.transactionCount,
    averageDailySpend: analytics.averageDailySpend,
    topCategories: analytics.spendByCategory.slice(0, TOP_LIST_LIMIT),
    topMerchants: analytics.topMerchants.slice(0, TOP_LIST_LIMIT),
    insights,
  };
}

// --- Notion payloads (the agreed property schema; see MANUAL_SETUP.md §3) ---

export type NotionProperties = Record<string, unknown>;
export type NotionBlock = Record<string, unknown>;

export function reportProperties(report: MonthlyReport): NotionProperties {
  return {
    Month: { title: [{ text: { content: report.month } }] },
    "Total Spend": { number: report.totalSpend },
    "Transaction Count": { number: report.transactionCount },
    "Average Daily Spend": { number: report.averageDailySpend },
  };
}

function heading(text: string): NotionBlock {
  return {
    object: "block",
    type: "heading_2",
    heading_2: { rich_text: [{ text: { content: text } }] },
  };
}

function bullet(text: string): NotionBlock {
  return {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: { rich_text: [{ text: { content: text } }] },
  };
}

/** Top Categories / Top Merchants live in the page BODY, not in properties. */
export function reportBodyBlocks(report: MonthlyReport): NotionBlock[] {
  return [
    heading("Top Categories"),
    ...report.topCategories.map((c) => bullet(`${c.category} — ${formatUsd(c.total)}`)),
    heading("Top Merchants"),
    ...report.topMerchants.map((m) =>
      bullet(`${m.merchant} — ${formatUsd(m.total)} (${m.count}×)`)
    ),
    // Insights go after Top Merchants; omitted entirely when none are stored.
    ...(report.insights !== null && report.insights.length > 0
      ? [heading("Insights"), ...report.insights.map(bullet)]
      : []),
  ];
}

// --- The mockable boundary ---

export interface NotionApi {
  findPageByMonth(databaseId: string, month: string): Promise<string | null>;
  createPage(
    databaseId: string,
    properties: NotionProperties,
    children: NotionBlock[]
  ): Promise<string>;
  updatePageProperties(pageId: string, properties: NotionProperties): Promise<void>;
  listChildBlockIds(pageId: string): Promise<string[]>;
  deleteBlock(blockId: string): Promise<void>;
  appendChildBlocks(pageId: string, children: NotionBlock[]): Promise<void>;
}

export interface SyncResult {
  action: "created" | "updated";
  pageId: string;
}

/** Upsert: one Notion row per month. Re-running updates instead of duplicating. */
export async function syncMonthlyReport(
  api: NotionApi,
  databaseId: string,
  report: MonthlyReport
): Promise<SyncResult> {
  const properties = reportProperties(report);
  const blocks = reportBodyBlocks(report);

  const existingPageId = await api.findPageByMonth(databaseId, report.month);
  if (existingPageId === null) {
    const pageId = await api.createPage(databaseId, properties, blocks);
    return { action: "created", pageId };
  }

  await api.updatePageProperties(existingPageId, properties);
  // Replace the body: clear old blocks, then append the fresh ones.
  for (const blockId of await api.listChildBlockIds(existingPageId)) {
    await api.deleteBlock(blockId);
  }
  await api.appendChildBlocks(existingPageId, blocks);
  return { action: "updated", pageId: existingPageId };
}

// --- Real implementation (exercised only in the user's live smoke test) ---

const NOTION_VERSION = "2022-06-28";

export function createNotionApi(
  apiKey: string | undefined = process.env.NOTION_API_KEY
): NotionApi {
  async function call(method: string, path: string, body?: unknown): Promise<unknown> {
    if (!apiKey) {
      throw new Error("NOTION_API_KEY is not set");
    }
    const response = await fetch(`https://api.notion.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Notion-Version": NOTION_VERSION,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Notion ${method} ${path} failed (${response.status}): ${await response.text()}`);
    }
    return response.json();
  }

  // Users often paste a PAGE id (the page containing the database) instead of
  // the database's own id. Resolve it once: if the configured id isn't a
  // database, look for a child database inside it.
  let resolvedDatabaseId: string | null = null;
  async function resolveDatabaseId(configuredId: string): Promise<string> {
    if (resolvedDatabaseId !== null) return resolvedDatabaseId;
    try {
      await call("GET", `/databases/${configuredId}`);
      resolvedDatabaseId = configuredId;
    } catch {
      const children = (await call(
        "GET",
        `/blocks/${configuredId}/children?page_size=100`
      )) as { results: { id: string; type: string }[] };
      const childDatabase = children.results.find((b) => b.type === "child_database");
      if (!childDatabase) {
        throw new Error(
          `NOTION_DATABASE_ID (${configuredId}) is not a database and contains ` +
            "no database — open the database as a full page and copy the 32-char " +
            "id from ITS url"
        );
      }
      resolvedDatabaseId = childDatabase.id;
    }
    return resolvedDatabaseId;
  }

  return {
    async findPageByMonth(databaseId, month) {
      const data = (await call(
        "POST",
        `/databases/${await resolveDatabaseId(databaseId)}/query`,
        {
          filter: { property: "Month", title: { equals: month } },
          page_size: 1,
        }
      )) as { results: { id: string }[] };
      return data.results[0]?.id ?? null;
    },
    async createPage(databaseId, properties, children) {
      const data = (await call("POST", "/pages", {
        parent: { database_id: await resolveDatabaseId(databaseId) },
        properties,
        children,
      })) as { id: string };
      return data.id;
    },
    async updatePageProperties(pageId, properties) {
      await call("PATCH", `/pages/${pageId}`, { properties });
    },
    async listChildBlockIds(pageId) {
      const data = (await call("GET", `/blocks/${pageId}/children?page_size=100`)) as {
        results: { id: string }[];
      };
      return data.results.map((block) => block.id);
    },
    async deleteBlock(blockId) {
      await call("DELETE", `/blocks/${blockId}`);
    },
    async appendChildBlocks(pageId, children) {
      await call("PATCH", `/blocks/${pageId}/children`, { children });
    },
  };
}
