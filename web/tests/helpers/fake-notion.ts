// In-memory NotionApi double: stores pages per database so upsert behavior
// (find → create vs. update) can be asserted across calls.
import type { NotionApi, NotionBlock, NotionProperties } from "@/lib/notion";

interface FakePage {
  id: string;
  month: string;
  properties: NotionProperties;
  blocks: NotionBlock[];
}

export class FakeNotion implements NotionApi {
  pages: FakePage[] = [];
  deletedBlockIds: string[] = [];
  private nextId = 1;

  private page(pageId: string): FakePage {
    const page = this.pages.find((p) => p.id === pageId);
    if (!page) throw new Error(`no such page ${pageId}`);
    return page;
  }

  async findPageByMonth(_databaseId: string, month: string): Promise<string | null> {
    return this.pages.find((p) => p.month === month)?.id ?? null;
  }

  async createPage(
    _databaseId: string,
    properties: NotionProperties,
    children: NotionBlock[]
  ): Promise<string> {
    const id = `page-${this.nextId++}`;
    const month = (
      properties.Month as { title: { text: { content: string } }[] }
    ).title[0].text.content;
    this.pages.push({ id, month, properties, blocks: [...children] });
    return id;
  }

  async updatePageProperties(pageId: string, properties: NotionProperties): Promise<void> {
    this.page(pageId).properties = properties;
  }

  async listChildBlockIds(pageId: string): Promise<string[]> {
    return this.page(pageId).blocks.map((_, index) => `${pageId}-block-${index}`);
  }

  async deleteBlock(blockId: string): Promise<void> {
    this.deletedBlockIds.push(blockId);
    const [pageId] = blockId.split("-block-");
    // Each delete removes one block from the page.
    this.page(pageId).blocks.pop();
  }

  async appendChildBlocks(pageId: string, children: NotionBlock[]): Promise<void> {
    this.page(pageId).blocks.push(...children);
  }
}
