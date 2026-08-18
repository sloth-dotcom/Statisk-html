import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ingestIsDown,
  lastSuccessfulIngest,
  noticeCounts,
  recentDigestRuns,
  recentIngestRuns,
  recentScoringRuns,
  tokenUsage,
} from "@/lib/status";
import { formatCopenhagen } from "@/lib/time";
import { UNVERIFIED_FIELD_MAP } from "@/lib/udbud/field-map";

export const dynamic = "force-dynamic";

const statusTone = (status: string) => (status === "ok" ? "groen" : status === "fejlet" ? "roed" : "gul");

export default async function StatusPage() {
  const [ingestRuns, scoringRuns, digestRuns, counts, tokens, down, lastOk] = await Promise.all([
    recentIngestRuns(15),
    recentScoringRuns(10),
    recentDigestRuns(10),
    noticeCounts(),
    tokenUsage(30),
    ingestIsDown(),
    lastSuccessfulIngest(),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Drift</h1>

      {down ? (
        <Card className="border-[var(--color-roed)] bg-[var(--color-roed-svag)] p-4 text-sm">
          <strong>Ingest er fejlet to kørsler i træk.</strong> Alarmen er sendt på de kanaler der er konfigureret. Sidste
          succesfulde kørsel: {lastOk ? formatCopenhagen(lastOk.finishedAt) : "ingen"}.
        </Card>
      ) : null}

      {!UNVERIFIED_FIELD_MAP.verified ? (
        <Card className="border-[var(--color-gul)] bg-[var(--color-gul-svag)] p-4 text-sm">
          <strong>Feltmapningen mod udbud.dk er ikke verificeret.</strong> Kolonnerne udfyldes ud fra kandidatstier i{" "}
          <code>src/lib/udbud/field-map.ts</code>. Kør <code>npm run probe</code> mod det rigtige API, ret stierne, og sæt{" "}
          <code>verified: true</code>. Se <code>docs/api-noter.md</code>.
        </Card>
      ) : null}

      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Bekendtgørelser i basen" value={counts.total.toLocaleString("da-DK")} />
        <Stat label="Med åben frist" value={counts.open.toLocaleString("da-DK")} />
        <Stat label="AI-scoringer" value={counts.scored.toLocaleString("da-DK")} />
        <Stat
          label={`Tokens (${tokens.days} dage)`}
          value={`${tokens.input.toLocaleString("da-DK")} ind / ${tokens.output.toLocaleString("da-DK")} ud`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Hentninger</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--color-daempet)]">
                <th className="py-1">Start</th>
                <th>Status</th>
                <th>Set</th>
                <th>Nye</th>
                <th>Opdaterede</th>
                <th>API-kald</th>
                <th>Fejl</th>
              </tr>
            </thead>
            <tbody>
              {ingestRuns.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-2 text-[var(--color-daempet)]">
                    Ingest har aldrig kørt.
                  </td>
                </tr>
              ) : (
                ingestRuns.map((run) => {
                  const errors = Array.isArray(run.errors) ? run.errors : [];
                  return (
                    <tr key={run.id} className="border-t border-[var(--color-kant)]">
                      <td className="py-1">{formatCopenhagen(run.startedAt)}</td>
                      <td>
                        <Badge tone={statusTone(run.status)}>{run.status}</Badge>
                      </td>
                      <td>{run.noticesSeen}</td>
                      <td>{run.noticesNew}</td>
                      <td>{run.noticesUpdated}</td>
                      <td>{run.apiRequests}</td>
                      <td className="max-w-72 truncate" title={JSON.stringify(errors)}>
                        {errors.length === 0 ? "—" : `${errors.length}: ${JSON.stringify(errors[0]).slice(0, 80)}`}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI-scoring og forbrug</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--color-daempet)]">
                <th className="py-1">Start</th>
                <th>Status</th>
                <th>Model</th>
                <th>Kandidater</th>
                <th>Scorede</th>
                <th>Tokens ind</th>
                <th>Tokens ud</th>
              </tr>
            </thead>
            <tbody>
              {scoringRuns.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-2 text-[var(--color-daempet)]">
                    Scoring har aldrig kørt.
                  </td>
                </tr>
              ) : (
                scoringRuns.map((run) => (
                  <tr key={run.id} className="border-t border-[var(--color-kant)]">
                    <td className="py-1">{formatCopenhagen(run.startedAt)}</td>
                    <td>
                      <Badge tone={statusTone(run.status)}>{run.status}</Badge>
                    </td>
                    <td>{run.model}</td>
                    <td>{run.candidates}</td>
                    <td>{run.noticesScored}</td>
                    <td>{run.inputTokens.toLocaleString("da-DK")}</td>
                    <td>{run.outputTokens.toLocaleString("da-DK")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Digest</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--color-daempet)]">
                <th className="py-1">Start</th>
                <th>Type</th>
                <th>Status</th>
                <th>Poster</th>
                <th>Modtagere</th>
              </tr>
            </thead>
            <tbody>
              {digestRuns.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-2 text-[var(--color-daempet)]">
                    Der er ikke sendt nogen digest endnu.
                  </td>
                </tr>
              ) : (
                digestRuns.map((run) => (
                  <tr key={run.id} className="border-t border-[var(--color-kant)]">
                    <td className="py-1">{formatCopenhagen(run.startedAt)}</td>
                    <td>{run.kind}</td>
                    <td>
                      <Badge tone={statusTone(run.status)}>{run.status}</Badge>
                    </td>
                    <td>{run.itemCount}</td>
                    <td>{run.recipients.length}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-[var(--color-daempet)]">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </Card>
  );
}
