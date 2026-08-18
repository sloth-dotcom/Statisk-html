# Afvigelser fra SPEC.md

Bevidste afvigelser. Alt andet følger spec'en.

## 1. Fase 0 er ikke gennemført — den er dokumenteret som blokeret
SPEC §1 kræver research af API'et før noget bygges, med stop og rapport.
`git.erst.dk` og `udbud.dk` er blokeret af egress-policyen i byggemiljøet, så
researchen kunne ikke laves. Frem for at opfinde en API-kontrakt er
feltmapningen isoleret i én datafil (`src/lib/udbud/field-map.ts`) markeret som
uverificeret, og hver ingest-kørsel rapporterer feltdækning. Se
`docs/api-noter.md`.

## 2. `notice_status` er nøglet på udbud.dk's `noticeId`, ikke på vores rækkes id
SPEC §3 skriver `notice_id fk`. Vores `notices`-tabel har én række pr. version,
så en fremmednøgle ville betyde at et udbud markeret "afvist" dukker op som nyt
igen når version 02 hentes. Triagen er derfor knyttet til bekendtgørelsens id og
overlever nye versioner.

## 3. To tabeller mere end spec'en nævner
- `scoring_runs`: SPEC §5 kræver at token-forbrug logges pr. kørsel og §6 at det
  kan ses på `/status`. Det kræver et sted at logge det.
- `digest_runs` + `digest_items`: SPEC §7 kræver at samme notice aldrig sendes to
  gange, og at det testes. Et unikt indeks på `(notice_id, profile_id)` er den
  eneste måde at garantere det på — applikationslogik alene kan tabe kapløbet.

## 4. `profiles.version`
Ikke i spec'en. SPEC §5 siger at genscoring skal ske ved "ny profilversion", men
der er ikke noget versionsfelt at hænge det op på. Hver gemning bumper versionen,
og cache-nøglen er `(notice, profil, profilversion)`, så en profilændring
automatisk giver nye scoringer uden at slette historikken.

## 5. Filtrene i radaren er en almindelig GET-formular
SPEC §6 kræver at filtre ligger i URL'en. En GET-formular gør det uden en eneste
linje klient-JavaScript, og hele siden forbliver en server component.

## 6. Ingen `src/lib/udbud/api-types.ts`
SPEC §1.3 beder om typer genereret fra `openapi.yml`. Spec'en kunne ikke hentes.
Kommandoen står klar i `docs/api-noter.md`.

## 7. Projektet ligger i undermappen `udbudsradar/`
Repoet er ellers en samling statiske HTML-sider, hver med sit eget Vercel-projekt.
Appen følger samme mønster som en selvstændig mappe frem for at overtage roden.
