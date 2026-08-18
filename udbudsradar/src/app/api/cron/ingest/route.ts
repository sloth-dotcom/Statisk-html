import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireCronAuth } from "@/lib/cron-auth";
import { runIngest } from "@/lib/ingest";
import { UdbudClient } from "@/lib/udbud/client";
import { errorToJson, log } from "@/lib/logger";
import { notifyIngestFailure } from "@/lib/notify/alerts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(request: Request): Promise<NextResponse> {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  const db = getDb();
  try {
    const client = UdbudClient.fromEnv();
    const result = await runIngest(db, { client });
    await notifyIngestFailure(db);
    return NextResponse.json({
      runId: result.runId,
      set: result.noticesSeen,
      nye: result.noticesNew,
      opdaterede: result.noticesUpdated,
      apiKald: result.apiRequests,
      fejl: result.errors,
      vindue: { fra: result.window.from.toISOString(), til: result.window.to.toISOString() },
      feltdaekning: result.coverage,
    });
  } catch (error) {
    const info = errorToJson(error);
    log.error("cron.ingest_failed", info);
    return NextResponse.json({ fejl: info.message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
