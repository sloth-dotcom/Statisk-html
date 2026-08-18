/**
 * Opretter én tom startprofil, så /profiler ikke er et blankt ark ved første
 * opstart. Der seedes bevidst ingen bekendtgørelser: testdata for API-svar skal
 * komme fra `npm run probe`, ikke fra opfundne rækker (SPEC §9).
 */
import { createDb } from "../src/db";
import { profiles } from "../src/db/schema";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL mangler. Se .env.example.");
  process.exit(1);
}

const { client, db } = createDb(url);

const existing = await db.select({ id: profiles.id }).from(profiles).limit(1);
if (existing.length > 0) {
  console.log("Der findes allerede mindst én profil — seeder ikke.");
} else {
  const [created] = await db
    .insert(profiles)
    .values({
      name: "Standardprofil",
      description:
        "UDFYLD MIG: hvad laver vi, hvilke opgaver kan vi løse, hvilke referencer har vi, og hvad siger vi nej til? " +
        "Denne tekst er det eneste AI-scoringen ved om firmaet.",
      cpvCodes: [],
      keywords: [],
      excludedKeywords: [],
      regions: [],
      minScoreForDigest: 60,
    })
    .returning({ id: profiles.id });
  console.log(`Oprettede startprofil ${created?.id}. Udfyld den på /profiler før du kører scoring.`);
}

await client.end();
