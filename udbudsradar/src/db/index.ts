import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { requireEnv } from "@/lib/env";

export type Database = ReturnType<typeof createDb>["db"];

export function createDb(url?: string) {
  const client = postgres(url ?? requireEnv("DATABASE_URL"), {
    max: 5,
    prepare: false,
    // Timestamps come back as JS Dates in UTC; formatting to Europe/Copenhagen
    // happens in the UI layer only (SPEC §8).
    types: {},
  });
  return { client, db: drizzle(client, { schema }) };
}

declare global {
  var __udbudsradarDb: { client: postgres.Sql; db: ReturnType<typeof drizzle<typeof schema>> } | undefined;
}

/**
 * One pool per process. Next.js re-evaluates modules on every hot reload in dev,
 * which would otherwise leak a connection pool per edit.
 */
export function getDb() {
  if (!globalThis.__udbudsradarDb) {
    globalThis.__udbudsradarDb = createDb();
  }
  return globalThis.__udbudsradarDb.db;
}

export { schema };
