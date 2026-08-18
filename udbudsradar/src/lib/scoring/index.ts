import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { noticeScores, notices, profiles, scoringRuns, type Notice, type Profile } from "@/db/schema";
import { env } from "@/lib/env";
import { errorToJson, log } from "@/lib/logger";
import { evaluateNotice, isScoringCandidate, type RelevanceVerdict } from "@/lib/relevance/evaluate";
import { AnthropicScoringModel, type ScoringModel } from "./model";

export interface ScoreOptions {
  model?: ScoringModel;
  /** Only score for this profile. Default: every active profile. */
  profileId?: string;
  /** How far back to look for unscored notices. Default 30 days. */
  since?: Date;
  maxNotices?: number;
  batchSize?: number;
  now?: Date;
}

export interface ScoreResult {
  runId: string;
  candidates: number;
  scored: number;
  inputTokens: number;
  outputTokens: number;
  errors: Array<{ message: string; profileId?: string }>;
}

/**
 * Notices this profile has not been scored on at its current version. The
 * unique index on (notice, profile, profile_version) is what actually enforces
 * "score only once" (CLAUDE.md rule 8) — this query just avoids paying for the
 * attempt.
 */
async function unscoredNotices(db: Database, profile: Profile, since: Date, limit: number): Promise<Notice[]> {
  return db
    .select()
    .from(notices)
    .leftJoin(
      noticeScores,
      and(
        eq(noticeScores.noticeId, notices.id),
        eq(noticeScores.profileId, profile.id),
        eq(noticeScores.profileVersion, profile.version),
      ),
    )
    .where(
      and(
        isNull(noticeScores.id),
        gte(notices.publishedAt, since),
        or(isNull(notices.deadlineAt), gte(notices.deadlineAt, sql`now()`)),
      ),
    )
    .orderBy(desc(notices.publishedAt))
    .limit(limit)
    .then((rows) => rows.map((row) => row.notices));
}

/**
 * Layer 4 (SPEC §5). Only what survived layers 1-3 is sent, results are cached,
 * and token spend is written to scoring_runs so the monthly cost is visible.
 */
export async function runScoring(db: Database, options: ScoreOptions = {}): Promise<ScoreResult> {
  const config = env();
  const now = options.now ?? new Date();
  const since = options.since ?? new Date(now.getTime() - 30 * 86_400_000);
  const maxNotices = options.maxNotices ?? config.SCORING_MAX_NOTICES_PER_RUN;
  const batchSize = options.batchSize ?? config.SCORING_BATCH_SIZE;
  const model = options.model ?? new AnthropicScoringModel();

  const [run] = await db
    .insert(scoringRuns)
    .values({ startedAt: now, model: model.name, status: "kører" })
    .returning({ id: scoringRuns.id });
  const runId = run!.id;

  const targets = await db
    .select()
    .from(profiles)
    .where(options.profileId ? eq(profiles.id, options.profileId) : eq(profiles.active, true));

  const errors: ScoreResult["errors"] = [];
  let candidates = 0;
  let scored = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const profile of targets) {
    let pool: Notice[];
    try {
      pool = await unscoredNotices(db, profile, since, maxNotices * 4);
    } catch (error) {
      const info = errorToJson(error);
      errors.push({ message: info.message, profileId: profile.id });
      log.error("scoring.candidates_failed", { runId, profileId: profile.id, ...info });
      continue;
    }

    const eligible: Array<{ notice: Notice; verdict: RelevanceVerdict }> = [];
    for (const notice of pool) {
      const verdict = evaluateNotice(notice, profile, now);
      if (isScoringCandidate(verdict)) eligible.push({ notice, verdict });
      if (eligible.length >= maxNotices) break;
    }

    candidates += eligible.length;
    log.info("scoring.profile_candidates", {
      runId,
      profileId: profile.id,
      pool: pool.length,
      candidates: eligible.length,
    });

    for (let start = 0; start < eligible.length; start += batchSize) {
      const batch = eligible.slice(start, start + batchSize);
      try {
        const outcome = await model.score(
          profile,
          batch.map((entry) => entry.notice),
        );
        inputTokens += outcome.inputTokens;
        outputTokens += outcome.outputTokens;

        for (const verdict of outcome.verdicts) {
          const entry = batch[verdict.nr];
          if (!entry) {
            errors.push({ message: `Vurdering med ukendt nr. ${verdict.nr} blev kasseret`, profileId: profile.id });
            log.warn("scoring.verdict_out_of_range", { runId, nr: verdict.nr, batchSize: batch.length });
            continue;
          }
          await db
            .insert(noticeScores)
            .values({
              noticeId: entry.notice.id,
              profileId: profile.id,
              profileVersion: profile.version,
              score: verdict.score,
              reasoning: verdict.reasoning,
              fit: verdict.fit,
              concerns: verdict.concerns,
              matchedCpv: entry.verdict.matchedCpv,
              matchedKeywords: entry.verdict.matchedKeywords,
              model: outcome.model,
              inputTokens: Math.round(outcome.inputTokens / batch.length),
              outputTokens: Math.round(outcome.outputTokens / batch.length),
            })
            // A concurrent run may have scored the same notice already; the
            // cached verdict stands rather than paying to overwrite it.
            .onConflictDoNothing({
              target: [noticeScores.noticeId, noticeScores.profileId, noticeScores.profileVersion],
            });
          scored += 1;
        }
      } catch (error) {
        const info = errorToJson(error);
        errors.push({ message: info.message, profileId: profile.id });
        log.error("scoring.batch_failed", { runId, profileId: profile.id, ...info });
      }
    }
  }

  await db
    .update(scoringRuns)
    .set({
      finishedAt: new Date(),
      candidates,
      noticesScored: scored,
      inputTokens,
      outputTokens,
      errors: errors as unknown as object,
      status: errors.length > 0 && scored === 0 ? "fejlet" : "ok",
    })
    .where(eq(scoringRuns.id, runId));

  log.info("scoring.done", { runId, candidates, scored, inputTokens, outputTokens, errors: errors.length });

  return { runId, candidates, scored, inputTokens, outputTokens, errors };
}

/**
 * "Genscor de sidste 30 dage med denne profil" from the profile page (SPEC §6).
 * Deletes the cached verdicts for the current profile version so the next run
 * re-asks — the explicit trigger CLAUDE.md rule 8 allows for.
 */
export async function rescoreProfile(
  db: Database,
  profileId: string,
  days = 30,
  options: Omit<ScoreOptions, "profileId" | "since"> = {},
): Promise<ScoreResult> {
  const since = new Date(Date.now() - days * 86_400_000);
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
  if (!profile) throw new Error("Profilen findes ikke");

  const deleted = await db
    .delete(noticeScores)
    .where(
      and(
        eq(noticeScores.profileId, profileId),
        eq(noticeScores.profileVersion, profile.version),
        sql`${noticeScores.noticeId} in (select id from notices where published_at >= ${since.toISOString()})`,
      ),
    )
    .returning({ id: noticeScores.id });

  log.info("scoring.rescore_requested", { profileId, days, cleared: deleted.length });
  return runScoring(db, { ...options, profileId, since });
}
