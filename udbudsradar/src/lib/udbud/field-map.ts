/**
 * ------------------------------------------------------------------------
 * ADVARSEL: DENNE MAPNING ER IKKE VERIFICERET MOD UDBUD.DK
 * ------------------------------------------------------------------------
 * Fase 0 kunne ikke gennemføres i byggemiljøet: både git.erst.dk (openapi.yml)
 * og udbud.dk er blokeret af egress-policyen, så ingen af stierne nedenfor er
 * bekræftet mod et faktisk svar. Se docs/api-noter.md §"Status" og
 * docs/aabne-spoergsmaal.md §1.
 *
 * Derfor er mapningen data og ikke kode: kør `npm run probe` når API-adgang
 * findes, læs rapporten den udskriver, og ret stierne her. Ingen anden fil
 * behøver at ændre sig.
 *
 * Hvert felt er en liste af kandidatstier. Normaliseringen tager den første
 * sti der findes og ikke er tom, og rapporterer hvilke felter der ikke kunne
 * udfyldes — så en forkert mapning bliver synlig på /status i stedet for at
 * give tomme kolonner i stilhed.
 */
export interface NoticeFieldMap {
  /** Sæt til true når stierne er bekræftet mod et rigtigt API-svar. */
  verified: boolean;
  /** Sti til listen af notices i et side-svar. */
  itemsPath: string[];
  /** Sti til det samlede antal træf, hvis API'et oplyser det. */
  totalPath: string[];
  /** Sti til en cursor/next-link til næste side, hvis API'et bruger cursors. */
  nextCursorPath: string[];
  fields: {
    noticeId: string[];
    noticeVersion: string[];
    noticeType: string[];
    title: string[];
    description: string[];
    buyerName: string[];
    buyerId: string[];
    buyerRegion: string[];
    cpvMain: string[];
    cpvAll: string[];
    valueAmount: string[];
    valueCurrency: string[];
    publishedAt: string[];
    deadlineAt: string[];
    procedureType: string[];
  };
}

/**
 * Stierne er skrevet som dot-paths. `[]` betyder "gå ind i hvert element af et
 * array", fx `lots[].tenderPeriod.endDate`.
 */
export const UNVERIFIED_FIELD_MAP: NoticeFieldMap = {
  verified: false,
  itemsPath: ["items", "results", "content", "hits", "notices", "data"],
  totalPath: ["total", "totalElements", "totalCount", "meta.total"],
  nextCursorPath: ["nextCursor", "next", "meta.next", "links.next"],
  fields: {
    noticeId: ["noticeId", "id", "notice.id", "ID"],
    noticeVersion: ["noticeVersion", "version", "notice.version"],
    noticeType: ["noticeType", "type", "formType", "notice.type"],
    title: ["title", "name", "tender.title", "BT-21"],
    description: ["description", "tender.description", "BT-24"],
    buyerName: ["buyer.name", "buyerName", "contractingAuthority.name", "BT-500"],
    buyerId: ["buyer.id", "buyer.cvr", "buyerId", "contractingAuthority.id"],
    buyerRegion: ["buyer.region", "buyer.address.region", "region", "buyer.address.nuts"],
    cpvMain: ["cpvMain", "tender.classification.id", "mainCpvCode", "BT-262"],
    cpvAll: ["cpvCodes", "tender.additionalClassifications[].id", "additionalCpvCodes", "BT-263"],
    valueAmount: ["value.amount", "estimatedValue.amount", "tender.value.amount", "BT-27"],
    valueCurrency: ["value.currency", "estimatedValue.currency", "tender.value.currency"],
    publishedAt: ["publicationDate", "publishedAt", "datePublished", "BT-05"],
    deadlineAt: ["deadline", "tenderPeriod.endDate", "submissionDeadline", "BT-131"],
    procedureType: ["procedureType", "tender.procurementMethod", "BT-105"],
  },
};

/**
 * Navnene på de query-parametre vi sender. Lige så uverificerede som feltstierne
 * ovenfor — ret dem når openapi.yml er læst.
 */
export interface QueryParamMap {
  page: string;
  pageSize: string;
  publishedFrom: string;
  publishedTo: string;
  updatedFrom: string;
  sort: string | null;
  sortValue: string | null;
  /** 0 hvis API'et 0-indekserer sider, 1 hvis det 1-indekserer. */
  firstPage: number;
  /** "page" = side/offset-baseret, "cursor" = cursor/next-link-baseret. */
  strategy: "page" | "cursor";
  cursorParam: string;
}

export const UNVERIFIED_QUERY_MAP: QueryParamMap = {
  page: "page",
  pageSize: "size",
  publishedFrom: "publishedFrom",
  publishedTo: "publishedTo",
  updatedFrom: "updatedFrom",
  sort: "sort",
  sortValue: "publicationDate,desc",
  firstPage: 0,
  strategy: "page",
  cursorParam: "cursor",
};

/** Sti-delen af søge-endpointet, uden base-URL. */
export const UNVERIFIED_SEARCH_PATH = "/api/notices";
