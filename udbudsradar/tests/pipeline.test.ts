import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb, truncateAll } from "./helpers/db";
import { digestItems, digestRuns, noticeScores, noticeStatus, notices, profiles, type Notice, type Profile } from "../src/db/schema";
import { runIngest } from "../src/lib/ingest";
import { runScoring, rescoreProfile } from "../src/lib/scoring";
import { UdbudClient } from "../src/lib/udbud/client";
import type { ScoringModel, ScoringOutcome } from "../src/lib/scoring/model";

const sent: Array<{ channel: string; subject?: string; text: string }> = [];

vi.mock("../src/lib/notify/channels", () => ({
  sendEmail: vi.fn(async (subject: string, _html: string, text: string) => {
    sent.push({ channel: "mail", subject, text });
    return { channel: "mail" as const, sent: true };
  }),
  sendSlack: vi.fn(async (text: string) => {
    sent.push({ channel: "slack", text });
    return { channel: "slack" as const, sent: true };
  }),
}));

const { runDigest, selectDigestEntries, renderDigest } = await import("../src/lib/notify/digest");
const { notifyIngestFailure } = await import("../src/lib/notify/alerts");

let ctx: Awaited<ReturnType<typeof setupTestDb>>;

/** Scores deterministically so the pipeline can be tested without an API key. */
class FakeModel implements ScoringModel {
  readonly name = "fake-model";
  calls = 0;
  batches: number[] = [];

  constructor(private readonly scoreFor: (notice: Notice) => number = () => 80) {}

  async score(_profile: Profile, batch: Notice[]): Promise<ScoringOutcome> {
    this.calls += 1;
    this.batches.push(batch.length);
    return {
      model: this.name,
      inputTokens: 100 * batch.length,
      outputTokens: 20 * batch.length,
      verdicts: batch.map((notice, index) => ({
        nr: index,
        score: this.scoreFor(notice),
        reasoning: `Vurdering af ${notice.title}`,
        fit: "mulig" as const,
        concerns: [],
      })),
    };
  }
}

function payload(id: string, overrides: Record<string, unknown> = {}) {
  return {
    noticeId: id,
    noticeVersion: "01",
    noticeType: "udbudsbekendtgoerelse",
    title: { dan: `Rammeaftale ${id}` },
    description: { dan: "Drift og support af arbejdspladser i kommunen." },
    buyer: { name: "Aarhus Kommune", cvr: "55133018", region: "Region Midtjylland" },
    cpvMain: "72200000-7",
    value: { amount: "1000000", currency: "DKK" },
    publicationDate: new Date(Date.now() - 86_400_000).toISOString(),
    tenderPeriod: { endDate: new Date(Date.now() + 30 * 86_400_000).toISOString() },
    ...overrides,
  };
}

function clientReturning(items: unknown[]): UdbudClient {
  let served = false;
  return new UdbudClient({
    baseUrl: "https://api.example.test",
    pageSize: 100,
    sleepImpl: async () => {},
    fetchImpl: vi.fn<typeof fetch>().mockImplementation(async () => {
      const body = served ? { items: [] } : { items };
      served = true;
      return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    }),
  });
}

async function seedProfile(overrides: Partial<typeof profiles.$inferInsert> = {}) {
  const [profile] = await ctx.db
    .insert(profiles)
    .values({
      name: "IT-drift",
      description: "Vi laver drift og support af it-arbejdspladser for kommuner.",
      cpvCodes: ["72000000"],
      keywords: ["drift", "support"],
      minScoreForDigest: 60,
      ...overrides,
    })
    .returning();
  return profile!;
}

beforeAll(async () => {
  ctx = await setupTestDb();
});

afterAll(async () => {
  await ctx.client.end();
});

beforeEach(async () => {
  await truncateAll(ctx.db);
  sent.length = 0;
});

describe("runScoring", () => {
  it("scores only what survived layers 1-3", async () => {
    await seedProfile();
    await runIngest(ctx.db, {
      client: clientReturning([
        payload("a"),
        payload("b", { cpvMain: "45000000-7", title: { dan: "Anlæg af cykelsti" }, description: { dan: "Asfaltarbejde." } }),
      ]),
    });

    const model = new FakeModel();
    const result = await runScoring(ctx.db, { model });

    expect(result.candidates).toBe(1);
    expect(result.scored).toBe(1);
    const rows = await ctx.db.select().from(noticeScores);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.matchedKeywords).toEqual(["drift", "support"]);
    expect(rows[0]!.model).toBe("fake-model");
  });

  it("never pays to score the same notice twice", async () => {
    await seedProfile();
    await runIngest(ctx.db, { client: clientReturning([payload("a")]) });

    const model = new FakeModel();
    await runScoring(ctx.db, { model });
    const second = await runScoring(ctx.db, { model });

    expect(second.candidates).toBe(0);
    expect(model.calls).toBe(1);
    expect(await ctx.db.select().from(noticeScores)).toHaveLength(1);
  });

  it("records token spend on the run", async () => {
    await seedProfile();
    await runIngest(ctx.db, { client: clientReturning([payload("a"), payload("b")]) });

    const result = await runScoring(ctx.db, { model: new FakeModel(), batchSize: 5 });
    expect(result.inputTokens).toBe(200);
    expect(result.outputTokens).toBe(40);
  });

  it("re-scores after an explicit rescore trigger", async () => {
    const profile = await seedProfile();
    await runIngest(ctx.db, { client: clientReturning([payload("a")]) });

    const model = new FakeModel();
    await runScoring(ctx.db, { model });
    await rescoreProfile(ctx.db, profile.id, 30, { model });

    expect(model.calls).toBe(2);
    expect(await ctx.db.select().from(noticeScores)).toHaveLength(1);
  });

  it("keeps going when the model fails on one batch", async () => {
    await seedProfile();
    await runIngest(ctx.db, { client: clientReturning([payload("a"), payload("b")]) });

    const failing: ScoringModel = {
      name: "fejlende",
      score: vi.fn(async () => {
        throw new Error("429 fra Anthropic");
      }),
    };
    const result = await runScoring(ctx.db, { model: failing, batchSize: 1 });

    expect(result.scored).toBe(0);
    expect(result.errors).toHaveLength(2);
  });
});

describe("digest", () => {
  it("selects only notices over the profile threshold", async () => {
    await seedProfile({ minScoreForDigest: 70 });
    await runIngest(ctx.db, { client: clientReturning([payload("a"), payload("b")]) });

    const [first, second] = await ctx.db.select().from(notices).orderBy(notices.noticeId);
    await runScoring(ctx.db, { model: new FakeModel((n) => (n.id === first!.id ? 90 : 40)) });

    const entries = await selectDigestEntries(ctx.db, 15);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.noticeRowId).toBe(first!.id);
    expect(second).toBeDefined();
  });

  it("skips notices a human has rejected", async () => {
    await seedProfile();
    await runIngest(ctx.db, { client: clientReturning([payload("a")]) });
    await runScoring(ctx.db, { model: new FakeModel() });
    await ctx.db.insert(noticeStatus).values({ noticeId: "a", status: "afvist" });

    expect(await selectDigestEntries(ctx.db, 15)).toHaveLength(0);
  });

  it("sends each notice exactly once", async () => {
    await seedProfile();
    await runIngest(ctx.db, { client: clientReturning([payload("a"), payload("b")]) });
    await runScoring(ctx.db, { model: new FakeModel() });

    const first = await runDigest(ctx.db);
    expect(first.kind).toBe("daglig");
    expect(first.entries).toBe(2);
    expect(first.delivered).toBe(true);

    const second = await runDigest(ctx.db);
    expect(second.kind).toBe("ingen");
    expect(second.entries).toBe(0);

    expect(await ctx.db.select().from(digestItems)).toHaveLength(2);
    expect(sent.filter((s) => s.channel === "mail")).toHaveLength(1);
  });

  it("sends a weekly nothing-new message so silence is not mistaken for a crash", async () => {
    await seedProfile();
    const result = await runDigest(ctx.db);

    expect(result.kind).toBe("ugentlig_intet_nyt");
    expect(result.delivered).toBe(true);
    expect(sent.some((s) => s.text.includes("ingen nye relevante udbud"))).toBe(true);
  });

  it("does not repeat the weekly message the next day", async () => {
    await seedProfile();
    await runDigest(ctx.db);
    sent.length = 0;

    const second = await runDigest(ctx.db);
    expect(second.kind).toBe("ingen");
    expect(sent).toHaveLength(0);
  });

  it("renders profile groups, scores and deep links", () => {
    const rendered = renderDigest(
      [
        {
          noticeRowId: "row-1",
          noticeId: "2026-1",
          profileId: "p1",
          profileName: "IT-drift",
          title: "Rammeaftale om drift",
          buyerName: "Aarhus Kommune",
          score: 88,
          reasoning: "Rammer vores kerneområde.",
          deadlineAt: new Date("2026-09-30T10:00:00Z"),
          valueAmount: "1000000",
          valueCurrency: "DKK",
        },
      ],
      "https://udbudsradar.example.dk",
    );

    expect(rendered.subject).toContain("1 nye relevante udbud");
    expect(rendered.html).toContain("IT-drift");
    expect(rendered.html).toContain("https://udbudsradar.example.dk/udbud/2026-1");
    expect(rendered.text).toContain("[88]");
  });
});

describe("alarm", () => {
  it("fires after two failed ingest runs and only once per streak", async () => {
    const failingClient = () =>
      new UdbudClient({
        baseUrl: "https://api.example.test",
        maxRetries: 0,
        sleepImpl: async () => {},
        fetchImpl: vi.fn<typeof fetch>().mockImplementation(async () => new Response("nej", { status: 500 })),
      });

    await runIngest(ctx.db, { client: failingClient() });
    expect(await notifyIngestFailure(ctx.db)).toBe(false);

    await runIngest(ctx.db, { client: failingClient() });
    expect(await notifyIngestFailure(ctx.db)).toBe(true);
    expect(await notifyIngestFailure(ctx.db)).toBe(false);

    const alarms = await ctx.db.select().from(digestRuns).where(eq(digestRuns.kind, "alarm"));
    expect(alarms).toHaveLength(1);
  });
});

describe("ende-til-ende", () => {
  it("seeds three notices, ingests, scores, sends one digest and nothing the second time", async () => {
    await seedProfile();

    const ingest = await runIngest(ctx.db, {
      client: clientReturning([payload("e1"), payload("e2"), payload("e3")]),
    });
    expect(ingest.noticesNew).toBe(3);

    const scoring = await runScoring(ctx.db, { model: new FakeModel(), batchSize: 2 });
    expect(scoring.scored).toBe(3);

    const digest = await runDigest(ctx.db);
    expect(digest.entries).toBe(3);
    expect(sent.filter((s) => s.channel === "mail")).toHaveLength(1);

    const rerunIngest = await runIngest(ctx.db, {
      client: clientReturning([payload("e1"), payload("e2"), payload("e3")]),
    });
    expect(rerunIngest.noticesNew).toBe(0);

    const rerunScoring = await runScoring(ctx.db, { model: new FakeModel() });
    expect(rerunScoring.scored).toBe(0);

    sent.length = 0;
    const rerunDigest = await runDigest(ctx.db);
    expect(rerunDigest.entries).toBe(0);
    expect(sent).toHaveLength(0);
  });
});
