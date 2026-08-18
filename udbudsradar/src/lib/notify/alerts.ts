import { desc, eq, gt, and } from "drizzle-orm";
import type { Database } from "@/db";
import { digestRuns, ingestRuns } from "@/db/schema";
import { log } from "@/lib/logger";
import { formatCopenhagen } from "@/lib/time";
import { sendEmail, sendSlack } from "./channels";

/**
 * Separate alarm channel (SPEC §7): two failed ingest runs in a row means the
 * pipeline is down, and that must not wait for the 07:00 digest. Alarms once
 * per failure streak — a repeated alarm every hour trains people to ignore it.
 */
export async function notifyIngestFailure(db: Database): Promise<boolean> {
  const recent = await db
    .select({ id: ingestRuns.id, status: ingestRuns.status, finishedAt: ingestRuns.finishedAt })
    .from(ingestRuns)
    .orderBy(desc(ingestRuns.startedAt))
    .limit(2);

  if (recent.length < 2 || recent.some((run) => run.status !== "fejlet")) return false;

  const oldestFailure = recent[1]!.finishedAt ?? new Date(0);
  const [alreadyAlarmed] = await db
    .select({ id: digestRuns.id })
    .from(digestRuns)
    .where(and(eq(digestRuns.kind, "alarm"), gt(digestRuns.startedAt, oldestFailure)))
    .limit(1);

  if (alreadyAlarmed) {
    log.info("alert.ingest_already_sent", { since: oldestFailure.toISOString() });
    return false;
  }

  const message = [
    "🚨 Udbudsradar: ingest er fejlet to kørsler i træk.",
    `Seneste kørsel: ${formatCopenhagen(recent[0]!.finishedAt)}.`,
    "Se /status for fejldetaljer.",
  ].join("\n");

  const [run] = await db.insert(digestRuns).values({ kind: "alarm", status: "kører" }).returning({ id: digestRuns.id });
  const results = await Promise.all([sendSlack(message), sendEmail("Udbudsradar: ingest fejler", `<p>${message.replace(/\n/g, "<br>")}</p>`, message)]);
  const sent = results.some((r) => r.sent);

  await db
    .update(digestRuns)
    .set({
      finishedAt: new Date(),
      status: sent ? "ok" : "fejlet",
      errors: results.filter((r) => !r.sent) as unknown as object,
    })
    .where(eq(digestRuns.id, run!.id));

  log.warn("alert.ingest_failed_twice", { sent, channels: results });
  return sent;
}
