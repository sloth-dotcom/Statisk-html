import { and, asc, desc, eq, gte, ilike, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { noticeScores, noticeStatus, notices, profiles, type Profile } from "@/db/schema";

export interface RadarFilters {
  profileId?: string;
  minScore?: number;
  region?: string;
  buyer?: string;
  noticeType?: string;
  query?: string;
  from?: Date;
  to?: Date;
  /** "aabne" (default) hides rejected, "afviste" shows only rejected, "alle" shows everything. */
  visning?: "aabne" | "afviste" | "alle";
  includeExpired?: boolean;
  page?: number;
  pageSize?: number;
}

export interface RadarRow {
  id: string;
  noticeId: string;
  noticeVersion: string;
  noticeType: string | null;
  title: string | null;
  description: string | null;
  buyerName: string | null;
  buyerRegion: string | null;
  cpvMain: string | null;
  cpvAll: string[];
  valueAmount: string | null;
  valueCurrency: string | null;
  publishedAt: Date | null;
  deadlineAt: Date | null;
  sourceUrl: string | null;
  score: number | null;
  reasoning: string | null;
  fit: string | null;
  status: string | null;
  assignedTo: string | null;
}

export async function listProfiles(): Promise<Profile[]> {
  return getDb().select().from(profiles).orderBy(asc(profiles.name));
}

export async function getProfile(id: string): Promise<Profile | null> {
  const [row] = await getDb().select().from(profiles).where(eq(profiles.id, id)).limit(1);
  return row ?? null;
}

/**
 * The radar list. Scores are joined for the selected profile only, and the
 * human status is joined on udbud.dk's notice id so triage survives a new
 * version of the same tender.
 */
export async function listRadar(filters: RadarFilters): Promise<{ rows: RadarRow[]; total: number }> {
  const db = getDb();
  const pageSize = Math.min(filters.pageSize ?? 25, 100);
  const page = Math.max(filters.page ?? 1, 1);

  const conditions: SQL[] = [];

  if (filters.region) conditions.push(ilike(notices.buyerRegion, `%${filters.region}%`));
  if (filters.buyer) conditions.push(ilike(notices.buyerName, `%${filters.buyer}%`));
  if (filters.noticeType) conditions.push(eq(notices.noticeType, filters.noticeType));
  if (filters.from) conditions.push(gte(notices.publishedAt, filters.from));
  if (filters.to) conditions.push(lte(notices.publishedAt, filters.to));
  if (filters.query) {
    // websearch_to_tsquery understands quotes and "-word" the way people type.
    conditions.push(sql`${notices.searchVector} @@ websearch_to_tsquery('danish', ${filters.query})`);
  }
  if (!filters.includeExpired) {
    conditions.push(or(isNull(notices.deadlineAt), gte(notices.deadlineAt, sql`now()`))!);
  }

  const visning = filters.visning ?? "aabne";
  if (visning === "aabne") {
    conditions.push(or(isNull(noticeStatus.status), ne(noticeStatus.status, "afvist"))!);
  } else if (visning === "afviste") {
    conditions.push(eq(noticeStatus.status, "afvist"));
  }

  if (filters.minScore !== undefined && filters.profileId) {
    conditions.push(gte(noticeScores.score, filters.minScore));
  }

  const scoreJoin = filters.profileId
    ? and(
        eq(noticeScores.noticeId, notices.id),
        eq(noticeScores.profileId, filters.profileId),
        sql`${noticeScores.profileVersion} = (select version from profiles where id = ${filters.profileId})`,
      )
    : sql`false`;

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: notices.id,
      noticeId: notices.noticeId,
      noticeVersion: notices.noticeVersion,
      noticeType: notices.noticeType,
      title: notices.title,
      description: notices.description,
      buyerName: notices.buyerName,
      buyerRegion: notices.buyerRegion,
      cpvMain: notices.cpvMain,
      cpvAll: notices.cpvAll,
      valueAmount: notices.valueAmount,
      valueCurrency: notices.valueCurrency,
      publishedAt: notices.publishedAt,
      deadlineAt: notices.deadlineAt,
      sourceUrl: notices.sourceUrl,
      score: noticeScores.score,
      reasoning: noticeScores.reasoning,
      fit: noticeScores.fit,
      status: noticeStatus.status,
      assignedTo: noticeStatus.assignedTo,
    })
    .from(notices)
    .leftJoin(noticeScores, scoreJoin)
    .leftJoin(noticeStatus, eq(noticeStatus.noticeId, notices.noticeId))
    .where(where)
    .orderBy(sql`${noticeScores.score} desc nulls last`, desc(notices.publishedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [count] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(notices)
    .leftJoin(noticeScores, scoreJoin)
    .leftJoin(noticeStatus, eq(noticeStatus.noticeId, notices.noticeId))
    .where(where);

  return { rows, total: count?.value ?? 0 };
}

/** Distinct values for the filter dropdowns, so people filter on what exists. */
export async function filterOptions(): Promise<{ regions: string[]; noticeTypes: string[] }> {
  const db = getDb();
  const regions = await db
    .selectDistinct({ value: notices.buyerRegion })
    .from(notices)
    .where(sql`${notices.buyerRegion} is not null`)
    .orderBy(asc(notices.buyerRegion))
    .limit(100);
  const noticeTypes = await db
    .selectDistinct({ value: notices.noticeType })
    .from(notices)
    .where(sql`${notices.noticeType} is not null`)
    .orderBy(asc(notices.noticeType))
    .limit(100);
  return {
    regions: regions.map((r) => r.value).filter((v): v is string => v !== null),
    noticeTypes: noticeTypes.map((r) => r.value).filter((v): v is string => v !== null),
  };
}
