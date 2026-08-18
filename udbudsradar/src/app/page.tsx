import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Filters } from "@/components/radar/filters";
import { NoticeCard } from "@/components/radar/notice-card";
import { filterOptions, listProfiles, listRadar } from "@/lib/radar/query";
import { buildQueryString, parseRadarParams, type SearchParams } from "@/lib/radar/params";
import { lastIngestRun } from "@/lib/status";
import { formatCopenhagen } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function RadarPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const filters = parseRadarParams(params);

  const [profiles, options, { rows, total }, ingest] = await Promise.all([
    listProfiles(),
    filterOptions(),
    listRadar(filters),
    lastIngestRun(),
  ]);

  const pageSize = 25;
  const page = filters.page ?? 1;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Radar</h1>
        <p className="text-xs text-[var(--color-daempet)]">
          {total} udbud matcher · sidste hentning {ingest ? formatCopenhagen(ingest.startedAt) : "aldrig"}
        </p>
      </div>

      <Filters profiles={profiles} regions={options.regions} noticeTypes={options.noticeTypes} current={filters} />

      {rows.length === 0 ? <EmptyState ingest={ingest} /> : null}

      <div className="grid gap-3">
        {rows.map((row) => (
          <NoticeCard key={row.id} row={row} />
        ))}
      </div>

      {lastPage > 1 ? (
        <div className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link className="text-[var(--color-accent)] hover:underline" href={buildQueryString(params, { side: String(page - 1) })}>
              ← Forrige
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs text-[var(--color-daempet)]">
            Side {page} af {lastPage}
          </span>
          {page < lastPage ? (
            <Link className="text-[var(--color-accent)] hover:underline" href={buildQueryString(params, { side: String(page + 1) })}>
              Næste →
            </Link>
          ) : (
            <span />
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * "Ingen resultater" is ambiguous when the pipeline has stopped, so the empty
 * state always says when ingest last ran and how it went (SPEC §6).
 */
function EmptyState({ ingest }: { ingest: Awaited<ReturnType<typeof lastIngestRun>> }) {
  return (
    <Card className="p-6 text-sm">
      <p className="font-medium">Ingen udbud matcher filtrene.</p>
      {ingest ? (
        <p className="mt-2 text-[var(--color-daempet)]">
          Pipelinen kørte sidst {formatCopenhagen(ingest.startedAt)} med status <strong>{ingest.status}</strong> — {ingest.noticesSeen} set,{" "}
          {ingest.noticesNew} nye. <Link className="text-[var(--color-accent)] hover:underline" href="/status">Se driftsstatus</Link>.
        </p>
      ) : (
        <p className="mt-2 text-[var(--color-daempet)]">
          Ingest har aldrig kørt. Kald <code>/api/cron/ingest</code> med <code>CRON_SECRET</code>, eller se{" "}
          <Link className="text-[var(--color-accent)] hover:underline" href="/status">driftssiden</Link>.
        </p>
      )}
    </Card>
  );
}
