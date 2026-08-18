import { createHash } from "node:crypto";
import { copenhagenWallTimeToUtc } from "@/lib/time";
import { UNVERIFIED_FIELD_MAP, type NoticeFieldMap } from "./field-map";

export interface NormalizedNotice {
  noticeId: string;
  noticeVersion: string;
  noticeType: string | null;
  title: string | null;
  description: string | null;
  buyerName: string | null;
  buyerId: string | null;
  buyerRegion: string | null;
  cpvMain: string | null;
  cpvAll: string[];
  valueAmount: string | null;
  valueCurrency: string | null;
  publishedAt: Date | null;
  deadlineAt: Date | null;
  procedureType: string | null;
  sourceUrl: string;
  raw: unknown;
  contentHash: string;
}

export interface FieldResolution {
  /** field name -> the path that actually produced a value */
  resolved: Record<string, string>;
  /** fields where no candidate path produced a value */
  missing: string[];
}

export interface NormalizeResult {
  notice: NormalizedNotice;
  resolution: FieldResolution;
}

export class NormalizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NormalizeError";
  }
}

/**
 * Walks a dot-path. A `[]` segment fans out over an array, so
 * `lots[].cpv.id` collects the id of every lot.
 */
export function resolvePath(source: unknown, path: string): unknown[] {
  let current: unknown[] = [source];
  for (const segment of path.split(".")) {
    const fanOut = segment.endsWith("[]");
    const key = fanOut ? segment.slice(0, -2) : segment;
    const next: unknown[] = [];
    for (const node of current) {
      if (node === null || typeof node !== "object") continue;
      const value = (node as Record<string, unknown>)[key];
      if (value === undefined || value === null) continue;
      if (fanOut && Array.isArray(value)) next.push(...value);
      else next.push(value);
    }
    current = next;
    if (current.length === 0) return [];
  }
  return current;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function firstNonEmpty(source: unknown, paths: string[]): { value: unknown; path: string } | null {
  for (const path of paths) {
    const hits = resolvePath(source, path).filter((v) => !isEmpty(v));
    if (hits.length === 0) continue;
    return { value: hits.length === 1 ? hits[0] : hits, path };
  }
  return null;
}

export function toText(value: unknown): string | null {
  if (isEmpty(value)) return null;
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(toText).filter((v): v is string => v !== null);
    return parts.length ? parts.join(" ") : null;
  }
  if (typeof value === "object") {
    // eForms multilingual fields look like { "dan": "...", "eng": "..." }.
    // Danish first, then anything else, so we never lose the text entirely.
    const record = value as Record<string, unknown>;
    for (const key of ["dan", "da", "da-DK", "value", "text", "label"]) {
      const candidate = record[key];
      if (!isEmpty(candidate)) return toText(candidate);
    }
    const first = Object.values(record).find((v) => typeof v === "string" && v.trim() !== "");
    return typeof first === "string" ? first.trim() : null;
  }
  return null;
}

/**
 * Amounts stay decimal strings all the way into `numeric` — never through a
 * float (CLAUDE.md rule 6).
 */
export function toDecimalString(value: unknown): string | null {
  if (isEmpty(value)) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return String(value);
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    for (const key of ["amount", "value"]) {
      if (!isEmpty(record[key])) return toDecimalString(record[key]);
    }
    return null;
  }
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s/g, "").replace(/[A-Z]{3}$/i, "");
  // Danish formatting ("1.234.567,89") vs plain decimal ("1234567.89").
  const normalized =
    cleaned.includes(",") && cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  return normalized;
}

/**
 * Date-only values are read as start-of-day in Copenhagen. That under-reports
 * the time left rather than over-reporting it: showing a deadline as earlier
 * than it is can only make us hurry, the opposite mistake loses the bid.
 * Registered as an open question — see docs/aabne-spoergsmaal.md §5.
 */
export function parseTimestamp(value: unknown): Date | null {
  const text = toText(value);
  if (!text) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly) {
    return copenhagenWallTimeToUtc(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]));
  }
  const naive = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (naive) {
    return copenhagenWallTimeToUtc(
      Number(naive[1]),
      Number(naive[2]),
      Number(naive[3]),
      Number(naive[4]),
      Number(naive[5]),
      Number(naive[6] ?? 0),
    );
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** CPV codes are 8 digits, sometimes written with a check digit suffix ("72000000-5"). */
export function normalizeCpv(value: unknown): string | null {
  const text = toText(value);
  if (!text) return null;
  const digits = text.replace(/[^0-9]/g, "");
  if (digits.length < 8) return null;
  return digits.slice(0, 8);
}

function collectCpv(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  const out = new Set<string>();
  for (const entry of values) {
    const direct = normalizeCpv(entry);
    if (direct) {
      out.add(direct);
      continue;
    }
    if (entry && typeof entry === "object") {
      for (const key of ["id", "code", "cpv", "value"]) {
        const nested = normalizeCpv((entry as Record<string, unknown>)[key]);
        if (nested) out.add(nested);
      }
    }
  }
  return [...out];
}

/** Deep-link format from SPEC §3 (verified against udbud.dk by the spec author). */
export function buildSourceUrl(noticeId: string, noticeVersion: string): string {
  const params = new URLSearchParams({ noticeId, noticeVersion });
  return `https://udbud.dk/detaljevisning?${params.toString()}`;
}

/** sha256 over exactly the fields we display, so a re-publish with no changes is a no-op. */
export function contentHashOf(notice: Omit<NormalizedNotice, "contentHash" | "raw">): string {
  const material = JSON.stringify([
    notice.noticeId,
    notice.noticeVersion,
    notice.noticeType,
    notice.title,
    notice.description,
    notice.buyerName,
    notice.buyerId,
    notice.buyerRegion,
    notice.cpvMain,
    [...notice.cpvAll].sort(),
    notice.valueAmount,
    notice.valueCurrency,
    notice.publishedAt?.toISOString() ?? null,
    notice.deadlineAt?.toISOString() ?? null,
    notice.procedureType,
  ]);
  return createHash("sha256").update(material).digest("hex");
}

export function normalizeNotice(raw: unknown, map: NoticeFieldMap = UNVERIFIED_FIELD_MAP): NormalizeResult {
  const resolved: Record<string, string> = {};
  const missing: string[] = [];

  const pick = (field: keyof NoticeFieldMap["fields"]): unknown => {
    const hit = firstNonEmpty(raw, map.fields[field]);
    if (!hit) {
      missing.push(field);
      return null;
    }
    resolved[field] = hit.path;
    return hit.value;
  };

  const noticeId = toText(pick("noticeId"));
  if (!noticeId) {
    throw new NormalizeError(
      "Kunne ikke finde et noticeId i svaret. Ret kandidatstierne i src/lib/udbud/field-map.ts.",
    );
  }
  // A missing version is not fatal: many APIs only expose it on updates. "01"
  // keeps the unique key intact and is visible in `raw` if it turns out wrong.
  const noticeVersion = toText(pick("noticeVersion")) ?? "01";

  const cpvAll = collectCpv(pick("cpvAll"));
  const cpvMain = normalizeCpv(pick("cpvMain")) ?? cpvAll[0] ?? null;
  if (cpvMain && !cpvAll.includes(cpvMain)) cpvAll.unshift(cpvMain);

  const base = {
    noticeId,
    noticeVersion,
    noticeType: toText(pick("noticeType")),
    title: toText(pick("title")),
    description: toText(pick("description")),
    buyerName: toText(pick("buyerName")),
    buyerId: toText(pick("buyerId")),
    buyerRegion: toText(pick("buyerRegion")),
    cpvMain,
    cpvAll,
    valueAmount: toDecimalString(pick("valueAmount")),
    valueCurrency: toText(pick("valueCurrency")),
    publishedAt: parseTimestamp(pick("publishedAt")),
    deadlineAt: parseTimestamp(pick("deadlineAt")),
    procedureType: toText(pick("procedureType")),
    sourceUrl: buildSourceUrl(noticeId, noticeVersion),
  };

  return {
    notice: { ...base, raw, contentHash: contentHashOf(base) },
    resolution: { resolved, missing },
  };
}

/**
 * Aggregate field coverage over a batch. This is the "which fields are actually
 * filled in" answer SPEC §1.4 asks for, computed from real payloads instead of
 * assumed.
 */
export function coverageReport(resolutions: FieldResolution[]): Record<string, { filled: number; total: number; paths: string[] }> {
  const report: Record<string, { filled: number; total: number; paths: string[] }> = {};
  const fields = new Set<string>();
  for (const r of resolutions) {
    Object.keys(r.resolved).forEach((f) => fields.add(f));
    r.missing.forEach((f) => fields.add(f));
  }
  for (const field of fields) {
    const paths = new Set<string>();
    let filled = 0;
    for (const r of resolutions) {
      const path = r.resolved[field];
      if (path) {
        filled += 1;
        paths.add(path);
      }
    }
    report[field] = { filled, total: resolutions.length, paths: [...paths] };
  }
  return report;
}
