import type { Notice } from "@/db/schema";
import { formatCopenhagen } from "@/lib/time";
import { formatAmount } from "@/lib/utils";

export interface FieldChange {
  felt: string;
  foer: string;
  nu: string;
}

type Displayed = Pick<
  Notice,
  | "title"
  | "description"
  | "buyerName"
  | "buyerRegion"
  | "noticeType"
  | "procedureType"
  | "cpvMain"
  | "cpvAll"
  | "valueAmount"
  | "valueCurrency"
  | "publishedAt"
  | "deadlineAt"
>;

/**
 * What actually changed between two versions of the same tender. A new version
 * usually changes one line — showing the whole record again hides it (SPEC §6).
 */
export function diffNotices(previous: Displayed, current: Displayed): FieldChange[] {
  const rows: Array<[string, string, string]> = [
    ["Titel", previous.title ?? "—", current.title ?? "—"],
    ["Beskrivelse", previous.description ?? "—", current.description ?? "—"],
    ["Ordregiver", previous.buyerName ?? "—", current.buyerName ?? "—"],
    ["Region", previous.buyerRegion ?? "—", current.buyerRegion ?? "—"],
    ["Type", previous.noticeType ?? "—", current.noticeType ?? "—"],
    ["Procedure", previous.procedureType ?? "—", current.procedureType ?? "—"],
    ["Hoved-CPV", previous.cpvMain ?? "—", current.cpvMain ?? "—"],
    ["Alle CPV", previous.cpvAll.join(", ") || "—", current.cpvAll.join(", ") || "—"],
    [
      "Anslået værdi",
      formatAmount(previous.valueAmount, previous.valueCurrency),
      formatAmount(current.valueAmount, current.valueCurrency),
    ],
    ["Offentliggjort", formatCopenhagen(previous.publishedAt), formatCopenhagen(current.publishedAt)],
    ["Tilbudsfrist", formatCopenhagen(previous.deadlineAt), formatCopenhagen(current.deadlineAt)],
  ];

  return rows
    .filter(([, foer, nu]) => foer !== nu)
    .map(([felt, foer, nu]) => ({ felt, foer, nu }));
}
