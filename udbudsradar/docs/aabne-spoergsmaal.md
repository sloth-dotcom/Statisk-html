# Åbne spørgsmål

Opdateres løbende. Nummer 1-3 blokerer fase 2 i praksis.

## 1. Adgang til udbud.dk's API — BLOKERENDE
Kræver API'et nøgle, OAuth eller er det åbent? Hvor ansøger man, og hvor lang tid
tager det? Hvad er base-URL'en, og findes der et testmiljø?

Status: ubesvaret. `git.erst.dk` og `udbud.dk` er blokeret af egress-policyen i
byggemiljøet (403 på CONNECT), så hverken `openapi.yml` eller et faktisk svar har
været tilgængeligt. Hele `src/lib/udbud/field-map.ts` er derfor kandidatstier og
ikke viden.

## 2. Vilkår for brug af data
Må vi cache svarene og videreformidle dem internt i en digest? Vi gemmer i dag
hele det rå svar i `notices.raw` og sender uddrag på mail.

## 3. CPV-koder og regioner vi starter med
Skal komme fra jer. `npm run seed` opretter én tom profil med en beskrivelse der
skal udfyldes — AI-scoringen kender kun firmaet gennem den tekst.

## 4. Deployment
Vercel eller selfhost? `vercel.json` indeholder cron-planer der matcher SPEC §4
og §7; ved selfhost skal de samme tre route handlers kaldes med `CRON_SECRET` i
en header fra en systemd-timer eller node-cron.

## 5. Dato-only frister
Hvis API'et leverer en frist uden klokkeslæt, tolker vi den som **starten** af
dagen i Europe/Copenhagen. Det underdriver den tid der er tilbage frem for at
overdrive den, men det er et valg vi har truffet uden at kende formatet. Bekræft
mod rigtige svar.

## 6. Notice-version når feltet mangler
Mangler `noticeVersion` i svaret, sætter vi `"01"` for at holde nøglen
`(notice_id, notice_version)` intakt. Hvis udbud.dk versionerer anderledes (fx
`1` eller en dato), skal det rettes før vi har historik nok til at det gør ondt.

## 7. Hvilke notice-typer skal vises som standard?
Vi gemmer alle typer. Profilerne kan filtrere, men vi ved ikke hvilke strenge
API'et bruger, så feltet er fritekst indtil videre.

## 8. Historiske tildelinger
SPEC §12.5: interessant, men fase 7. Ikke bygget.

## 9. Model og omkostning til scoring
Default er `claude-opus-5` med effort `medium`, batch på 5 udbud pr. kald og et
loft på 50 udbud pr. kørsel. Token-forbruget står på `/status`. Skal loftet
hæves, eller skal en billigere model bruges, er begge dele én env-variabel.
