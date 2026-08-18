import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/field";
import type { Profile } from "@/db/schema";
import type { RadarFilters } from "@/lib/radar/query";

/**
 * A plain GET form: every filter ends up in the URL, so a search can be pasted
 * into Slack and opened by someone else (SPEC §6). No client-side state.
 */
export function Filters({
  profiles,
  regions,
  noticeTypes,
  current,
}: {
  profiles: Profile[];
  regions: string[];
  noticeTypes: string[];
  current: RadarFilters;
}) {
  const toDateValue = (date: Date | undefined) => (date ? date.toISOString().slice(0, 10) : "");

  return (
    <Card className="p-4">
      <form method="get" action="/" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="col-span-2 flex flex-col gap-1 md:col-span-2">
          <Label htmlFor="q">Fritekst</Label>
          <Input id="q" name="q" defaultValue={current.query ?? ""} placeholder="fx rengøring eller &quot;drift og vedligehold&quot;" />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="profil">Profil</Label>
          <Select id="profil" name="profil" defaultValue={current.profileId ?? ""}>
            <option value="">Alle profiler</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="minScore">Minimum score</Label>
          <Input id="minScore" name="minScore" type="number" min={0} max={100} defaultValue={current.minScore ?? ""} />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="region">Region</Label>
          <Select id="region" name="region" defaultValue={current.region ?? ""}>
            <option value="">Alle regioner</option>
            {regions.map((region) => (
              <option key={region} value={region}>
                {region}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="ordregiver">Ordregiver</Label>
          <Input id="ordregiver" name="ordregiver" defaultValue={current.buyer ?? ""} placeholder="fx Aarhus Kommune" />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="type">Type</Label>
          <Select id="type" name="type" defaultValue={current.noticeType ?? ""}>
            <option value="">Alle typer</option>
            {noticeTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="visning">Visning</Label>
          <Select id="visning" name="visning" defaultValue={current.visning ?? "aabne"}>
            <option value="aabne">Ikke afviste</option>
            <option value="afviste">Kun afviste</option>
            <option value="alle">Alle</option>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="fra">Offentliggjort fra</Label>
          <Input id="fra" name="fra" type="date" defaultValue={toDateValue(current.from)} />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="til">Offentliggjort til</Label>
          <Input id="til" name="til" type="date" defaultValue={toDateValue(current.to)} />
        </div>

        <div className="col-span-2 flex items-end gap-2 md:col-span-4">
          <Button type="submit" variant="primary">
            Filtrér
          </Button>
          <Link href="/" className="text-xs text-[var(--color-daempet)] hover:underline">
            Nulstil
          </Link>
          <label className="ml-auto flex items-center gap-2 text-xs text-[var(--color-daempet)]">
            <input type="checkbox" name="udloebne" value="1" defaultChecked={current.includeExpired ?? false} />
            Vis udbud med overskredet frist
          </label>
        </div>
      </form>
    </Card>
  );
}
