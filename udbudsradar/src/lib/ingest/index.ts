import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { ingestRuns, notices } from "@/db/schema";
import { env } from "@/lib/env";
import { errorToJson, log } from "@/lib/logger";
import { UdbudClient, type SearchWindow } from "@/lib/udbud/client";
import { coverageReport, normalizeNotice, type FieldResolution, type NormalizedNotice } from "@/lib/udbud/normalize";

export interface IngestResult {
  runId: string;
  noticesSeen: number;
  noticesNew: number;
  noticesUpdated: number;
  apiRequests: number;
  errors: IngestError[];
  window: { from: Date; to: Date };
  coverage: Record<string, { filled: number; total: number; paths: string[] }>;
}

export interface IngestError {
  stage: "fetch" | "normalize" | "persist";
  message: string;
  noticeId?: string;
  detail?: unknown;
}

interface UpsertOutcome {
  inserted: number;
  updated: number;
  unchanged: number;
}

/**
 * The window always reaches further back than the last successful run: an
 * overlap costs a few duplicate rows we discard, a gap costs a tender.
 */
export async function resolveWindow(db: Database, now: Date = new Date()): Promise<{ from: Date; to: Date }> {
  const config = env();
  const [lastOk] = await db
    .select({ finishedAt: ingestRuns.finishedAt })
    .from(ingestRuns)
    .where(and(eq(ingestRuns.status, "ok"), sql`${ingestRuns.finishedAt} is not null`))
    .orderBy(desc(ingestRuns.finishedAt))
    .limit(1);

  const from = lastOk?.finishedAt
    ? new Date(lastOk.finishedAt.getTime() - config.INGEST_OVERLAP_HOURS * 3_600_000)
    : new Date(now.getTime() - config.INGEST_INITIAL_LOOKBACK_DAYS * 86_400_000);

  return { from, to: now };
}

/**
 * Upsert on (notice_id, notice_version). A new version is a new row; the same
 * version with the same content only refreshes `last_seen_at`, which is what
 * makes a second run in a row produce nothing new (SPEC §4, CLAUDE.md rule 3).
 */
export async function upsertNotices(
  db: Database,
  batch: NormalizedNotice[],
  runId: string,
): Promise<UpsertOutcome> {
  if (batch.length === 0) return { inserted: 0, updated: 0, unchanged: 0 };

  const keys = batch.map((n) => `${n.noticeId}::${n.noticeVersion}`);
  const existing = await db
    .select({
      id: notices.id,
      noticeId: notices.noticeId,
      noticeVersion: notices.noticeVersion,
      contentHash: notices.contentHash,
    })
    .from(notices)
    .where(inArray(notices.noticeId, [...new Set(batch.map((n) => n.noticeId))]));

  const existingByKey = new Map<string, (typeof existing)[number]>(
    existing.map((row) => [`${row.noticeId}::${row.noticeVersion}`, row]),
  );

  const toInsert: NormalizedNotice[] = [];
  const toUpdate: NormalizedNotice[] = [];
  const unchangedIds: string[] = [];

  batch.forEach((notice, index) => {
    const key = keys[index]!;
    const current = existingByKey.get(key);
    if (!current) toInsert.push(notice);
    else if (current.contentHash !== notice.contentHash) toUpdate.push(notice);
    else unchangedIds.push(current.id);
  });

  const now = new Date();

  if (toInsert.length > 0) {
    await db
      .insert(notices)
      .values(
        toInsert.map((n) => ({
          noticeId: n.noticeId,
          noticeVersion: n.noticeVersion,
          noticeType: n.noticeType,
          title: n.title,
          description: n.description,
          buyerName: n.buyerName,
          buyerId: n.buyerId,
          buyerRegion: n.buyerRegion,
          cpvMain: n.cpvMain,
          cpvAll: n.cpvAll,
          valueAmount: n.valueAmount,
          valueCurrency: n.valueCurrency,
          publishedAt: n.publishedAt,
          deadlineAt: n.deadlineAt,
          procedureType: n.procedureType,
          sourceUrl: n.sourceUrl,
          raw: n.raw,
          contentHash: n.contentHash,
          firstSeenAt: now,
          lastSeenAt: now,
        })),
      )
      // A concurrent run may have inserted the same key between our read and
      // this write; treat that as "already seen" rather than crashing the run.
      .onConflictDoNothing({ target: [notices.noticeId, notices.noticeVersion] });
  }

  for (const n of toUpdate) {
    await db
      .update(notices)
      .set({
        noticeType: n.noticeType,
        title: n.title,
        description: n.description,
        buyerName: n.buyerName,
        buyerId: n.buyerId,
        buyerRegion: n.buyerRegion,
        cpvMain: n.cpvMain,
        cpvAll: n.cpvAll,
        valueAmount: n.valueAmount,
        valueCurrency: n.valueCurrency,
        publishedAt: n.publishedAt,
        deadlineAt: n.deadlineAt,
        procedureType: n.procedureType,
        sourceUrl: n.sourceUrl,
        raw: n.raw,
        contentHash: n.contentHash,
        lastSeenAt: now,
      })
      .where(and(eq(notices.noticeId, n.noticeId), eq(notices.noticeVersion, n.noticeVersion)));
  }

  if (unchangedIds.length > 0) {
    await db.update(notices).set({ lastSeenAt: now }).where(inArray(notices.id, unchangedIds));
  }

  log.info("ingest.upsert", {
    runId,
    inserted: toInsert.length,
    updated: toUpdate.length,
    unchanged: unchangedIds.length,
  });

  return { inserted: toInsert.length, updated: toUpdate.length, unchanged: unchangedIds.length };
}

export interface RunIngestOptions {
  client: UdbudClient;
  now?: Date;
  window?: SearchWindow;
  batchSize?: number;
}

/**
 * One ingest run, start to finish. Never throws for a single bad notice: the
 * failure lands in `ingest_runs.errors` and surfaces on /status (CLAUDE.md rule 4).
 */
export async function runIngest(db: Database, options: RunIngestOptions): Promise<IngestResult> {
  const now = options.now ?? new Date();
  const resolved = await resolveWindow(db, now);
  const window = {
    publishedFrom: options.window?.publishedFrom ?? resolved.from,
    publishedTo: options.window?.publishedTo ?? resolved.to,
  };

  const [run] = await db
    .insert(ingestRuns)
    .values({ startedAt: now, windowFrom: window.publishedFrom, windowTo: window.publishedTo, status: "kører" })
    .returning({ id: ingestRuns.id });
  const runId = run!.id;

  log.info("ingest.start", { runId, from: window.publishedFrom.toISOString(), to: window.publishedTo.toISOString() });

  const errors: IngestError[] = [];
  const resolutions: FieldResolution[] = [];
  const batchSize = options.batchSize ?? 100;
  let buffer: NormalizedNotice[] = [];
  let seen = 0;
  let inserted = 0;
  let updated = 0;

  const flush = async () => {
    if (buffer.length === 0) return;
    try {
      const outcome = await upsertNotices(db, buffer, runId);
      inserted += outcome.inserted;
      updated += outcome.updated;
    } catch (error) {
      errors.push({ stage: "persist", message: errorToJson(error).message, detail: errorToJson(error) });
      log.error("ingest.persist_failed", { runId, ...errorToJson(error) });
    }
    buffer = [];
  };

  try {
    for await (const item of options.client.iterateNotices(window)) {
      seen += 1;
      try {
        const { notice, resolution } = normalizeNotice(item, options.client.fieldMap);
        resolutions.push(resolution);
        buffer.push(notice);
        if (buffer.length >= batchSize) await flush();
      } catch (error) {
        const info = errorToJson(error);
        errors.push({ stage: "normalize", message: info.message, detail: info });
        log.error("ingest.normalize_failed", { runId, ...info });
      }
    }
    await flush();
  } catch (error) {
    await flush();
    const info = errorToJson(error);
    errors.push({ stage: "fetch", message: info.message, detail: info });
    log.error("ingest.fetch_failed", { runId, ...info });
  }

  const coverage = coverageReport(resolutions);
  const status = errors.some((e) => e.stage === "fetch") ? "fejlet" : "ok";

  await db
    .update(ingestRuns)
    .set({
      finishedAt: new Date(),
      noticesSeen: seen,
      noticesNew: inserted,
      noticesUpdated: updated,
      apiRequests: options.client.requestCount,
      errors: errors as unknown as object,
      status,
    })
    .where(eq(ingestRuns.id, runId));

  log.info("ingest.done", { runId, seen, inserted, updated, errors: errors.length, status });

  return {
    runId,
    noticesSeen: seen,
    noticesNew: inserted,
    noticesUpdated: updated,
    apiRequests: options.client.requestCount,
    errors,
    window: { from: window.publishedFrom, to: window.publishedTo },
    coverage,
  };
}
