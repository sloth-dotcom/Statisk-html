import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "@/lib/logger";

/**
 * CPV labels come from the SDK's own codelists (SPEC §5) — we keep no hardcoded
 * copy. `npm run codelists` downloads them to data/cpv.json; until it has run,
 * the UI shows the bare code rather than a made-up label.
 */
let cache: Record<string, string> | null = null;

export function cpvLabels(): Record<string, string> {
  if (cache) return cache;
  const path = join(process.cwd(), "data", "cpv.json");
  if (!existsSync(path)) {
    log.warn("codelist.missing", { path, hint: "kør npm run codelists når git.erst.dk er tilgængelig" });
    cache = {};
    return cache;
  }
  try {
    cache = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
  } catch (error) {
    log.error("codelist.unreadable", { path, message: String(error) });
    cache = {};
  }
  return cache;
}

export function cpvLabel(code: string): string {
  const labels = cpvLabels();
  return labels[code] ?? labels[code.replace(/0+$/, "")] ?? code;
}
