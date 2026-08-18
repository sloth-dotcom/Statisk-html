import { log } from "@/lib/logger";
import { env } from "@/lib/env";
import {
  UNVERIFIED_FIELD_MAP,
  UNVERIFIED_QUERY_MAP,
  UNVERIFIED_SEARCH_PATH,
  type NoticeFieldMap,
  type QueryParamMap,
} from "./field-map";
import { resolvePath } from "./normalize";

export class UdbudApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
    readonly url: string,
  ) {
    super(message);
    this.name = "UdbudApiError";
  }
}

export interface UdbudClientOptions {
  baseUrl: string;
  apiKey?: string;
  apiKeyHeader?: string;
  searchPath?: string;
  pageSize?: number;
  maxPages?: number;
  maxConcurrency?: number;
  maxRetries?: number;
  fieldMap?: NoticeFieldMap;
  queryMap?: QueryParamMap;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  runId?: string;
}

export interface SearchWindow {
  publishedFrom?: Date;
  publishedTo?: Date;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Caps how many requests are in flight against udbud.dk at once (SPEC §4). */
class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }
}

export class UdbudClient {
  readonly fieldMap: NoticeFieldMap;
  private readonly queryMap: QueryParamMap;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly semaphore: Semaphore;
  private readonly maxRetries: number;
  private readonly pageSize: number;
  private readonly maxPages: number;
  private requests = 0;

  constructor(private readonly options: UdbudClientOptions) {
    this.fieldMap = options.fieldMap ?? UNVERIFIED_FIELD_MAP;
    this.queryMap = options.queryMap ?? UNVERIFIED_QUERY_MAP;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleepImpl ?? defaultSleep;
    this.semaphore = new Semaphore(options.maxConcurrency ?? 2);
    this.maxRetries = options.maxRetries ?? 5;
    this.pageSize = options.pageSize ?? 50;
    this.maxPages = options.maxPages ?? 200;
  }

  get requestCount(): number {
    return this.requests;
  }

  static fromEnv(overrides: Partial<UdbudClientOptions> = {}): UdbudClient {
    const config = env();
    const baseUrl = overrides.baseUrl ?? config.UDBUD_API_BASE_URL;
    if (!baseUrl) {
      throw new Error(
        "UDBUD_API_BASE_URL mangler. Base-URL'en er ikke verificeret endnu — se docs/api-noter.md.",
      );
    }
    return new UdbudClient({
      baseUrl,
      apiKey: config.UDBUD_API_KEY,
      apiKeyHeader: config.UDBUD_API_KEY_HEADER,
      pageSize: config.UDBUD_PAGE_SIZE,
      maxPages: config.UDBUD_MAX_PAGES,
      maxConcurrency: config.UDBUD_MAX_CONCURRENCY,
      ...overrides,
    });
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.options.apiKey) {
      headers[this.options.apiKeyHeader ?? "X-API-Key"] = this.options.apiKey;
    }
    return headers;
  }

  /**
   * Retries 429 and 5xx with exponential backoff, honouring `Retry-After`
   * when the server sends one (SPEC §4). 4xx other than 429 is a contract
   * problem — retrying it just burns quota, so it throws immediately.
   */
  async fetchJson(url: string): Promise<unknown> {
    return this.semaphore.run(async () => {
      let attempt = 0;
      for (;;) {
        this.requests += 1;
        let response: Response;
        try {
          response = await this.fetchImpl(url, { headers: this.headers() });
        } catch (cause) {
          if (attempt >= this.maxRetries) {
            throw new UdbudApiError(`Netværksfejl mod udbud.dk: ${String(cause)}`, 0, "", url);
          }
          await this.backoff(attempt++, null, url, 0);
          continue;
        }

        if (response.ok) return (await response.json()) as unknown;

        const body = await response.text().catch(() => "");
        if (!RETRYABLE_STATUS.has(response.status) || attempt >= this.maxRetries) {
          throw new UdbudApiError(
            `udbud.dk svarede ${response.status} på ${url}`,
            response.status,
            body.slice(0, 2000),
            url,
          );
        }
        await this.backoff(attempt++, response.headers.get("retry-after"), url, response.status);
      }
    });
  }

  private async backoff(attempt: number, retryAfter: string | null, url: string, status: number): Promise<void> {
    const headerDelay = retryAfter ? Number(retryAfter) * 1000 : Number.NaN;
    const delay = Number.isFinite(headerDelay)
      ? headerDelay
      : Math.min(30_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
    log.warn("udbud.retry", { url, status, attempt: attempt + 1, delayMs: delay, runId: this.options.runId });
    await this.sleep(delay);
  }

  private buildUrl(page: number, cursor: string | null, window: SearchWindow): string {
    const url = new URL(this.options.searchPath ?? UNVERIFIED_SEARCH_PATH, this.options.baseUrl);
    const q = url.searchParams;
    q.set(this.queryMap.pageSize, String(this.pageSize));
    if (this.queryMap.strategy === "cursor") {
      if (cursor) q.set(this.queryMap.cursorParam, cursor);
    } else {
      q.set(this.queryMap.page, String(page));
    }
    if (window.publishedFrom) q.set(this.queryMap.publishedFrom, window.publishedFrom.toISOString());
    if (window.publishedTo) q.set(this.queryMap.publishedTo, window.publishedTo.toISOString());
    if (this.queryMap.sort && this.queryMap.sortValue) q.set(this.queryMap.sort, this.queryMap.sortValue);
    return url.toString();
  }

  private extractItems(payload: unknown): unknown[] {
    for (const path of this.fieldMap.itemsPath) {
      const hit = resolvePath(payload, path)[0];
      if (Array.isArray(hit)) return hit;
    }
    // Some APIs return a bare array.
    if (Array.isArray(payload)) return payload;
    return [];
  }

  private extractCursor(payload: unknown): string | null {
    for (const path of this.fieldMap.nextCursorPath) {
      const hit = resolvePath(payload, path)[0];
      if (typeof hit === "string" && hit.trim() !== "") return hit;
    }
    return null;
  }

  /**
   * Pages to the end of the result set. Yields raw items — normalisation is a
   * separate step so a mapping bug never costs us a refetch.
   */
  async *iterateNotices(window: SearchWindow = {}): AsyncGenerator<unknown, void, void> {
    let page = this.queryMap.firstPage;
    let cursor: string | null = null;
    let pagesFetched = 0;
    let seen = 0;

    while (pagesFetched < this.maxPages) {
      const url = this.buildUrl(page, cursor, window);
      const payload = await this.fetchJson(url);
      const items = this.extractItems(payload);
      pagesFetched += 1;
      seen += items.length;
      log.info("udbud.page", { url, items: items.length, page, runId: this.options.runId });

      for (const item of items) yield item;

      if (items.length === 0) return;
      if (this.queryMap.strategy === "cursor") {
        cursor = this.extractCursor(payload);
        if (!cursor) return;
      } else {
        if (items.length < this.pageSize) return;
        page += 1;
      }
    }

    log.warn("udbud.page_limit_reached", { maxPages: this.maxPages, seen, runId: this.options.runId });
  }
}
