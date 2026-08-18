import type { Notice, Profile } from "@/db/schema";
import { matchingCpvCodes } from "./cpv";

export interface RelevanceVerdict {
  /** False when the notice fails layer 1 and must never reach the AI. */
  passes: boolean;
  /** Why it was rejected, in Danish, for display on the notice. */
  rejections: string[];
  matchedCpv: string[];
  matchedKeywords: string[];
  excludedKeywords: string[];
  /** Deterministic 0-100 pre-score from layers 2-3, before any AI call. */
  baseScore: number;
}

export type EvaluatableNotice = Pick<
  Notice,
  | "noticeType"
  | "buyerName"
  | "buyerRegion"
  | "cpvAll"
  | "cpvMain"
  | "valueAmount"
  | "deadlineAt"
  | "title"
  | "description"
>;

export type EvaluatableProfile = Pick<
  Profile,
  | "cpvCodes"
  | "keywords"
  | "excludedKeywords"
  | "regions"
  | "noticeTypes"
  | "buyerAllowlist"
  | "buyerBlocklist"
  | "minValue"
  | "maxValue"
>;

function containsWord(haystack: string, needle: string): boolean {
  const term = needle.trim().toLowerCase();
  if (!term) return false;
  // Whole-word match so "it" does not fire inside "fritidstilbud".
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "iu").test(haystack);
}

function includesInsensitive(list: string[], value: string | null): boolean {
  if (!value) return false;
  const lowered = value.toLowerCase();
  return list.some((entry) => entry.trim() !== "" && lowered.includes(entry.trim().toLowerCase()));
}

/**
 * Layers 1-3 from SPEC §5: hard filters, then CPV, then keywords. Deterministic
 * and free — only what survives this is worth paying an AI to read.
 */
export function evaluateNotice(
  notice: EvaluatableNotice,
  profile: EvaluatableProfile,
  now: Date = new Date(),
): RelevanceVerdict {
  const rejections: string[] = [];

  if (profile.regions.length > 0 && !includesInsensitive(profile.regions, notice.buyerRegion)) {
    rejections.push("Uden for profilens regioner");
  }
  if (profile.noticeTypes.length > 0 && !includesInsensitive(profile.noticeTypes, notice.noticeType)) {
    rejections.push("Bekendtgørelsestypen er fravalgt");
  }
  if (profile.buyerBlocklist.length > 0 && includesInsensitive(profile.buyerBlocklist, notice.buyerName)) {
    rejections.push("Ordregiver står på blokeringslisten");
  }
  if (profile.buyerAllowlist.length > 0 && !includesInsensitive(profile.buyerAllowlist, notice.buyerName)) {
    rejections.push("Ordregiver står ikke på tilladelseslisten");
  }

  const amount = notice.valueAmount === null ? null : Number(notice.valueAmount);
  if (amount !== null && Number.isFinite(amount)) {
    if (profile.minValue !== null && amount < Number(profile.minValue)) {
      rejections.push("Under profilens minimumsværdi");
    }
    if (profile.maxValue !== null && amount > Number(profile.maxValue)) {
      rejections.push("Over profilens maksimumsværdi");
    }
  }

  if (notice.deadlineAt && notice.deadlineAt.getTime() < now.getTime()) {
    rejections.push("Tilbudsfristen er overskredet");
  }

  const matchedCpv = matchingCpvCodes(profile.cpvCodes, notice.cpvAll);
  const haystack = `${notice.title ?? ""} ${notice.description ?? ""}`;
  const matchedKeywords = profile.keywords.filter((kw) => containsWord(haystack, kw));
  const excludedKeywords = profile.excludedKeywords.filter((kw) => containsWord(haystack, kw));

  // Layer 2 weighs heaviest, layer 3 adds, exclusions bite.
  let baseScore = 0;
  if (profile.cpvCodes.length === 0) baseScore += 25;
  else if (matchedCpv.length > 0) baseScore += Math.min(50, 30 + matchedCpv.length * 10);
  baseScore += Math.min(40, matchedKeywords.length * 15);
  baseScore -= excludedKeywords.length * 25;
  baseScore = Math.max(0, Math.min(100, baseScore));

  return {
    passes: rejections.length === 0,
    rejections,
    matchedCpv,
    matchedKeywords,
    excludedKeywords,
    baseScore,
  };
}

/** Candidates for AI scoring: passed layer 1 and showed some layer 2-3 signal. */
export function isScoringCandidate(verdict: RelevanceVerdict): boolean {
  return verdict.passes && verdict.baseScore > 0 && verdict.excludedKeywords.length === 0;
}
