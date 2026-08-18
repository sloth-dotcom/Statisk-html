import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireCronAuth } from "@/lib/cron-auth";
import { runDigest } from "@/lib/notify/digest";
import { errorToJson, log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function handle(request: Request): Promise<NextResponse> {
  const denied = requireCronAuth(request);
  if (denied) return denied;

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
