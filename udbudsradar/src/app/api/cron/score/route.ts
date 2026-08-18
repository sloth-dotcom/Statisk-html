import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireCronAuth } from "@/lib/cron-auth";
import { runScoring } from "@/lib/scoring";
import { errorToJson, log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(request: Request): Promise<NextResponse> {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  try {
    const result = await runScoring(getDb());
    return NextResponse.json({
      runId: result.runId,
      kandidater: result.candidates,
      scorede: result.scored,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      fejl: result.errors,
    });
  } catch (error) {
    const info = errorToJson(error);
    log.error("cron.score_failed", info);
    return NextResponse.json({ fejl: info.message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
