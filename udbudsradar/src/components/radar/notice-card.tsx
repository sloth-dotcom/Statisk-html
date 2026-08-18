import Link from "next/link";
import { setNoticeStatus } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { DeadlineBadge } from "./deadline";
import { ScoreBadge } from "./score-badge";
import { cpvLabel } from "@/lib/relevance/codelist";
import type { RadarRow } from "@/lib/radar/query";
import { formatAmount } from "@/lib/utils";
import { formatDateCopenhagen } from "@/lib/time";

const statusLabels: Record<string, string> = {
  ny: "Ny",
  interessant: "Interessant",
  i_gang: "I gang",
  afvist: "Afvist",
  budt: "Budt",
};

export function NoticeCard({ row }: { row: RadarRow }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle>
            <Link href={`/udbud/${encodeURIComponent(row.noticeId)}`} className="hover:text-[var(--color-accent)]">
              {row.title ?? "(uden titel)"}
            </Link>
          </CardTitle>
          <ScoreBadge score={row.score} />
        </div>
        <p className="text-xs text-[var(--color-daempet)]">
          {row.buyerName ?? "Ordregiver ikke oplyst"}
          {row.buyerRegion ? ` · ${row.buyerRegion}` : ""}
          {row.publishedAt ? ` · offentliggjort ${formatDateCopenhagen(row.publishedAt)}` : ""}
        </p>
      </CardHeader>

      <CardContent className="space-y-2">
        {row.reasoning ? (
          <p className="line-clamp-2 text-[var(--color-tekst)]">{row.reasoning}</p>
        ) : (
          <p className="text-[var(--color-daempet)]">Ingen AI-begrundelse endnu.</p>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <DeadlineBadge deadline={row.deadlineAt} />
          <Badge tone="neutral">{formatAmount(row.valueAmount, row.valueCurrency)}</Badge>
          {row.noticeType ? <Badge tone="neutral">{row.noticeType}</Badge> : null}
          {row.status && row.status !== "ny" ? (
            <Badge tone={row.status === "afvist" ? "roed" : "accent"}>{statusLabels[row.status] ?? row.status}</Badge>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {row.cpvAll.slice(0, 6).map((code) => (
            <Badge key={code} tone="accent" title={cpvLabel(code)}>
              {code}
            </Badge>
          ))}
          {row.cpvAll.length > 6 ? <Badge tone="neutral">+{row.cpvAll.length - 6}</Badge> : null}
        </div>
      </CardContent>

      <CardFooter>
        <form action={setNoticeStatus}>
          <input type="hidden" name="noticeId" value={row.noticeId} />
          <input type="hidden" name="status" value="interessant" />
          <Button type="submit" variant="medhold" size="sm">
            Interessant
          </Button>
        </form>
        <form action={setNoticeStatus}>
          <input type="hidden" name="noticeId" value={row.noticeId} />
          <input type="hidden" name="status" value="afvist" />
          <Button type="submit" variant="fare" size="sm">
            Afvist
          </Button>
        </form>
        <Link
          href={`/udbud/${encodeURIComponent(row.noticeId)}`}
          className="ml-auto text-xs text-[var(--color-accent)] hover:underline"
        >
          Detaljer
        </Link>
        {row.sourceUrl ? (
          <a href={row.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-[var(--color-daempet)] hover:underline">
            udbud.dk ↗
          </a>
        ) : null}
      </CardFooter>
    </Card>
  );
}
