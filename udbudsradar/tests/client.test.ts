import { describe, expect, it, vi } from "vitest";
import { UdbudApiError, UdbudClient } from "../src/lib/udbud/client";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function makeClient(fetchImpl: typeof fetch, sleeps: number[], overrides = {}) {
  return new UdbudClient({
    baseUrl: "https://api.example.test",
    searchPath: "/api/notices",
    pageSize: 2,
    maxConcurrency: 1,
    fetchImpl,
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
    ...overrides,
  });
}

describe("UdbudClient retry", () => {
  it("retries a 429 and waits the number of seconds Retry-After asks for", async () => {
    const sleeps: number[] = [];
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "retry-after": "3" } }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }));

    const client = makeClient(fetchImpl, sleeps);
    await client.fetchJson("https://api.example.test/api/notices");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([3000]);
  });

  it("backs off exponentially on 5xx", async () => {
    const sleeps: number[] = [];
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("boom", { status: 503 }))
      .mockResolvedValueOnce(new Response("boom", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }));

    const client = makeClient(fetchImpl, sleeps);
    await client.fetchJson("https://api.example.test/api/notices");

    expect(sleeps).toHaveLength(2);
    expect(sleeps[1]!).toBeGreaterThan(sleeps[0]!);
  });

  it("does not retry a 400 — a broken request stays broken", async () => {
    const sleeps: number[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("bad filter", { status: 400 }));
    const client = makeClient(fetchImpl, sleeps);

    await expect(client.fetchJson("https://api.example.test/api/notices")).rejects.toBeInstanceOf(UdbudApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it("gives up after maxRetries and reports the status", async () => {
    const sleeps: number[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("nope", { status: 500 }));
    const client = makeClient(fetchImpl, sleeps, { maxRetries: 2 });

    await expect(client.fetchJson("https://api.example.test/x")).rejects.toMatchObject({ status: 500 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe("UdbudClient pagination", () => {
  it("pages until a short page arrives", async () => {
    const pages = [
      jsonResponse({ items: [{ noticeId: "a" }, { noticeId: "b" }] }),
      jsonResponse({ items: [{ noticeId: "c" }] }),
    ];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => pages.shift()!);
    const client = makeClient(fetchImpl, []);

    const seen: unknown[] = [];
    for await (const item of client.iterateNotices()) seen.push(item);

    expect(seen).toHaveLength(3);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stops on an empty page", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse({ items: [] }));
    const client = makeClient(fetchImpl, []);

    const seen: unknown[] = [];
    for await (const item of client.iterateNotices()) seen.push(item);

    expect(seen).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("respects maxPages so a broken paginator cannot loop forever", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => jsonResponse({ items: [{ noticeId: "a" }, { noticeId: "b" }] }));
    const client = makeClient(fetchImpl, [], { maxPages: 3 });

    const seen: unknown[] = [];
    for await (const item of client.iterateNotices()) seen.push(item);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(seen).toHaveLength(6);
  });

  it("puts the date window into the query string", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      urls.push(String(input));
      return jsonResponse({ items: [] });
    });
    const client = makeClient(fetchImpl, []);

    for await (const _ of client.iterateNotices({ publishedFrom: new Date("2026-08-01T00:00:00Z") })) {
      // draining the generator is the point
    }

    expect(urls[0]).toContain("publishedFrom=2026-08-01T00%3A00%3A00.000Z");
    expect(urls[0]).toContain("size=2");
  });

  it("follows a cursor when the API is cursor based", async () => {
    const pages = [
      jsonResponse({ items: [{ noticeId: "a" }], nextCursor: "c2" }),
      jsonResponse({ items: [{ noticeId: "b" }] }),
    ];
    const urls: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      urls.push(String(input));
      return pages.shift()!;
    });
    const client = makeClient(fetchImpl, [], {
      queryMap: {
        page: "page",
        pageSize: "size",
        publishedFrom: "publishedFrom",
        publishedTo: "publishedTo",
        updatedFrom: "updatedFrom",
        sort: null,
        sortValue: null,
        firstPage: 0,
        strategy: "cursor" as const,
        cursorParam: "cursor",
      },
    });

    const seen: unknown[] = [];
    for await (const item of client.iterateNotices()) seen.push(item);

    expect(seen).toHaveLength(2);
    expect(urls[1]).toContain("cursor=c2");
  });
});
