import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Guards /api/cron/*. Returns a response when the caller is not allowed, or
 * null when it is. Without CRON_SECRET set the endpoints stay closed — an
 * unprotected ingest endpoint is a way to burn our API quota from outside.
 */
export function requireCronAuth(request: Request): NextResponse | null {
  const secret = env().CRON_SECRET;
  if (!secret) {
    log.error("cron.secret_missing", { url: request.url });
    return NextResponse.json(
      { fejl: "CRON_SECRET er ikke sat. Endpointet er lukket indtil det er konfigureret." },
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const direct = request.headers.get("x-cron-secret");
  const provided = bearer ?? direct;

  if (!provided || !safeEqual(provided, secret)) {
    log.warn("cron.unauthorized", { url: request.url });
    return NextResponse.json({ fejl: "Uautoriseret" }, { status: 401 });
  }

  return null;
}
