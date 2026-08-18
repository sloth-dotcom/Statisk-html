import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireCronAuth } from "@/lib/cron-auth";
import { runDigest } from "@/lib/notify/digest";
import { errorToJson, log } from "@/lib/logger";
import { copenhagenHour } from "@/lib/time";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function handle(request: Request): Promise<NextResponse> {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  // Vercel cron is UTC, and 07:00 in Copenhagen is 05:00 UTC in summer and
  // 06:00 in winter. Both hours are scheduled and the wrong one returns here,
  // so the digest lands at 07:00 local all year (SPEC §7).
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const hour = copenhagenHour();
  if (!force && hour !== 7) {
    log.info("cron.digest_skipped_wrong_hour", { hour });
    return NextResponse.json({ sprunget_over: true, lokalTime: hour });
  }

  try {
    const result = await runDigest(getDb());
    return NextResponse.json({
      runId: result.runId,
      type: result.kind,
      poster: result.entries,
      leveret: result.delivered,
      bemaerkninger: result.reasons,
    });
  } catch (error) {
    const info = errorToJson(error);
    log.error("cron.digest_failed", info);
    return NextResponse.json({ fejl: info.message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
