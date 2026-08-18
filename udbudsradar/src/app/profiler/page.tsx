import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { noticeScores, profiles } from "@/db/schema";
import { deleteProfile, rescoreProfileAction, saveProfile } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/field";
import type { Profile } from "@/db/schema";
import { formatCopenhagen } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function ProfilerPage() {
  const db = getDb();
  const rows = await db.select().from(profiles).orderBy(desc(profiles.updatedAt));

  const counts = await db
    .select({ profileId: noticeScores.profileId, antal: sql<number>`count(*)::int`, snit: sql<number>`round(avg(${noticeScores.score}))::int` })
    .from(noticeScores)
    .groupBy(noticeScores.profileId);
  const countByProfile = new Map(counts.map((c) => [c.profileId, c]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Profiler</h1>
        <p className="text-sm text-[var(--color-daempet)]">
          En profil er et sæt filtre plus den beskrivelse AI-scoringen læser. Ændrer du en profil, bumpes dens version, og
          udbud scores forfra med den nye definition.
        </p>
      </div>

      {rows.map((profile) => (
        <Card key={profile.id}>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>{profile.name}</CardTitle>
              <div className="flex items-center gap-2">
                <Badge tone="neutral">version {profile.version}</Badge>
                {countByProfile.get(profile.id) ? (
                  <Badge tone="accent">
                    {countByProfile.get(profile.id)!.antal} scorede · snit {countByProfile.get(profile.id)!.snit}
                  </Badge>
                ) : (
                  <Badge tone="neutral">ingen scoringer endnu</Badge>
                )}
              </div>
            </div>
            <p className="text-xs text-[var(--color-daempet)]">Sidst ændret {formatCopenhagen(profile.updatedAt)}</p>
          </CardHeader>
          <CardContent>
            <ProfileForm profile={profile} />
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--color-kant)] pt-3">
              <form action={rescoreProfileAction}>
                <input type="hidden" name="id" value={profile.id} />
                <input type="hidden" name="days" value="30" />
                <Button type="submit">Genscor de sidste 30 dage</Button>
              </form>
              <form action={deleteProfile} className="ml-auto">
                <input type="hidden" name="id" value={profile.id} />
                <Button type="submit" variant="fare">
                  Slet profil
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Ny profil</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfileForm />
        </CardContent>
      </Card>
    </div>
  );
}

function ProfileForm({ profile }: { profile?: Profile }) {
  return (
    <form action={saveProfile} className="grid gap-3 md:grid-cols-2">
      {profile ? <input type="hidden" name="id" value={profile.id} /> : null}

      <div className="flex flex-col gap-1">
        <Label htmlFor={`name-${profile?.id ?? "ny"}`}>Navn</Label>
        <Input id={`name-${profile?.id ?? "ny"}`} name="name" defaultValue={profile?.name ?? ""} required />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={`minScore-${profile?.id ?? "ny"}`}>Minimum score til digest</Label>
        <Input
          id={`minScore-${profile?.id ?? "ny"}`}
          name="minScoreForDigest"
          type="number"
          min={0}
          max={100}
          defaultValue={profile?.minScoreForDigest ?? 60}
        />
      </div>

      <div className="flex flex-col gap-1 md:col-span-2">
        <Label htmlFor={`description-${profile?.id ?? "ny"}`}>
          Beskrivelse — det er denne tekst AI-scoringen vurderer udbuddene imod
        </Label>
        <Textarea
          id={`description-${profile?.id ?? "ny"}`}
          name="description"
          defaultValue={profile?.description ?? ""}
          placeholder="Hvad laver vi, hvilke opgaver kan vi løse, hvilke referencer har vi, og hvad siger vi nej til?"
        />
      </div>

      <ListField id={profile?.id} name="cpvCodes" label="CPV-koder (komma eller linjeskift)" value={profile?.cpvCodes} />
      <ListField id={profile?.id} name="keywords" label="Nøgleord" value={profile?.keywords} />
      <ListField id={profile?.id} name="excludedKeywords" label="Ekskluderende nøgleord" value={profile?.excludedKeywords} />
      <ListField id={profile?.id} name="regions" label="Regioner" value={profile?.regions} />
      <ListField id={profile?.id} name="noticeTypes" label="Bekendtgørelsestyper" value={profile?.noticeTypes} />
      <ListField id={profile?.id} name="buyerAllowlist" label="Ordregivere vi altid vil se" value={profile?.buyerAllowlist} />
      <ListField id={profile?.id} name="buyerBlocklist" label="Ordregivere vi aldrig vil se" value={profile?.buyerBlocklist} />

      <div className="flex flex-col gap-1">
        <Label htmlFor={`minValue-${profile?.id ?? "ny"}`}>Mindste værdi (DKK)</Label>
        <Input id={`minValue-${profile?.id ?? "ny"}`} name="minValue" defaultValue={profile?.minValue ?? ""} />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={`maxValue-${profile?.id ?? "ny"}`}>Største værdi (DKK)</Label>
        <Input id={`maxValue-${profile?.id ?? "ny"}`} name="maxValue" defaultValue={profile?.maxValue ?? ""} />
      </div>

      <div className="md:col-span-2">
        <Button type="submit" variant="primary">
          {profile ? "Gem ændringer" : "Opret profil"}
        </Button>
      </div>
    </form>
  );
}

function ListField({
  id,
  name,
  label,
  value,
}: {
  id?: string;
  name: string;
  label: string;
  value?: string[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`${name}-${id ?? "ny"}`}>{label}</Label>
      <Input id={`${name}-${id ?? "ny"}`} name={name} defaultValue={(value ?? []).join(", ")} />
    </div>
  );
}
