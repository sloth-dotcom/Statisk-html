import { describe, expect, it } from "vitest";
import { cpvMatches, cpvPrefixes, matchingCpvCodes, significantPrefix } from "../src/lib/relevance/cpv";
import { evaluateNotice, isScoringCandidate, type EvaluatableNotice, type EvaluatableProfile } from "../src/lib/relevance/evaluate";

describe("significantPrefix", () => {
  it("keeps only the meaningful digits", () => {
    expect(significantPrefix("72000000")).toBe("72");
    expect(significantPrefix("72212000")).toBe("72212");
    expect(significantPrefix("30200000-1")).toBe("302");
  });
});

describe("cpvMatches", () => {
  it("matches down the hierarchy", () => {
    expect(cpvMatches("72000000", "72212000")).toBe(true);
    expect(cpvMatches("72000000", "72000000")).toBe(true);
  });

  it("does not match up the hierarchy", () => {
    expect(cpvMatches("72212000", "72000000")).toBe(false);
  });

  it("does not match a sibling branch", () => {
    expect(cpvMatches("72000000", "45000000")).toBe(false);
    expect(cpvMatches("72212000", "72213000")).toBe(false);
  });

  it("ignores the check digit", () => {
    expect(cpvMatches("72000000-1", "72212000-8")).toBe(true);
  });

  it("rejects junk instead of matching everything", () => {
    expect(cpvMatches("", "72212000")).toBe(false);
    expect(cpvMatches("72000000", "n/a")).toBe(false);
  });
});

describe("matchingCpvCodes", () => {
  it("returns the notice codes covered by the profile", () => {
    expect(matchingCpvCodes(["72000000"], ["72212000-8", "45000000", "72600000"])).toEqual(["72212000", "72600000"]);
  });

  it("returns nothing when the profile has no codes", () => {
    expect(matchingCpvCodes([], ["72212000"])).toEqual([]);
  });
});

describe("cpvPrefixes", () => {
  it("drops unusable entries", () => {
    expect(cpvPrefixes(["72000000", "x", "48000000"])).toEqual(["72", "48"]);
  });
});

const baseNotice: EvaluatableNotice = {
  noticeType: "udbudsbekendtgoerelse",
  buyerName: "Aarhus Kommune",
  buyerRegion: "Region Midtjylland",
  cpvAll: ["72212000", "72600000"],
  cpvMain: "72212000",
  valueAmount: "5000000",
  deadlineAt: new Date("2026-12-01T10:00:00Z"),
  title: "Udbud af drift og support",
  description: "Rammeaftale om drift, support og udrulning af arbejdspladser.",
};

const baseProfile: EvaluatableProfile = {
  cpvCodes: ["72000000"],
  keywords: ["drift", "support"],
  excludedKeywords: ["rengøring"],
  regions: [],
  noticeTypes: [],
  buyerAllowlist: [],
  buyerBlocklist: [],
  minValue: null,
  maxValue: null,
};

const now = new Date("2026-08-18T12:00:00Z");

describe("evaluateNotice — lag 1 hårde filtre", () => {
  it("passes a notice that fits", () => {
    const verdict = evaluateNotice(baseNotice, baseProfile, now);
    expect(verdict.passes).toBe(true);
    expect(verdict.rejections).toEqual([]);
  });

  it("rejects a region outside the profile", () => {
    const verdict = evaluateNotice(baseNotice, { ...baseProfile, regions: ["Region Hovedstaden"] }, now);
    expect(verdict.passes).toBe(false);
    expect(verdict.rejections).toContain("Uden for profilens regioner");
  });

  it("rejects a blocked buyer", () => {
    const verdict = evaluateNotice(baseNotice, { ...baseProfile, buyerBlocklist: ["aarhus kommune"] }, now);
    expect(verdict.rejections).toContain("Ordregiver står på blokeringslisten");
  });

  it("rejects a buyer missing from a non-empty allowlist", () => {
    const verdict = evaluateNotice(baseNotice, { ...baseProfile, buyerAllowlist: ["Københavns Kommune"] }, now);
    expect(verdict.rejections).toContain("Ordregiver står ikke på tilladelseslisten");
  });

  it("rejects values outside the interval", () => {
    expect(evaluateNotice(baseNotice, { ...baseProfile, minValue: "10000000" }, now).rejections).toContain(
      "Under profilens minimumsværdi",
    );
    expect(evaluateNotice(baseNotice, { ...baseProfile, maxValue: "1000000" }, now).rejections).toContain(
      "Over profilens maksimumsværdi",
    );
  });

  it("keeps a notice whose value is unknown rather than guessing it away", () => {
    const verdict = evaluateNotice({ ...baseNotice, valueAmount: null }, { ...baseProfile, minValue: "10000000" }, now);
    expect(verdict.passes).toBe(true);
  });

  it("rejects a deadline that has passed", () => {
    const verdict = evaluateNotice({ ...baseNotice, deadlineAt: new Date("2026-08-01T00:00:00Z") }, baseProfile, now);
    expect(verdict.rejections).toContain("Tilbudsfristen er overskredet");
  });
});

describe("evaluateNotice — lag 2 og 3", () => {
  it("scores CPV match plus keywords", () => {
    const verdict = evaluateNotice(baseNotice, baseProfile, now);
    expect(verdict.matchedCpv).toEqual(["72212000", "72600000"]);
    expect(verdict.matchedKeywords).toEqual(["drift", "support"]);
    expect(verdict.baseScore).toBeGreaterThan(60);
  });

  it("gives no CPV points when nothing matches", () => {
    const verdict = evaluateNotice({ ...baseNotice, cpvAll: ["45000000"], cpvMain: "45000000" }, baseProfile, now);
    expect(verdict.matchedCpv).toEqual([]);
    expect(verdict.baseScore).toBeLessThan(50);
  });

  it("subtracts for excluded keywords and drops the notice as a candidate", () => {
    const notice = { ...baseNotice, description: "Rammeaftale om rengøring af kontorer." };
    const verdict = evaluateNotice(notice, baseProfile, now);
    expect(verdict.excludedKeywords).toEqual(["rengøring"]);
    expect(isScoringCandidate(verdict)).toBe(false);
  });

  it("matches whole words only", () => {
    const notice = { ...baseNotice, title: "Driftsherreudbud", description: "Ingen supportydelser." };
    const verdict = evaluateNotice(notice, baseProfile, now);
    expect(verdict.matchedKeywords).toEqual([]);
  });

  it("is case and diacritic exact for danish keywords", () => {
    const notice = { ...baseNotice, description: "Aftale om Rengøring" };
    const verdict = evaluateNotice(notice, baseProfile, now);
    expect(verdict.excludedKeywords).toEqual(["rengøring"]);
  });
});

describe("isScoringCandidate", () => {
  it("only lets through what survived layers 1-3", () => {
    expect(isScoringCandidate(evaluateNotice(baseNotice, baseProfile, now))).toBe(true);
    expect(
      isScoringCandidate(evaluateNotice(baseNotice, { ...baseProfile, regions: ["Region Nordjylland"] }, now)),
    ).toBe(false);
    expect(
      isScoringCandidate(
        evaluateNotice({ ...baseNotice, cpvAll: ["45000000"], title: "x", description: "y" }, baseProfile, now),
      ),
    ).toBe(false);
  });
});
