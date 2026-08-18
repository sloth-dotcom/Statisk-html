/**
 * Fase 0-probe (SPEC §1.4): henter de nyeste bekendtgørelser, dumper det rå
 * svar til tmp/sample-notices/ og udskriver hvilke felter der reelt blev
 * udfyldt med den nuværende mapning.
 *
 * Scriptet er skrevet, men ALDRIG kørt mod udbud.dk: byggemiljøet har ingen
 * netværksadgang til hverken git.erst.dk eller udbud.dk. Kør det som det første
 * når adgangen er på plads — dets output er det der skal stå i
 * docs/api-noter.md, i stedet for antagelser.
 *
 *   UDBUD_API_BASE_URL=... UDBUD_API_KEY=... npm run probe
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { UdbudClient } from "../src/lib/udbud/client";
import { coverageReport, normalizeNotice, type FieldResolution } from "../src/lib/udbud/normalize";

const OUT_DIR = join(process.cwd(), "tmp", "sample-notices");
const WANTED = Number(process.env.PROBE_COUNT ?? 20);

const baseUrl = process.env.UDBUD_API_BASE_URL;
if (!baseUrl) {
  console.error(
    "UDBUD_API_BASE_URL mangler. Base-URL'en er ikke verificeret endnu — se docs/api-noter.md og docs/aabne-spoergsmaal.md §1.",
  );
  process.exit(1);
}

await mkdir(OUT_DIR, { recursive: true });

const client = new UdbudClient({
  baseUrl,
  apiKey: process.env.UDBUD_API_KEY,
  apiKeyHeader: process.env.UDBUD_API_KEY_HEADER ?? "X-API-Key",
  pageSize: Math.min(WANTED, 50),
  maxConcurrency: 1,
});

const resolutions: FieldResolution[] = [];
let index = 0;

for await (const item of client.iterateNotices()) {
  const file = join(OUT_DIR, `notice-${String(index).padStart(3, "0")}.json`);
  await writeFile(file, JSON.stringify(item, null, 2), "utf8");

  try {
    const { resolution } = normalizeNotice(item);
    resolutions.push(resolution);
  } catch (error) {
    console.error(`Kunne ikke normalisere ${file}: ${String(error)}`);
  }

  index += 1;
  if (index >= WANTED) break;
}

console.log(`\nGemte ${index} rå svar i ${OUT_DIR}\n`);
console.log("Feltdækning — hvilke felter er reelt udfyldt, og hvilken sti ramte:");
console.table(
  Object.entries(coverageReport(resolutions)).map(([felt, info]) => ({
    felt,
    udfyldt: `${info.filled}/${info.total}`,
    stier: info.paths.join(" | ") || "(ingen)",
  })),
);
console.log(
  "\nRet src/lib/udbud/field-map.ts efter tabellen ovenfor, sæt verified: true, og skriv resultatet ind i docs/api-noter.md.",
);
