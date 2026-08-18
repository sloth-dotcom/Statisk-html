import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, truncateAll, TEST_DATABASE_URL } from "./helpers/db";
import { noticeStatus, profiles } from "../src/db/schema";
import { runIngest } from "../src/lib/ingest";
import { UdbudClient } from "../src/lib/udbud/client";
import { runScoring } from "../src/lib/scoring";
import type { ScoringModel } from "../src/lib/scoring/model";
import { parseRadarParams } from "../src/lib/radar/params";

process.env.DATABASE_URL = TEST_DATABASE_URL;
const { listRadar } = await import("../src/lib/radar/query");

let ctx: Awaited<ReturnType<typeof setupTestDb>>;

function payload(id: string, title: string, cpv: string, days: number, description?: string) {
  return {
    noticeId: id,
    noticeVersion: "01",
    noticeType: "udbudsbekendtgoerelse",
    title: { dan: title },
    description: { dan: description ?? `${title}. Opgaven omfatter drift og support.` },
    buyer: { name: "Aarhus Kommune", region: "Region Midtjylland" },
    cpvMain: cpv,
    value: { amount: "1000000", currency: "DKK" },
    publicationDate: new Date(Date.now() - 86_400_000).toISOString(),
    tenderPeriod: { endDate: new Date(Date.now() + days * 86_400_000).toISOString() },
  };
}

async function ingest(items: unknown[]) {
  let served = false;
  const client = new UdbudClient({
    baseUrl: "https://api.example.test",
    sleepImpl: async () => {},
    fetchImpl: vi.fn<typeof fetch>().mockImplementation(async () => {
      const body = served ? { items: [] } : { items };
      served = true;
      return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    }),
  });
  return runIngest(ctx.db, { client });
}

const scorer = (byTitle: Record<string, number>): ScoringModel => ({
  name: "fake",
  score: async (_profile, batch) => ({
    model: "fake",
    inputTokens: 10,
    outputTokens: 2,
    verdicts: batch.map((notice, index) => ({
      nr: index,
      score: byTitle[notice.title ?? ""] ?? 50,
      reasoning: `Begrundelse for ${notice.title}`,
      fit: "mulig" as const,
      concerns: [],
    })),
  }),
});

beforeAll(async () => {
  ctx = await setupTestDb();
});

afterAll(async () => {
  await ctx.client.end();
});

beforeEach(async () => {
  await truncateAll(ctx.db);
});

describe("listRadar", () => {
  it("shows the AI score even when no profile is selected", async () => {
    await ctx.db.insert(profiles).values({
      name: "IT",
      description: "It-drift",
      cpvCodes: ["72000000"],
      keywords: ["drift"],
    });
    await ingest([payload("a", "Drift af arbejdspladser", "72200000-7", 20)]);
    await runScoring(ctx.db, { model: scorer({ "Drift af arbejdspladser": 88 }) });

    const { rows, total } = await listRadar({});
    expect(total).toBe(1);
    expect(rows[0]!.score).toBe(88);
    expect(rows[0]!.reasoning).toContain("Begrundelse");
  });

  it("sorts scored notices above unscored ones", async () => {
    await ctx.db.insert(profiles).values({ name: "IT", description: "It-drift", cpvCodes: ["72000000"], keywords: ["drift"] });
    await ingest([
      payload("a", "Drift af arbejdspladser", "72200000-7", 20),
      payload("b", "Anlæg af cykelsti", "45233162-2", 30, "Asfaltarbejde og afmærkning langs Ringvejen."),
    ]);
    await runScoring(ctx.db, { model: scorer({ "Drift af arbejdspladser": 88 }) });

    const { rows } = await listRadar({});
    // The cycle path matches neither CPV nor keywords, so layer 1-3 never sent
    // it to the AI — it stays unscored and sorts last.
    expect(rows[0]!.score).toBe(88);
    expect(rows[1]!.score).toBeNull();
  });

  it("filters on minimum score", async () => {
    await ctx.db.insert(profiles).values({ name: "IT", description: "It-drift", cpvCodes: ["72000000"], keywords: ["drift"] });
    await ingest([payload("a", "Drift af arbejdspladser", "72200000-7", 20)]);
    await runScoring(ctx.db, { model: scorer({ "Drift af arbejdspladser": 40 }) });

    expect((await listRadar({ minScore: 60 })).total).toBe(0);
    expect((await listRadar({ minScore: 30 })).total).toBe(1);
  });

  it("finds notices with danish full-text search", async () => {
    await ingest([payload("a", "Rengøring af skoler", "90910000-9", 20), payload("b", "Drift af servere", "72200000-7", 20)]);

    const hit = await listRadar({ query: "rengøring" });
    expect(hit.rows.map((r) => r.noticeId)).toEqual(["a"]);
  });

  it("hides rejected notices by default and shows them on demand", async () => {
    await ingest([payload("a", "Drift af arbejdspladser", "72200000-7", 20)]);
    await ctx.db.insert(noticeStatus).values({ noticeId: "a", status: "afvist" });

    expect((await listRadar({})).total).toBe(0);
    expect((await listRadar({ visning: "afviste" })).total).toBe(1);
    expect((await listRadar({ visning: "alle" })).total).toBe(1);
  });

  it("hides notices whose deadline has passed unless asked for", async () => {
    await ingest([payload("a", "Drift af arbejdspladser", "72200000-7", -3)]);

    expect((await listRadar({})).total).toBe(0);
    expect((await listRadar({ includeExpired: true })).total).toBe(1);
  });

  it("filters on region and buyer", async () => {
    await ingest([payload("a", "Drift af arbejdspladser", "72200000-7", 20)]);

    expect((await listRadar({ region: "Midtjylland" })).total).toBe(1);
    expect((await listRadar({ region: "Hovedstaden" })).total).toBe(0);
    expect((await listRadar({ buyer: "aarhus" })).total).toBe(1);
  });
});

describe("parseRadarParams", () => {
  it("reads the filters back out of a shared URL", () => {
    const filters = parseRadarParams({
      profil: "p1",
      minScore: "60",
      region: "Region Midtjylland",
      ordregiver: "Aarhus",
      q: "drift",
      fra: "2026-08-01",
      visning: "alle",
      udloebne: "1",
      side: "2",
    });

    expect(filters).toMatchObject({
      profileId: "p1",
      minScore: 60,
      region: "Region Midtjylland",
      buyer: "Aarhus",
      query: "drift",
      visning: "alle",
      includeExpired: true,
      page: 2,
    });
    expect(filters.from?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("defaults to hiding rejected notices and page one", () => {
    expect(parseRadarParams({})).toMatchObject({ visning: "aabne", page: 1, includeExpired: false });
  });

  it("ignores junk instead of throwing", () => {
    expect(parseRadarParams({ minScore: "abc", fra: "ikke-en-dato" })).toMatchObject({
      minScore: undefined,
      from: undefined,
    });
  });
});
