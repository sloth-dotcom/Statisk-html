import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import { createDb } from "../../src/db";

/**
 * Integration tests run against a real Postgres (SPEC §9) — the danish text
 * search config and the unique indexes are exactly what we are testing, and a
 * mock would test nothing.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";

export const hasTestDatabase = TEST_DATABASE_URL !== "";

export async function setupTestDb() {
  if (!hasTestDatabase) {
    throw new Error("TEST_DATABASE_URL mangler — integrationstest kan ikke køre.");
  }
  const { client, db } = createDb(TEST_DATABASE_URL);
  await migrate(db, { migrationsFolder: "./drizzle" });
  return { client, db };
}

export async function truncateAll(db: Awaited<ReturnType<typeof setupTestDb>>["db"]) {
  await db.execute(
    sql`truncate table digest_items, digest_runs, notice_scores, notice_status, notices, profiles, ingest_runs, scoring_runs restart identity cascade`,
  );
}
