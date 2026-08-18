# API-noter — udbud.dk

**Status: ikke besvaret. Fase 0 kunne ikke gennemføres i dette miljø.**

Denne fil skal efter SPEC §1.2 indeholde base-URL, autentifikation, endpoints,
filtre, paginering, ændret-siden-filter, rate limits, notice-typer og
dokumentadgang. Alt det skal komme fra `openapi.yml` eller fra kald vi selv har
set svaret på (CLAUDE.md regel 1). Ingen af delene har været muligt:

```
$ curl https://git.erst.dk/udbud-dk/sdk/-/raw/master/openapi.yml
curl: (56) CONNECT tunnel failed, response 403

$ curl https://udbud.dk
curl: (56) CONNECT tunnel failed, response 403
```

Begge værter afvises af egress-policyen i det miljø koden er bygget i. Der er
altså hverken læst en spec eller set et svar, og derfor står der ingen påstande
om API-kontrakten i denne fil. Alt hvad koden gør i dag bygger på kandidatstier,
ikke på viden — se `src/lib/udbud/field-map.ts`.

## Hvad der faktisk vides

| Emne | Kilde | Note |
|---|---|---|
| Deep-link-format | `SPEC.md §3` | `https://udbud.dk/detaljevisning?noticeId={noticeId}&noticeVersion={version}` — opgivet som verificeret af spec-forfatteren, ikke af os. Implementeret i `buildSourceUrl()`. |
| eForms, dansk profil | `SPEC.md §1` | Feltnavne er sandsynligvis BT-koder (`BT-21` = titel). Derfor er normaliseringen bygget som et oversættelseslag med kandidatstier frem for faste feltnavne. |
| SDK-repo | `SPEC.md §1` | `https://git.erst.dk/udbud-dk/sdk`, spec på `/-/raw/master/openapi.yml`, kodelister under `eforms-sdk-dk/codelists/`. Ikke hentet. |

## Ubesvaret — og hvad der blokeres af det

| Spørgsmål (SPEC §1.2) | Konsekvens indtil det er besvaret |
|---|---|
| Base-URL og test-/sandbox-miljø | `UDBUD_API_BASE_URL` er tom, og ingest kan ikke køre. |
| Autentifikation: nøgle, OAuth eller åbent? | `UDBUD_API_KEY_HEADER` gætter på `X-API-Key`. Klienten sender nøglen i den header env-variablen peger på, så en ændring er én linje i `.env`. |
| Endpoints, metoder og parametre | Søgestien gætter på `/api/notices` (`UNVERIFIED_SEARCH_PATH`). |
| Filtrering på CPV, dato, region, ordregiver, fritekst | Kun dato-filtrering er implementeret i klienten, med gættede parameternavne (`UNVERIFIED_QUERY_MAP`). Resten af filtreringen sker i vores egen database efter hentning. |
| Paginering | Klienten understøtter både side- og cursor-baseret paginering; hvilken der gælder er ukendt. Strategien vælges i `UNVERIFIED_QUERY_MAP.strategy`. |
| "Ændret siden"-filter | Ingest bruger i stedet et dato-vindue med 24 timers overlap. Findes der et `modifiedSince`, kan hentningen gøres billigere. |
| Rate limits og kvoter | Default er konservativ: 2 samtidige kald, eksponentiel backoff, `Retry-After` respekteres. |
| Notice-typer | Vi gemmer den type API'et oplyser, uden at oversætte den. Profilerne kan filtrere på typenavne når vi kender dem. |
| Dokumenter/bilag via API | Ikke implementeret. Vi linker til udbud.dk. |

## Sådan lukkes hullet

1. Skaf netværksadgang til `git.erst.dk` og `udbud.dk` (eller kør trin 2-4 fra en
   maskine der har den).
2. `npx openapi-typescript openapi.yml -o src/lib/udbud/api-types.ts`
3. `UDBUD_API_BASE_URL=... UDBUD_API_KEY=... npm run probe` — scriptet gemmer 20
   rå svar i `tmp/sample-notices/` og udskriver en tabel over hvilke felter der
   faktisk blev udfyldt, og hvilken sti der ramte.
4. Ret `src/lib/udbud/field-map.ts` efter tabellen, sæt `verified: true`, kopiér
   nogle af svarene til `tests/fixtures/`, og skriv denne fil om med rigtige svar
   i stedet for tabellen "Ubesvaret" ovenfor.
5. `npm run codelists` henter CPV-listen fra SDK-repoet til `data/cpv.json`.

Så længe `verified` er `false`, viser `/status` en advarsel om at mapningen ikke
er bekræftet, og hver ingest-kørsel rapporterer feltdækning, så en forkert
mapning bliver synlig med det samme i stedet for at give tomme kolonner.
