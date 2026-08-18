import type { Notice, Profile } from "@/db/schema";
import { formatDateCopenhagen } from "@/lib/time";
import { formatAmount } from "@/lib/utils";

/**
 * The prompt lives here and nowhere else (CLAUDE.md rule 9) so it can be
 * iterated on, diffed and reviewed without touching the call site.
 *
 * Calibration note: the first version of a scoring prompt gives 70 to
 * everything, which makes the score useless. The anchors below are therefore
 * explicit about what a low score means, and the model is told that most
 * tenders are a poor fit — the default is skepticism, not politeness.
 */
export const SCORING_SYSTEM_PROMPT = `Du vurderer offentlige udbud fra udbud.dk for et dansk firma.

Din opgave er at give hvert udbud en score fra 0 til 100 for hvor relevant det er for firmaet, ud fra firmaprofilen du får.

Sådan bruger du skalaen — hold dig til den:
- 85-100: Kerneforretning. Firmaet kan byde uden forbehold og har oplagt de referencer der kræves.
- 70-84: Stærkt match, men noget mangler — en delydelse uden for firmaets område, en usikker reference eller en størrelse der er i overkanten.
- 50-69: Muligt. Der er overlap, men firmaet skal enten samarbejde med andre eller strække sig.
- 25-49: Svagt. Kun periferien af udbuddet rammer firmaets område.
- 0-24: Irrelevant. Andet fagområde, forkert ordregivertype eller en opgave firmaet ikke kan løse.

De fleste udbud i et tilfældigt udtræk er 0-49. Giv kun over 70 når du kan pege på konkret overlap mellem udbuddets indhold og profilteksten. En pæn, generisk begrundelse uden konkret overlap er et tegn på at scoren skal være lav.

Vær opmærksom på:
- Kort eller intetsigende beskrivelse er ikke i sig selv et plus. Er der for lidt information til at vurdere, så sig det i begrundelsen og hold scoren under 50.
- CPV-koder kan være sat bredt af ordregiver. Vægt hvad der faktisk står i titel og beskrivelse højere end koden.
- Rammeaftaler og genudbud tæller på lige fod med enkeltopgaver.

Svar på dansk. Begrundelsen skal være 1-3 sætninger og pege på det konkrete i udbuddet der afgør scoren — ikke gentage profilen. Under "concerns" skriver du de forbehold der ville koste firmaet opgaven, fx krav om referencer, certificeringer, geografisk tilstedeværelse eller omsætningskrav. Er der ingen, så lad listen være tom.

Du får flere udbud ad gangen. Svar med præcis én vurdering pr. udbud, og brug det "nr." udbuddet har i inputtet.`;

export function buildProfileBlock(profile: Profile): string {
  const lines = [
    `Navn: ${profile.name}`,
    `Beskrivelse: ${profile.description || "(ingen beskrivelse udfyldt)"}`,
  ];
  if (profile.cpvCodes.length) lines.push(`CPV-koder vi arbejder med: ${profile.cpvCodes.join(", ")}`);
  if (profile.keywords.length) lines.push(`Nøgleord: ${profile.keywords.join(", ")}`);
  if (profile.excludedKeywords.length) lines.push(`Vi vil ikke have: ${profile.excludedKeywords.join(", ")}`);
  if (profile.regions.length) lines.push(`Regioner: ${profile.regions.join(", ")}`);
  if (profile.minValue) lines.push(`Mindste interessante værdi: ${profile.minValue}`);
  if (profile.maxValue) lines.push(`Største interessante værdi: ${profile.maxValue}`);
  return lines.join("\n");
}

export function buildNoticeBlock(notice: Notice, index: number): string {
  return [
    `--- Udbud nr. ${index} ---`,
    `Titel: ${notice.title ?? "(ingen titel)"}`,
    `Ordregiver: ${notice.buyerName ?? "(ukendt)"}${notice.buyerRegion ? ` (${notice.buyerRegion})` : ""}`,
    `Type: ${notice.noticeType ?? "(ukendt)"}${notice.procedureType ? ` / ${notice.procedureType}` : ""}`,
    `CPV: ${notice.cpvAll.length ? notice.cpvAll.join(", ") : "(ingen)"}`,
    `Anslået værdi: ${formatAmount(notice.valueAmount, notice.valueCurrency)}`,
    `Tilbudsfrist: ${notice.deadlineAt ? formatDateCopenhagen(notice.deadlineAt) : "(ikke oplyst)"}`,
    `Beskrivelse: ${(notice.description ?? "(ingen beskrivelse)").slice(0, 4000)}`,
  ].join("\n");
}

export function buildScoringMessage(profile: Profile, batch: Notice[]): string {
  return [
    "FIRMAPROFIL",
    buildProfileBlock(profile),
    "",
    `UDBUD TIL VURDERING (${batch.length} stk.)`,
    ...batch.map((notice, index) => buildNoticeBlock(notice, index)),
  ].join("\n");
}
