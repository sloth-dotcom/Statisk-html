# Udbudsradar

Internt værktøj: henter udbud fra udbud.dk, scorer dem mod vores firmaprofiler og
sender en daglig digest med det der er værd at kigge på. Bygget efter `SPEC.md`
og `CLAUDE.md` i repoets rod.

Ikke offentligt, ingen login, ingen kundekonti. Al UI-tekst er dansk; kode,
kommentarer og commits er engelske.

## Vigtigt før idriftsættelse

**Feltmapningen mod udbud.dk er ikke verificeret.** Fase 0 (API-research) kunne
ikke gennemføres i det miljø koden er bygget i — `git.erst.dk` og `udbud.dk` er
begge blokeret af egress-policyen. Alt hvad koden ved om API'et står som
kandidatstier i `src/lib/udbud/field-map.ts`, markeret `verified: false`.

Læs `docs/api-noter.md` før du peger appen mod det rigtige API. Kort udgave:

```bash
UDBUD_API_BASE_URL=... UDBUD_API_KEY=... npm run probe   # gemmer rå svar + feltdækning
# ret src/lib/udbud/field-map.ts efter tabellen, sæt verified: true
npm run codelists                                        # CPV-labels fra SDK-repoet
```

Så længe mapningen er uverificeret, viser `/status` en advarsel, og hver
ingest-kørsel rapporterer hvilke felter der reelt blev udfyldt.

## Kom i gang

```bash
cp .env.example .env          # udfyld DATABASE_URL, CRON_SECRET, ANTHROPIC_API_KEY
npm install
npm run db:migrate
npm run seed                  # opretter én tom profil
npm run dev
```

Kræver Postgres 16+ med `danish`-konfiguration til fuldtekstsøgning (følger med
standardinstallationen).

## Kommandoer

| Kommando | Hvad den gør |
|---|---|
| `npm run dev` | udviklingsserver |
| `npm run build` | produktionsbuild |
| `npm run lint` | ESLint |
| `npm test` | Vitest — enhedstest + integrationstest mod Postgres |
| `npm run db:generate` | ny Drizzle-migration ud fra `src/db/schema.ts` |
| `npm run db:migrate` | kører migrationerne |
| `npm run probe` | henter ~20 rå bekendtgørelser og rapporterer feltdækning |
| `npm run codelists` | henter CPV-kodelisten til `data/cpv.json` |
| `npm run seed` | opretter en tom startprofil |

Integrationstestene bruger `TEST_DATABASE_URL` hvis den er sat, ellers
`DATABASE_URL`. **Peg dem ikke på produktionsbasen** — de tømmer tabellerne
mellem hver test.

## Sider

| Sti | Indhold |
|---|---|
| `/` | Radaren: nye relevante udbud sorteret på score. Alle filtre ligger i URL'en, så en søgning kan deles. Statusknapper (*interessant* / *afvist*) virker med ét klik. |
| `/udbud/[noticeId]` | Alle felter, hele AI-begrundelsen, versionshistorik med diff, note og link til udbud.dk. |
| `/profiler` | CRUD på profiler. Efter gemning: "genscor de sidste 30 dage" så effekten af en ændring kan ses med det samme. |
| `/status` | Drift: hentninger, scoringskørsler, token-forbrug, digest-historik og advarsler. |

## Pipeline

Tre route handlers, alle beskyttet af `CRON_SECRET` og alle idempotente:

```
/api/cron/ingest   hver time      henter, normaliserer, upserter, logger i ingest_runs
/api/cron/score    hver time :20  scorer det der overlevede lag 1-3, cacher pr. profilversion
/api/cron/digest   hverdage 07:00 dansk tid, sender og fører sendelog
```

Kald dem med hemmeligheden i en header:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/ingest
```

`/api/cron/digest` kører kun hvis klokken er 07 i Europe/Copenhagen — Vercel cron
er UTC, så begge relevante UTC-timer er planlagt og den forkerte returnerer uden
at sende. Tilføj `?force=1` for at sende en testdigest uden for tidsrummet.

### Relevansmotoren

Fire lag, hvor de første tre er gratis og deterministiske (`src/lib/relevance/`):

1. **Hårde filtre** — region, ordregiver-lister, værdiinterval, notice-type og at
   fristen ikke er overskredet.
2. **CPV** — hierarkisk præfiksmatch, så `72000000` rammer `72212000`.
3. **Nøgleord** — helordsmatch på titel og beskrivelse, ekskluderende ord trækker fra.
4. **AI-scoring** — kun for det der overlevede lag 1-3. Prompten ligger i
   `src/lib/scoring/prompt.ts`. Hver score caches på
   `(notice, profil, profilversion)` og genberegnes kun ved eksplicit trigger.

## Ydelse

SPEC §8 kræver at radaren loader under ét sekund med 50.000 bekendtgørelser i
basen. Målt på en lokal Postgres 16 med 50.000 bekendtgørelser og 20.000
scoringer (tid for hele forespørgslen inkl. optælling):

| Visning | Tid |
|---|---|
| Standardvisning | 117 ms |
| Profil + minimum score | 111 ms |
| Fritekstsøgning | 103 ms |
| Region + ordregiver | 154 ms |
| Side 20 | 100 ms |

Indekser: `published_at`, `deadline_at`, `cpv_main`, GIN på `cpv_all` og GIN på
den genererede `search_vector`.

## Selfhost i stedet for Vercel

Cron-planerne i `vercel.json` er de eneste Vercel-specifikke linjer. Ved selfhost
kaldes de samme tre endpoints fra en systemd-timer eller `node-cron` med
`CRON_SECRET` i headeren. Route handlerne må gerne kaldes af hvem som helst der
har hemmeligheden — de er idempotente.

## Dokumentation

| Fil | Indhold |
|---|---|
| `docs/api-noter.md` | Hvad vi ved og ikke ved om udbud.dk's API, og hvordan hullet lukkes. |
| `docs/aabne-spoergsmaal.md` | Åbne spørgsmål, med det blokerende først. |
| `docs/afvigelser-fra-spec.md` | Bevidste afvigelser fra `SPEC.md` og begrundelsen for hver. |
