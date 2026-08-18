import { desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { digestRuns, ingestRuns, noticeScores, notices, scoringRuns } from "@/db/schema";

export async function lastIngestRun() {
  const [row] = await getDb().select().from(ingestRuns).orderBy(desc(ingestRuns.startedAt)).limit(1);
  return row ?? null;
}

export async function recentIngestRuns(limit = 20) {
  return getDb().select().from(ingestRuns).orderBy(desc(ingestRuns.startedAt)).limit(limit);
}

export async function recentScoringRuns(limit = 10) {
  return getDb().select().from(scoringRuns).orderBy(desc(scoringRuns.startedAt)).limit(limit);
}

export async function recentDigestRuns(limit = 10) {
  return getDb().select().from(digestRuns).orderBy(desc(digestRuns.startedAt)).limit(limit);
}

export async function noticeCounts() {
  const db = getDb();
  const [total] = await db.select({ value: sql<number>`count(*)::int` }).from(notices);
  const [open] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(notices)
    .where(sql`${notices.deadlineAt} is null or ${notices.deadlineAt} >= now()`);
  const [scored] = await db.select({ value: sql<number>`count(*)::int` }).from(noticeScores);
  return { total: total?.value ?? 0, open: open?.value ?? 0, scored: scored?.value ?? 0 };
}

/** Token spend, so the monthly AI bill is a number on a page and not a surprise. */
export async function tokenUsage(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);
  const [row] = await getDb()
    .select({
      input: sql<number>`coalesce(sum(${scoringRuns.inputTokens}), 0)::int`,
      output: sql<number>`coalesce(sum(${scoringRuns.outputTokens}), 0)::int`,
      runs: sql<number>`count(*)::int`,
    })
    .from(scoringRuns)
    .where(gte(scoringRuns.startedAt, since));
  return { days, input: row?.input ?? 0, output: row?.output ?? 0, runs: row?.runs ?? 0 };
}

/** True when the last two runs both failed — the same rule the alarm uses. */
export async function ingestIsDown(): Promise<boolean> {
  const runs = await getDb()
    .select({ status: ingestRuns.status })
    .from(ingestRuns)
    .orderBy(desc(ingestRuns.startedAt))
    .limit(2);
  return runs.length === 2 && runs.every((r) => r.status === "fejlet");
}

export async function lastSuccessfulIngest() {
  const [row] = await getDb()
    .select()
    .from(ingestRuns)
    .where(eq(ingestRuns.status, "ok"))
    .orderBy(desc(ingestRuns.startedAt))
    .limit(1);
  return row ?? null;
}
