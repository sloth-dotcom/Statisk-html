import { and, desc, eq, gt, gte, isNull, or, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { digestItems, digestRuns, noticeScores, noticeStatus, notices, profiles } from "@/db/schema";
import { digestRecipients, env } from "@/lib/env";
import { errorToJson, log } from "@/lib/logger";
import { daysUntil, formatDateCopenhagen } from "@/lib/time";
import { formatAmount } from "@/lib/utils";
import { sendEmail, sendSlack } from "./channels";

export interface DigestEntry {
  noticeRowId: string;
  noticeId: string;
  profileId: string;
  profileName: string;
  title: string;
  buyerName: string | null;
  score: number;
  reasoning: string;
  deadlineAt: Date | null;
  valueAmount: string | null;
  valueCurrency: string | null;
}

export interface DigestResult {
  runId: string | null;
  kind: "daglig" | "ugentlig_intet_nyt" | "ingen";
  entries: number;
  delivered: boolean;
  reasons: string[];
}

/**
 * Everything that has crossed its profile's threshold and has never been sent
 * for that profile before. The "never sent" part is a left join against the
 * ledger, not a timestamp comparison — a digest that failed to send yesterday
 * must still go out today.
 */
export async function selectDigestEntries(db: Database, limitPerProfile: number): Promise<DigestEntry[]> {
  const activeProfiles = await db.select().from(profiles).where(eq(profiles.active, true));
  const entries: DigestEntry[] = [];

  for (const profile of activeProfiles) {
    const rows = await db
      .select({
        noticeRowId: notices.id,
        noticeId: notices.noticeId,
        title: notices.title,
        buyerName: notices.buyerName,
        deadlineAt: notices.deadlineAt,
        valueAmount: notices.valueAmount,
        valueCurrency: notices.valueCurrency,
        score: noticeScores.score,
        reasoning: noticeScores.reasoning,
      })
      .from(noticeScores)
      .innerJoin(notices, eq(notices.id, noticeScores.noticeId))
      .leftJoin(
        digestItems,
        and(eq(digestItems.noticeId, notices.id), eq(digestItems.profileId, profile.id)),
      )
      .leftJoin(noticeStatus, eq(noticeStatus.noticeId, notices.noticeId))
      .where(
        and(
          eq(noticeScores.profileId, profile.id),
          eq(noticeScores.profileVersion, profile.version),
          gte(noticeScores.score, profile.minScoreForDigest),
          isNull(digestItems.id),
          or(isNull(noticeStatus.status), sql`${noticeStatus.status} <> 'afvist'`)!,
          or(isNull(notices.deadlineAt), gte(notices.deadlineAt, sql`now()`))!,
        ),
      )
      .orderBy(desc(noticeScores.score))
      .limit(limitPerProfile);

    for (const row of rows) {
      entries.push({
        noticeRowId: row.noticeRowId,
        noticeId: row.noticeId,
        profileId: profile.id,
        profileName: profile.name,
        title: row.title ?? "(uden titel)",
        buyerName: row.buyerName,
        score: row.score,
        reasoning: row.reasoning,
        deadlineAt: row.deadlineAt,
        valueAmount: row.valueAmount,
        valueCurrency: row.valueCurrency,
      });
    }
  }

  return entries;
}

function deadlineText(deadline: Date | null): string {
  if (!deadline) return "frist ikke oplyst";
  const days = daysUntil(deadline);
  const suffix = days === null ? "" : days < 0 ? " (overskredet)" : days === 0 ? " (i dag)" : ` (${days} dage)`;
  return `frist ${formatDateCopenhagen(deadline)}${suffix}`;
}

export function renderDigest(entries: DigestEntry[], baseUrl: string): { html: string; text: string; subject: string } {
  const byProfile = new Map<string, DigestEntry[]>();
  for (const entry of entries) {
    const list = byProfile.get(entry.profileName) ?? [];
    list.push(entry);
    byProfile.set(entry.profileName, list);
  }

  const textParts: string[] = [];
  const htmlParts: string[] = [
    `<div style="font-family:system-ui,sans-serif;max-width:640px">`,
    `<h2 style="margin:0 0 12px">Udbudsradar</h2>`,
  ];

  for (const [profileName, list] of byProfile) {
    textParts.push(`## ${profileName}`);
    htmlParts.push(`<h3 style="margin:20px 0 8px;font-size:15px">${escapeHtml(profileName)}</h3>`);

    for (const entry of list.sort((a, b) => b.score - a.score)) {
      const url = `${baseUrl.replace(/\/$/, "")}/udbud/${encodeURIComponent(entry.noticeId)}`;
      const meta = [entry.buyerName ?? "ordregiver ukendt", deadlineText(entry.deadlineAt), formatAmount(entry.valueAmount, entry.valueCurrency)].join(" · ");

      textParts.push(`- [${entry.score}] ${entry.title}\n  ${meta}\n  ${entry.reasoning}\n  ${url}`);
      htmlParts.push(
        `<div style="border:1px solid #e3e6ea;border-radius:8px;padding:12px;margin-bottom:8px">`,
        `<div style="font-weight:600"><a href="${url}" style="color:#1f5f9c;text-decoration:none">${escapeHtml(entry.title)}</a> <span style="color:#5b6472">(${entry.score})</span></div>`,
        `<div style="color:#5b6472;font-size:13px;margin:4px 0">${escapeHtml(meta)}</div>`,
        `<div style="font-size:14px">${escapeHtml(entry.reasoning)}</div>`,
        `</div>`,
      );
    }
  }

  htmlParts.push(
    `<p style="color:#5b6472;font-size:13px">Se alle udbud i <a href="${baseUrl}" style="color:#1f5f9c">radaren</a>.</p></div>`,
  );
  textParts.push(`\nSe alle udbud: ${baseUrl}`);

  return {
    subject: `Udbudsradar: ${entries.length} nye relevante udbud`,
    html: htmlParts.join("\n"),
    text: textParts.join("\n"),
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

/** Silence must not look like a healthy pipeline, so an empty week still gets a mail. */
async function weeklyNothingNewIsDue(db: Database, now: Date): Promise<boolean> {
  const [last] = await db
    .select({ startedAt: digestRuns.startedAt })
    .from(digestRuns)
    .where(or(eq(digestRuns.kind, "ugentlig_intet_nyt"), gt(digestRuns.itemCount, 0))!)
    .orderBy(desc(digestRuns.startedAt))
    .limit(1);
  if (!last) return true;
  return now.getTime() - last.startedAt.getTime() >= 7 * 86_400_000;
}

export interface DigestOptions {
  now?: Date;
  maxItems?: number;
  baseUrl?: string;
}

/**
 * The daily digest (SPEC §7). Items are written to the ledger inside the same
 * transaction as the send: if delivery throws, the transaction rolls back and
 * the notices go out in the next run rather than being lost — and a successful
 * send can never be repeated, because the unique index rejects it.
 */
export async function runDigest(db: Database, options: DigestOptions = {}): Promise<DigestResult> {
  const config = env();
  const now = options.now ?? new Date();
  const maxItems = options.maxItems ?? config.DIGEST_MAX_ITEMS;
  const baseUrl = options.baseUrl ?? config.APP_BASE_URL;
  const recipients = digestRecipients();

  const entries = await selectDigestEntries(db, maxItems);

  if (entries.length === 0) {
    if (!(await weeklyNothingNewIsDue(db, now))) {
      log.info("digest.skipped_empty", {});
      return { runId: null, kind: "ingen", entries: 0, delivered: false, reasons: ["Ingen nye udbud, ugentlig besked ikke forfalden"] };
    }

    const [run] = await db
      .insert(digestRuns)
      .values({ kind: "ugentlig_intet_nyt", recipients, status: "kører" })
      .returning({ id: digestRuns.id });
    const text = "Udbudsradar: ingen nye relevante udbud den seneste uge. Pipelinen kører — se /status for detaljer.";
    const results = await Promise.all([sendEmail("Udbudsradar: intet nyt", `<p>${text}</p>`, text), sendSlack(text)]);
    const delivered = results.some((r) => r.sent);

    await db
      .update(digestRuns)
      .set({ finishedAt: new Date(), status: delivered ? "ok" : "fejlet", errors: results.filter((r) => !r.sent) as unknown as object })
      .where(eq(digestRuns.id, run!.id));

    return {
      runId: run!.id,
      kind: "ugentlig_intet_nyt",
      entries: 0,
      delivered,
      reasons: results.filter((r) => !r.sent).map((r) => r.reason ?? "ukendt"),
    };
  }

  const { html, text, subject } = renderDigest(entries, baseUrl);
  const reasons: string[] = [];
  let runId: string | null = null;
  let delivered = false;

  try {
    await db.transaction(async (tx) => {
      const [run] = await tx
        .insert(digestRuns)
        .values({ kind: "daglig", recipients, itemCount: entries.length, status: "kører" })
        .returning({ id: digestRuns.id });
      runId = run!.id;

      await tx.insert(digestItems).values(
        entries.map((entry) => ({
          digestRunId: run!.id,
          noticeId: entry.noticeRowId,
          profileId: entry.profileId,
          score: entry.score,
        })),
      );

      const results = await Promise.all([sendEmail(subject, html, text), sendSlack(text)]);
      delivered = results.some((r) => r.sent);
      reasons.push(...results.filter((r) => !r.sent).map((r) => r.reason ?? "ukendt"));

      if (!delivered) {
        // Rolls back the ledger rows too, so nothing is silently marked as sent.
        throw new Error(`Digest kunne ikke sendes: ${reasons.join("; ")}`);
      }

      await tx
        .update(digestRuns)
        .set({ finishedAt: new Date(), status: "ok", errors: reasons as unknown as object })
        .where(eq(digestRuns.id, run!.id));
    });
  } catch (error) {
    const info = errorToJson(error);
    log.error("digest.failed", { ...info, entries: entries.length });
    await db.insert(digestRuns).values({
      kind: "daglig",
      recipients,
      itemCount: 0,
      status: "fejlet",
      finishedAt: new Date(),
      errors: [{ message: info.message }] as unknown as object,
    });
    return { runId: null, kind: "daglig", entries: entries.length, delivered: false, reasons: reasons.length ? reasons : [info.message] };
  }

  log.info("digest.sent", { runId, entries: entries.length, recipients: recipients.length });
  return { runId, kind: "daglig", entries: entries.length, delivered, reasons };
}
