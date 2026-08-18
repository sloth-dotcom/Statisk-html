/**
 * Henter CPV-kodelisten fra udbud.dk's SDK-repo til data/cpv.json, så UI'et kan
 * vise labels uden at vi hardkoder en kopi (SPEC §5, lag 2).
 *
 * Ikke kørt endnu: git.erst.dk er blokeret fra byggemiljøet. URL'en nedenfor er
 * den SPEC §1 opgiver — verificér stien i repoet første gang scriptet køres.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SOURCE =
  process.env.CPV_CODELIST_URL ??
  "https://git.erst.dk/udbud-dk/sdk/-/raw/master/eforms-sdk-dk/codelists/cpv.json";

const response = await fetch(SOURCE);
if (!response.ok) {
  console.error(`Kunne ikke hente kodelisten: ${response.status} ${response.statusText} fra ${SOURCE}`);
  process.exit(1);
}

const payload: unknown = await response.json();

/** Kodelisterne kan være {code, name} eller {id, label} — begge former mappes til {kode: label}. */
function toLabelMap(input: unknown): Record<string, string> {
  const rows = Array.isArray(input)
    ? input
    : typeof input === "object" && input !== null && Array.isArray((input as { codes?: unknown }).codes)
      ? ((input as { codes: unknown[] }).codes)
      : [];
  const map: Record<string, string> = {};
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const code = String(record.code ?? record.id ?? "").replace(/[^0-9]/g, "");
    const label = record.name ?? record.label ?? record.dan ?? record.da;
    if (code && typeof label === "string") map[code] = label;
  }
  return map;
}

const labels = toLabelMap(payload);
if (Object.keys(labels).length === 0) {
  console.error("Svaret indeholdt ingen genkendelige koder. Kig på formatet før du fortsætter.");
  process.exit(1);
}

await mkdir(join(process.cwd(), "data"), { recursive: true });
await writeFile(join(process.cwd(), "data", "cpv.json"), JSON.stringify(labels, null, 2), "utf8");
console.log(`Skrev ${Object.keys(labels).length} CPV-koder til data/cpv.json`);
