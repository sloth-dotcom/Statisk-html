import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb, truncateAll } from "./helpers/db";
import { ingestRuns, notices } from "../src/db/schema";
import { runIngest, resolveWindow } from "../src/lib/ingest";
import { UdbudClient } from "../src/lib/udbud/client";

let ctx: Awaited<ReturnType<typeof setupTestDb>>;

function payload(overrides: Record<string, unknown> = {}) {
  return {
    noticeId: "2026-000123",
    noticeVersion: "01",
    noticeType: "udbudsbekendtgoerelse",
    title: { dan: "Rammeaftale om it-drift" },
    description: { dan: "Drift og support af arbejdspladser." },
    buyer: { name: "Aarhus Kommune", cvr: "55133018", region: "Region Midtjylland" },
    cpvMain: "72200000-7",
    value: { amount: "1000000", currency: "DKK" },
    publicationDate: "2026-08-14T09:00:00+02:00",
    tenderPeriod: { endDate: "2026-09-30" },
    ...overrides,
  };
}

function clientReturning(items: unknown[]): UdbudClient {
  let served = false;
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
    const body = served ? { items: [] } : { items };
    served = true;
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  });
  return new UdbudClient({
    baseUrl: "https://api.example.test",
    pageSize: 100,
    fetchImpl,
    sleepImpl: async () => {},
  });
}

beforeAll(async () => {
  ctx = await setupTestDb();
});

afterAll(async () => {
  await ctx.client.end();
});

beforeEach(async () => {
  await truncateAll(ctx.db);
});

describe("runIngest", () => {
  it("stores the raw payload alongside the mapped columns", async () => {
    const result = await runIngest(ctx.db, { client: clientReturning([payload()]) });

    expect(result.noticesNew).toBe(1);
    const [row] = await ctx.db.select().from(notices);
    expect(row!.title).toBe("Rammeaftale om it-drift");
    expect(row!.valueAmount).toBe("1000000");
    expect(row!.cpvMain).toBe("72200000");
    expect(row!.raw).toMatchObject({ noticeId: "2026-000123" });
    expect(row!.sourceUrl).toContain("noticeId=2026-000123");
  });

  it("is idempotent: a second run adds no rows and reports nothing new", async () => {
    await runIngest(ctx.db, { client: clientReturning([payload()]) });
    const second = await runIngest(ctx.db, { client: clientReturning([payload()]) });

    expect(second.noticesNew).toBe(0);
    expect(second.noticesUpdated).toBe(0);
    expect(await ctx.db.select().from(notices)).toHaveLength(1);
  });

  it("treats a new version as a new row, not an overwrite", async () => {
    await runIngest(ctx.db, { client: clientReturning([payload()]) });
    await runIngest(ctx.db, {
      client: clientReturning([payload({ noticeVersion: "02", title: { dan: "Rammeaftale om it-drift (rettet)" } })]),
    });

    const rows = await ctx.db.select().from(notices).orderBy(notices.noticeVersion);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.title).toBe("Rammeaftale om it-drift");
    expect(rows[1]!.title).toBe("Rammeaftale om it-drift (rettet)");
  });

  it("updates in place when the same version is republished with changed content", async () => {
    await runIngest(ctx.db, { client: clientReturning([payload()]) });
    const second = await runIngest(ctx.db, {
      client: clientReturning([payload({ title: { dan: "Ny titel" } })]),
    });

    expect(second.noticesUpdated).toBe(1);
    const rows = await ctx.db.select().from(notices);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("Ny titel");
  });

  it("keeps going when one notice is unusable, and records the error", async () => {
    const result = await runIngest(ctx.db, {
      client: clientReturning([{ title: "uden id" }, payload()]),
    });

    expect(result.noticesSeen).toBe(2);
    expect(result.noticesNew).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.stage).toBe("normalize");

    const [run] = await ctx.db.select().from(ingestRuns).where(eq(ingestRuns.id, result.runId));
    expect(run!.status).toBe("ok");
    expect(Array.isArray(run!.errors)).toBe(true);
    expect(run!.errors as unknown[]).toHaveLength(1);
  });

  it("marks the run as failed when the API itself breaks", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => new Response("nope", { status: 500 }));
    const client = new UdbudClient({
      baseUrl: "https://api.example.test",
      fetchImpl,
      sleepImpl: async () => {},
      maxRetries: 1,
    });

    const result = await runIngest(ctx.db, { client });

    expect(result.errors[0]!.stage).toBe("fetch");
    const [run] = await ctx.db.select().from(ingestRuns).where(eq(ingestRuns.id, result.runId));
    expect(run!.status).toBe("fejlet");
  });

  it("reports field coverage so a wrong mapping is visible instead of silent", async () => {
    const result = await runIngest(ctx.db, { client: clientReturning([payload({ procedureType: undefined })]) });
    expect(result.coverage.title).toMatchObject({ filled: 1, total: 1 });
    expect(result.coverage.procedureType?.filled).toBe(0);
  });
});

describe("resolveWindow", () => {
  it("looks back the configured lookback when nothing has run yet", async () => {
    const now = new Date("2026-08-18T12:00:00Z");
    const window = await resolveWindow(ctx.db, now);
    const days = (now.getTime() - window.from.getTime()) / 86_400_000;
    expect(days).toBeCloseTo(30, 5);
  });

  it("overlaps the previous successful run by 24 hours", async () => {
    const finished = new Date("2026-08-18T10:00:00Z");
    await ctx.db.insert(ingestRuns).values({ startedAt: finished, finishedAt: finished, status: "ok" });

    const window = await resolveWindow(ctx.db, new Date("2026-08-18T12:00:00Z"));
    expect(window.from.toISOString()).toBe("2026-08-17T10:00:00.000Z");
  });

  it("ignores failed runs when choosing the window", async () => {
    const ok = new Date("2026-08-17T10:00:00Z");
    const failed = new Date("2026-08-18T10:00:00Z");
    await ctx.db.insert(ingestRuns).values({ startedAt: ok, finishedAt: ok, status: "ok" });
    await ctx.db.insert(ingestRuns).values({ startedAt: failed, finishedAt: failed, status: "fejlet" });

    const window = await resolveWindow(ctx.db, new Date("2026-08-18T12:00:00Z"));
    expect(window.from.toISOString()).toBe("2026-08-16T10:00:00.000Z");
  });
});
