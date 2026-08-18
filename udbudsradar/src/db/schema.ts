import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { customType } from "drizzle-orm/pg-core";

/**
 * tsvector has no first-class Drizzle type. We only ever read it through raw
 * SQL predicates, so a passthrough custom type is enough to get the column and
 * its GIN index into the generated migration.
 */
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const NOTICE_STATUSES = ["ny", "interessant", "i_gang", "afvist", "budt"] as const;
export type NoticeStatusValue = (typeof NOTICE_STATUSES)[number];

export const INGEST_STATUSES = ["kører", "ok", "fejlet"] as const;
export const DIGEST_KINDS = ["daglig", "ugentlig_intet_nyt", "alarm"] as const;

/**
 * One row per (noticeId, noticeVersion). A new version of the same tender is a
 * new row, never an overwrite — see SPEC §4.4.
 */
export const notices = pgTable(
  "notices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noticeId: text("notice_id").notNull(),
    noticeVersion: text("notice_version").notNull(),
    noticeType: text("notice_type"),
    title: text("title"),
    description: text("description"),
    buyerName: text("buyer_name"),
    buyerId: text("buyer_id"),
    buyerRegion: text("buyer_region"),
    cpvMain: text("cpv_main"),
    cpvAll: text("cpv_all").array().notNull().default(sql`ARRAY[]::text[]`),
    valueAmount: numeric("value_amount"),
    valueCurrency: text("value_currency"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    procedureType: text("procedure_type"),
    sourceUrl: text("source_url"),
    /** The untouched API payload. Never derive-and-discard — see CLAUDE.md rule 2. */
    raw: jsonb("raw").notNull(),
    /** sha256 over the fields we display, so we can tell a real change from a re-publish. */
    contentHash: text("content_hash").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('danish', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(buyer_name, ''))`,
    ),
  },
  (table) => [
    uniqueIndex("notices_notice_id_version_uq").on(table.noticeId, table.noticeVersion),
    index("notices_published_at_idx").on(table.publishedAt),
    index("notices_deadline_at_idx").on(table.deadlineAt),
    index("notices_cpv_main_idx").on(table.cpvMain),
    index("notices_cpv_all_idx").using("gin", table.cpvAll),
    index("notices_search_idx").using("gin", table.searchVector),
  ],
);

/**
 * A business profile: what we do, plus the hard filters that decide what is
 * even worth paying an AI to read. `version` bumps on every edit so cached
 * scores from an older definition are not silently reused.
 */
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  cpvCodes: text("cpv_codes").array().notNull().default(sql`ARRAY[]::text[]`),
  keywords: text("keywords").array().notNull().default(sql`ARRAY[]::text[]`),
  excludedKeywords: text("excluded_keywords").array().notNull().default(sql`ARRAY[]::text[]`),
  regions: text("regions").array().notNull().default(sql`ARRAY[]::text[]`),
  noticeTypes: text("notice_types").array().notNull().default(sql`ARRAY[]::text[]`),
  buyerAllowlist: text("buyer_allowlist").array().notNull().default(sql`ARRAY[]::text[]`),
  buyerBlocklist: text("buyer_blocklist").array().notNull().default(sql`ARRAY[]::text[]`),
  minValue: numeric("min_value"),
  maxValue: numeric("max_value"),
  minScoreForDigest: integer("min_score_for_digest").notNull().default(60),
  version: integer("version").notNull().default(1),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Cached AI verdicts. One row per (notice row, profile, profile version). */
export const noticeScores = pgTable(
  "notice_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noticeId: uuid("notice_id")
      .notNull()
      .references(() => notices.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    profileVersion: integer("profile_version").notNull().default(1),
    score: integer("score").notNull(),
    reasoning: text("reasoning").notNull().default(""),
    fit: text("fit"),
    concerns: text("concerns").array().notNull().default(sql`ARRAY[]::text[]`),
    matchedKeywords: text("matched_keywords").array().notNull().default(sql`ARRAY[]::text[]`),
    matchedCpv: text("matched_cpv").array().notNull().default(sql`ARRAY[]::text[]`),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    scoredAt: timestamp("scored_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("notice_scores_notice_profile_version_uq").on(
      table.noticeId,
      table.profileId,
      table.profileVersion,
    ),
    index("notice_scores_score_idx").on(table.score),
    index("notice_scores_profile_idx").on(table.profileId),
  ],
);

/**
 * Human triage. Keyed on udbud.dk's noticeId (text), not on our per-version row:
 * marking version 01 as "afvist" should stay rejected when version 02 arrives.
 * Deviation from SPEC §3 — see docs/afvigelser-fra-spec.md.
 */
export const noticeStatus = pgTable(
  "notice_status",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noticeId: text("notice_id").notNull(),
    status: text("status").notNull().default("ny"),
    assignedTo: text("assigned_to"),
    note: text("note"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("notice_status_notice_id_uq").on(table.noticeId)],
);

/** Without this table the pipeline cannot be debugged — SPEC §3. */
export const ingestRuns = pgTable(
  "ingest_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    windowFrom: timestamp("window_from", { withTimezone: true }),
    windowTo: timestamp("window_to", { withTimezone: true }),
    noticesSeen: integer("notices_seen").notNull().default(0),
    noticesNew: integer("notices_new").notNull().default(0),
    noticesUpdated: integer("notices_updated").notNull().default(0),
    apiRequests: integer("api_requests").notNull().default(0),
    errors: jsonb("errors").notNull().default(sql`'[]'::jsonb`),
    status: text("status").notNull().default("kører"),
  },
  (table) => [index("ingest_runs_started_at_idx").on(table.startedAt)],
);

/** Token spend per scoring run, so the monthly AI bill is visible on /status. */
export const scoringRuns = pgTable(
  "scoring_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    model: text("model").notNull(),
    candidates: integer("candidates").notNull().default(0),
    noticesScored: integer("notices_scored").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    errors: jsonb("errors").notNull().default(sql`'[]'::jsonb`),
    status: text("status").notNull().default("kører"),
  },
  (table) => [index("scoring_runs_started_at_idx").on(table.startedAt)],
);

export const digestRuns = pgTable(
  "digest_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    kind: text("kind").notNull().default("daglig"),
    recipients: text("recipients").array().notNull().default(sql`ARRAY[]::text[]`),
    itemCount: integer("item_count").notNull().default(0),
    status: text("status").notNull().default("kører"),
    errors: jsonb("errors").notNull().default(sql`'[]'::jsonb`),
  },
  (table) => [index("digest_runs_started_at_idx").on(table.startedAt)],
);

/**
 * The send ledger. The unique index — not application logic — is what
 * guarantees a notice is never mailed twice for the same profile.
 */
export const digestItems = pgTable(
  "digest_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    digestRunId: uuid("digest_run_id")
      .notNull()
      .references(() => digestRuns.id, { onDelete: "cascade" }),
    noticeId: uuid("notice_id")
      .notNull()
      .references(() => notices.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("digest_items_notice_profile_uq").on(table.noticeId, table.profileId)],
);

export type Notice = typeof notices.$inferSelect;
export type NewNotice = typeof notices.$inferInsert;
export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type NoticeScore = typeof noticeScores.$inferSelect;
export type IngestRun = typeof ingestRuns.$inferSelect;
export type ScoringRun = typeof scoringRuns.$inferSelect;
export type DigestRun = typeof digestRuns.$inferSelect;
