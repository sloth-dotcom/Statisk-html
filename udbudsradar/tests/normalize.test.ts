import { describe, expect, it } from "vitest";
import fixture from "./fixtures/synthetic-notice.json";
import {
  buildSourceUrl,
  contentHashOf,
  coverageReport,
  normalizeCpv,
  normalizeNotice,
  parseTimestamp,
  resolvePath,
  toDecimalString,
  toText,
} from "../src/lib/udbud/normalize";

describe("resolvePath", () => {
  it("walks nested objects", () => {
    expect(resolvePath({ a: { b: { c: 1 } } }, "a.b.c")).toEqual([1]);
  });

  it("fans out over arrays with []", () => {
    const source = { lots: [{ cpv: { id: "72000000" } }, { cpv: { id: "48000000" } }] };
    expect(resolvePath(source, "lots[].cpv.id")).toEqual(["72000000", "48000000"]);
  });

  it("returns nothing for a missing branch instead of throwing", () => {
    expect(resolvePath({ a: 1 }, "b.c.d")).toEqual([]);
  });
});

describe("toText", () => {
  it("prefers the danish variant of a multilingual field", () => {
    expect(toText({ eng: "Cleaning services", dan: "Rengøringsydelser" })).toBe("Rengøringsydelser");
  });

  it("falls back to any language rather than losing the text", () => {
    expect(toText({ eng: "Cleaning services" })).toBe("Cleaning services");
  });

  it("treats blank strings as absent", () => {
    expect(toText("   ")).toBeNull();
  });
});

describe("toDecimalString", () => {
  it("keeps precision as a string, never a float", () => {
    expect(toDecimalString("48.500.000,00")).toBe("48500000.00");
    expect(toDecimalString("1234567.89")).toBe("1234567.89");
    expect(toDecimalString({ amount: "2500000", currency: "DKK" })).toBe("2500000");
  });

  it("rejects values it cannot read rather than guessing zero", () => {
    expect(toDecimalString("efter aftale")).toBeNull();
    expect(toDecimalString(null)).toBeNull();
  });
});

describe("parseTimestamp", () => {
  it("keeps an explicit offset", () => {
    expect(parseTimestamp("2026-08-14T09:00:00+02:00")?.toISOString()).toBe("2026-08-14T07:00:00.000Z");
  });

  it("reads a date-only deadline as start of day in Copenhagen (summer time)", () => {
    expect(parseTimestamp("2026-09-30")?.toISOString()).toBe("2026-09-29T22:00:00.000Z");
  });

  it("reads a date-only deadline correctly outside summer time", () => {
    expect(parseTimestamp("2026-12-01")?.toISOString()).toBe("2026-11-30T23:00:00.000Z");
  });

  it("reads a naive wall-clock time as Copenhagen time", () => {
    expect(parseTimestamp("2026-09-30T12:00:00")?.toISOString()).toBe("2026-09-30T10:00:00.000Z");
  });
});

describe("normalizeCpv", () => {
  it("strips the check digit and keeps eight digits", () => {
    expect(normalizeCpv("72200000-7")).toBe("72200000");
  });

  it("rejects anything shorter than a CPV code", () => {
    expect(normalizeCpv("722")).toBeNull();
  });
});

describe("normalizeNotice", () => {
  it("maps a payload and reports which paths it used", () => {
    const { notice, resolution } = normalizeNotice(fixture);
    expect(notice.noticeId).toBe("2026-000123");
    expect(notice.noticeVersion).toBe("01");
    expect(notice.title).toBe("Udbud af drift og vedligehold af kommunens it-arbejdspladser");
    expect(notice.buyerName).toBe("Aarhus Kommune");
    expect(notice.buyerId).toBe("55133018");
    expect(notice.cpvMain).toBe("72200000");
    expect(notice.cpvAll).toContain("30200000");
    expect(notice.valueAmount).toBe("48500000.00");
    expect(notice.valueCurrency).toBe("DKK");
    expect(notice.sourceUrl).toBe(
      "https://udbud.dk/detaljevisning?noticeId=2026-000123&noticeVersion=01",
    );
    expect(resolution.resolved.buyerName).toBe("buyer.name");
    expect(resolution.resolved.deadlineAt).toBe("tenderPeriod.endDate");
  });

  it("keeps the raw payload untouched", () => {
    const { notice } = normalizeNotice(fixture);
    expect(notice.raw).toBe(fixture);
  });

  it("defaults the version instead of dropping a notice without one", () => {
    const { notice, resolution } = normalizeNotice({ noticeId: "abc", title: "Test" });
    expect(notice.noticeVersion).toBe("01");
    expect(resolution.missing).toContain("noticeVersion");
  });

  it("throws when there is no id at all — that notice cannot be deduplicated", () => {
    expect(() => normalizeNotice({ title: "Uden id" })).toThrow(/noticeId/);
  });
});

describe("contentHashOf", () => {
  it("is stable across cpv ordering but changes when a shown field changes", () => {
    const { notice } = normalizeNotice(fixture);
    const reordered = { ...notice, cpvAll: [...notice.cpvAll].reverse() };
    expect(contentHashOf(reordered)).toBe(notice.contentHash);
    expect(contentHashOf({ ...notice, title: "Andet" })).not.toBe(notice.contentHash);
  });
});

describe("coverageReport", () => {
  it("counts how often each field was actually filled", () => {
    const report = coverageReport([
      { resolved: { title: "title", buyerName: "buyer.name" }, missing: ["deadlineAt"] },
      { resolved: { title: "title" }, missing: ["buyerName", "deadlineAt"] },
    ]);
    expect(report.title).toEqual({ filled: 2, total: 2, paths: ["title"] });
    expect(report.buyerName?.filled).toBe(1);
    expect(report.deadlineAt?.filled).toBe(0);
  });
});

describe("buildSourceUrl", () => {
  it("encodes ids that need it", () => {
    expect(buildSourceUrl("2026/123", "01")).toBe(
      "https://udbud.dk/detaljevisning?noticeId=2026%2F123&noticeVersion=01",
    );
  });
});
