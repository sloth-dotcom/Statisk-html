/**
 * CPV is hierarchical: 72000000 (it-tjenester) covers 72212000. Matching is
 * therefore a prefix test on the significant digits, not string equality
 * (SPEC §5, lag 2).
 *
 * The significant part of a code is what remains when the trailing structural
 * zeros are removed — never fewer than the two-digit division, so "72000000"
 * narrows to "72" and "72212000" to "72212".
 */
export function normalizeCpvCode(code: string): string | null {
  const digits = code.replace(/[^0-9]/g, "");
  if (digits.length < 2) return null;
  return digits.slice(0, 8).padEnd(8, "0");
}

export function significantPrefix(code: string): string | null {
  const normalized = normalizeCpvCode(code);
  if (!normalized) return null;
  const trimmed = normalized.replace(/0+$/, "");
  return trimmed.length < 2 ? normalized.slice(0, 2) : trimmed;
}

/** True when `noticeCode` sits inside the branch named by `profileCode`. */
export function cpvMatches(profileCode: string, noticeCode: string): boolean {
  const prefix = significantPrefix(profileCode);
  const candidate = normalizeCpvCode(noticeCode);
  if (!prefix || !candidate) return false;
  return candidate.startsWith(prefix);
}

/** Every notice code covered by at least one of the profile's codes. */
export function matchingCpvCodes(profileCodes: string[], noticeCodes: string[]): string[] {
  const hits = new Set<string>();
  for (const noticeCode of noticeCodes) {
    for (const profileCode of profileCodes) {
      if (cpvMatches(profileCode, noticeCode)) {
        const normalized = normalizeCpvCode(noticeCode);
        if (normalized) hits.add(normalized);
        break;
      }
    }
  }
  return [...hits];
}

/** The prefixes to use in a SQL `like` predicate for the same rule. */
export function cpvPrefixes(profileCodes: string[]): string[] {
  return profileCodes.map(significantPrefix).filter((p): p is string => p !== null);
}
