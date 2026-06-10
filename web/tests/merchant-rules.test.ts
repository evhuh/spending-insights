// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";

import { probeTestDb } from "./helpers/db";

const db = await probeTestDb("merchant-rules.test");

describe.skipIf(!db.available)("merchant rules API", () => {
  const client = db.client!;
  const pattern = `Rule-Test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  afterAll(async () => {
    await client.merchantRule.deleteMany({ where: { merchantPattern: pattern } });
    await client.$disconnect();
  });

  async function post(body: unknown) {
    const { POST } = await import("@/app/api/merchant-rules/route");
    return POST(
      new Request("http://test/api/merchant-rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  }

  it("creates a rule (the accept path) and lists it", async () => {
    const response = await post({ merchantPattern: pattern, category: "Dining" });
    expect(response.status).toBe(201);
    const { rule } = await response.json();
    expect(rule).toMatchObject({ merchantPattern: pattern, category: "Dining" });

    const { GET } = await import("@/app/api/merchant-rules/route");
    const list = await (await GET()).json();
    expect(
      list.rules.some(
        (r: { merchantPattern: string }) => r.merchantPattern === pattern
      )
    ).toBe(true);
  });

  it("409s on a duplicate pattern (UNIQUE)", async () => {
    const response = await post({ merchantPattern: pattern, category: "Shopping" });
    expect(response.status).toBe(409);

    // The original rule is untouched.
    const rule = await client.merchantRule.findUniqueOrThrow({
      where: { merchantPattern: pattern },
    });
    expect(rule.category).toBe("Dining");
  });

  it("400s on missing fields", async () => {
    expect((await post({ merchantPattern: pattern })).status).toBe(400);
    expect((await post({ category: "Dining" })).status).toBe(400);
    expect((await post({ merchantPattern: "  ", category: "Dining" })).status).toBe(400);
  });
});
