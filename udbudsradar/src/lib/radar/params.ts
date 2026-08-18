import type { RadarFilters } from "./query";

export type SearchParams = Record<string, string | string[] | undefined>;

function one(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  const single = Array.isArray(value) ? value[0] : value;
  const trimmed = single?.trim();
  return trimmed ? trimmed : undefined;
}

function date(params: SearchParams, key: string): Date | undefined {
  const raw = one(params, key);
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** URL is the only filter state, so a link is a saved search (SPEC §6). */
export function parseRadarParams(params: SearchParams): RadarFilters {
  const minScoreRaw = one(params, "minScore");
  const minScore = minScoreRaw !== undefined ? Number(minScoreRaw) : undefined;
  const visning = one(params, "visning");

  return {
    profileId: one(params, "profil"),
    minScore: minScore !== undefined && Number.isFinite(minScore) ? minScore : undefined,
    region: one(params, "region"),
    buyer: one(params, "ordregiver"),
    noticeType: one(params, "type"),
    query: one(params, "q"),
    from: date(params, "fra"),
    to: date(params, "til"),
    visning: visning === "afviste" || visning === "alle" ? visning : "aabne",
    includeExpired: one(params, "udloebne") === "1",
    page: Number(one(params, "side") ?? 1) || 1,
  };
}

export function buildQueryString(params: SearchParams, overrides: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const single = Array.isArray(value) ? value[0] : value;
    if (single) search.set(key, single);
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) search.delete(key);
    else search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}
