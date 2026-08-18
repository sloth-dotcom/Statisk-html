import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { noticeScores, noticeStatus, notices, profiles } from "@/db/schema";
import { saveNoticeNote, setNoticeStatus } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/field";
import { DeadlineBadge } from "@/components/radar/deadline";
import { ScoreBadge } from "@/components/radar/score-badge";
import { diffNotices } from "@/lib/radar/diff";
import { cpvLabel } from "@/lib/relevance/codelist";
import { NOTICE_STATUSES } from "@/db/schema";
import { formatCopenhagen } from "@/lib/time";
import { formatAmount } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function NoticeDetailPage({ params }: { params: Promise<{ noticeId: string }> }) {
  const { noticeId: encoded } = await params;
  const noticeId = decodeURIComponent(encoded);
  const db = getDb();

  const versions = await db
    .select()
    .from(notices)
    .where(eq(notices.noticeId, noticeId))
    .orderBy(desc(notices.noticeVersion));

  const current = versions[0];
  if (!current) notFound();

  const [scores, [triage]] = await Promise.all([
    db
      .select({
        score: noticeScores.score,
        reasoning: noticeScores.reasoning,
        fit: noticeScores.fit,
        concerns: noticeScores.concerns,
        matchedCpv: noticeScores.matchedCpv,
        matchedKeywords: noticeScores.matchedKeywords,
        model: noticeScores.model,
        scoredAt: noticeScores.scoredAt,
        profileName: profiles.name,
      })
      .from(noticeScores)
      .innerJoin(profiles, eq(profiles.id, noticeScores.profileId))
      .where(eq(noticeScores.noticeId, current.id))
      .orderBy(desc(noticeScores.score)),
    db.select().from(noticeStatus).where(eq(noticeStatus.noticeId, noticeId)).limit(1),
  ]);

  const previous = versions[1];
  const changes = previous ? diffNotices(previous, current) : [];

  return (
    <div className="space-y-4">
      <Link href="/" className="text-xs text-[var(--color-accent)] hover:underline">
        ← Tilbage til radaren
      </Link>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <CardTitle className="text-lg">{current.title ?? "(uden titel)"}</CardTitle>
            <ScoreBadge score={scores[0]?.score ?? null} />
          </div>
          <p className="text-xs text-[var(--color-daempet)]">
            {current.buyerName ?? "Ordregiver ikke oplyst"}
            {current.buyerId ? ` (CVR ${current.buyerId})` : ""} · version {current.noticeVersion} ·{" "}
            {versions.length} version{versions.length === 1 ? "" : "er"} kendt
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            <DeadlineBadge deadline={current.deadlineAt} />
            <Badge tone="neutral">{formatAmount(current.valueAmount, current.valueCurrency)}</Badge>
            {current.noticeType ? <Badge tone="neutral">{current.noticeType}</Badge> : null}
            {current.procedureType ? <Badge tone="neutral">{current.procedureType}</Badge> : null}
            {current.buyerRegion ? <Badge tone="neutral">{current.buyerRegion}</Badge> : null}
          </div>

          <p className="whitespace-pre-line text-sm">{current.description ?? "Ingen beskrivelse i svaret."}</p>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
            <Fact label="Offentliggjort" value={formatCopenhagen(current.publishedAt)} />
            <Fact label="Tilbudsfrist" value={formatCopenhagen(current.deadlineAt)} />
            <Fact label="Først set" value={formatCopenhagen(current.firstSeenAt)} />
            <Fact label="Sidst set" value={formatCopenhagen(current.lastSeenAt)} />
            <Fact label="Hoved-CPV" value={current.cpvMain ? `${current.cpvMain} — ${cpvLabel(current.cpvMain)}` : "—"} />
            <Fact label="Bekendtgørelses-id" value={`${current.noticeId} / ${current.noticeVersion}`} />
          </dl>

          <div className="flex flex-wrap gap-1.5">
            {current.cpvAll.map((code) => (
              <Badge key={code} tone="accent" title={cpvLabel(code)}>
                {code}
              </Badge>
            ))}
          </div>

          {current.sourceUrl ? (
            <a href={current.sourceUrl} target="_blank" rel="noreferrer" className="inline-block text-sm text-[var(--color-accent)] hover:underline">
              Åbn på udbud.dk ↗
            </a>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Triage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form action={setNoticeStatus} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="noticeId" value={noticeId} />
            <div className="flex flex-col gap-1">
              <Label htmlFor="status">Status</Label>
              <Select id="status" name="status" defaultValue={triage?.status ?? "ny"}>
                {NOTICE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="assignedTo">Ansvarlig</Label>
              <Input id="assignedTo" name="assignedTo" defaultValue={triage?.assignedTo ?? ""} placeholder="fx Michael" />
            </div>
            <Button type="submit" variant="primary">
              Gem status
            </Button>
            <span className="text-xs text-[var(--color-daempet)]">
              {triage ? `Sidst opdateret ${formatCopenhagen(triage.updatedAt)}` : "Ikke triageret endnu"}
            </span>
          </form>

          <form action={saveNoticeNote} className="space-y-2">
            <input type="hidden" name="noticeId" value={noticeId} />
            <Label htmlFor="note">Note</Label>
            <Textarea id="note" name="note" defaultValue={triage?.note ?? ""} placeholder="Hvad skal vi huske om dette udbud?" />
            <Button type="submit">Gem note</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI-vurdering</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {scores.length === 0 ? (
            <p className="text-[var(--color-daempet)]">Ikke scoret endnu. Kør /api/cron/score eller genscor fra profilsiden.</p>
          ) : (
            scores.map((score) => (
              <div key={score.profileName} className="rounded-md border border-[var(--color-kant)] p-3">
                <div className="flex items-center gap-2">
                  <ScoreBadge score={score.score} />
                  <span className="text-sm font-medium">{score.profileName}</span>
                  {score.fit ? <Badge tone="neutral">{score.fit}</Badge> : null}
                  <span className="ml-auto text-xs text-[var(--color-daempet)]">
                    {score.model} · {formatCopenhagen(score.scoredAt)}
                  </span>
                </div>
                <p className="mt-2 text-sm">{score.reasoning}</p>
                {score.concerns.length > 0 ? (
                  <ul className="mt-2 list-inside list-disc text-sm text-[var(--color-daempet)]">
                    {score.concerns.map((concern) => (
                      <li key={concern}>{concern}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {score.matchedCpv.map((code) => (
                    <Badge key={`cpv-${code}`} tone="accent">
                      {code}
                    </Badge>
                  ))}
                  {score.matchedKeywords.map((word) => (
                    <Badge key={`kw-${word}`} tone="groen">
                      {word}
                    </Badge>
                  ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {versions.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Versionshistorik</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="text-sm">
              {versions.map((version) => (
                <li key={version.id} className="flex justify-between border-b border-[var(--color-kant)] py-1 last:border-0">
                  <span>Version {version.noticeVersion}</span>
                  <span className="text-[var(--color-daempet)]">
                    offentliggjort {formatCopenhagen(version.publishedAt)} · først set {formatCopenhagen(version.firstSeenAt)}
                  </span>
                </li>
              ))}
            </ul>

            <div>
              <p className="mb-1 text-sm font-medium">
                Ændringer fra version {previous?.noticeVersion} til {current.noticeVersion}
              </p>
              {changes.length === 0 ? (
                <p className="text-sm text-[var(--color-daempet)]">Ingen ændringer i de felter vi viser.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-[var(--color-daempet)]">
                      <th className="py-1">Felt</th>
                      <th className="py-1">Før</th>
                      <th className="py-1">Nu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changes.map((change) => (
                      <tr key={change.felt} className="border-t border-[var(--color-kant)] align-top">
                        <td className="py-1 pr-2 font-medium">{change.felt}</td>
                        <td className="py-1 pr-2 text-[var(--color-daempet)]">{change.foer}</td>
                        <td className="py-1">{change.nu}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <details className="rounded-lg border border-[var(--color-kant)] bg-white p-3 text-sm">
        <summary className="cursor-pointer text-[var(--color-daempet)]">Rå API-svar</summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded bg-[var(--color-flade)] p-3 text-xs">
          {JSON.stringify(current.raw, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-daempet)]">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
