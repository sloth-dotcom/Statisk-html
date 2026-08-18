# Fixtures

`SPEC.md §9` kræver at fixtures til API-svar kommer fra rigtige kald — ikke fra
opfundne data. Fase 0 kunne ikke køre i byggemiljøet (git.erst.dk og udbud.dk er
blokeret af egress-policyen), så der ligger **ingen** rigtige API-fixtures her endnu.

Sådan får du dem:

```bash
UDBUD_API_BASE_URL=... UDBUD_API_KEY=... npm run probe
cp tmp/sample-notices/*.json tests/fixtures/
```

Filen `synthetic-notice.json` er **ikke** et API-svar. Den er konstrueret til at
teste normaliseringens mekanik (stiopslag, flersprogede felter, decimaler,
datoer) og påstår intet om udbud.dk's faktiske kontrakt.
