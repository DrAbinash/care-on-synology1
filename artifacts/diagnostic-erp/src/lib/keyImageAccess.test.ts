/**
 * Client half of the guarded key-image delivery: one batch request per rail,
 * a cache that respects the server's expiry, and no throw into a render.
 *
 * The credential-shape guarantees (grant bound to one file, session token never
 * in a URL, refusals carry no bytes) are proven server-side in
 * `artifacts/api-server/src/lib/keyImageAccessControl.request.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cachedKeyImageUrls,
  fetchKeyImageAccessUrls,
  invalidateKeyImageUrls,
  isGuardedKeyImageUrl,
} from "@/lib/keyImageAccess";

const ENDPOINT = "/api/radiology/report-generator/key-images/access-urls";

type Call = { path: string; body: unknown };
const calls: Call[] = [];

function respondWith(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetch(handler: (init: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit = {}) => {
      calls.push({ path: String(path), body: init.body ? JSON.parse(String(init.body)) : null });
      return handler(init);
    }),
  );
}

beforeEach(() => {
  calls.length = 0;
  invalidateKeyImageUrls();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isGuardedKeyImageUrl", () => {
  it("recognises only the guarded upload prefix", () => {
    expect(isGuardedKeyImageUrl("/uploads/radiology-key-images/abc.jpg")).toBe(true);
    expect(isGuardedKeyImageUrl("/uploads/expense/abc.jpg")).toBe(false);
    expect(
      isGuardedKeyImageUrl("/dicom-web/studies/1.2.3/instance/1.2.3.4/rendered"),
    ).toBe(false);
    expect(isGuardedKeyImageUrl("data:image/jpeg;base64,AAAA")).toBe(false);
    expect(isGuardedKeyImageUrl(null)).toBe(false);
    expect(isGuardedKeyImageUrl(undefined)).toBe(false);
  });
});

describe("fetchKeyImageAccessUrls", () => {
  it("mints one batch request for the whole rail and returns per-file grants", async () => {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    installFetch(() =>
      respondWith({
        success: true,
        expiresAt,
        items: [
          { id: 7, imageUrl: `/uploads/radiology-key-images/a.jpg?kimg=TOKEN_A`, thumbnailUrl: `/uploads/radiology-key-images/a.jpg?kimg=TOKEN_A` },
          { id: 8, imageUrl: `/uploads/radiology-key-images/b.jpg?kimg=TOKEN_B`, thumbnailUrl: null },
        ],
      }),
    );

    const map = await fetchKeyImageAccessUrls([7, 8]);
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe(ENDPOINT);
    expect(calls[0].body).toEqual({ ids: [7, 8] });
    expect(map.get(7)?.imageUrl).toContain("kimg=TOKEN_A");
    expect(map.get(8)?.thumbnailUrl).toBeNull();
    expect(map.get(8)?.expiresAtMs).toBe(Date.parse(expiresAt));
  });

  it("serves a second rail render from cache instead of re-minting", async () => {
    installFetch(() =>
      respondWith({
        success: true,
        expiresAt: new Date(Date.now() + 9 * 60 * 1000).toISOString(),
        items: [{ id: 7, imageUrl: "/uploads/radiology-key-images/a.jpg?kimg=T1", thumbnailUrl: null }],
      }),
    );
    await fetchKeyImageAccessUrls([7]);
    const second = await fetchKeyImageAccessUrls([7]);
    expect(calls).toHaveLength(1);
    expect(second.get(7)?.imageUrl).toContain("kimg=T1");
    expect(cachedKeyImageUrls(7)?.id).toBe(7);
  });

  it("re-mints when the cached grant is inside the refresh window", async () => {
    const almostExpired = new Date(Date.now() + 20 * 1000).toISOString(); // < 60s slack
    installFetch(() =>
      respondWith({
        success: true,
        expiresAt: almostExpired,
        items: [{ id: 7, imageUrl: "/uploads/radiology-key-images/a.jpg?kimg=OLD", thumbnailUrl: null }],
      }),
    );
    await fetchKeyImageAccessUrls([7]);
    await fetchKeyImageAccessUrls([7]);
    expect(calls).toHaveLength(2);
    expect(cachedKeyImageUrls(7)).toBeUndefined();
  });

  it("drops ids already cached and asks only for the missing ones", async () => {
    let returned = new Set<number>();
    installFetch((init) => {
      const asked = (JSON.parse(String(init.body ?? "{}")) as { ids: number[] }).ids ?? [];
      returned = new Set(asked);
      return respondWith({
        success: true,
        expiresAt: new Date(Date.now() + 9 * 60 * 1000).toISOString(),
        items: asked.map((id) => ({
          id,
          imageUrl: `/uploads/radiology-key-images/${id}.jpg?kimg=T${id}`,
          thumbnailUrl: null,
        })),
      });
    });
    await fetchKeyImageAccessUrls([7]);
    const second = await fetchKeyImageAccessUrls([7, 8]);
    expect(calls).toHaveLength(2);
    expect([...returned]).toEqual([8]);
    expect(second.get(8)?.imageUrl).toContain("kimg=T8");
  });

  it("returns nothing rather than throwing when the server refuses", async () => {
    installFetch(() => new Response(JSON.stringify({ error: "nope" }), { status: 403 }));
    const map = await fetchKeyImageAccessUrls([7]);
    expect(map.size).toBe(0);
    expect(cachedKeyImageUrls(7)).toBeUndefined();
  });

  it("returns nothing when the network fails, so the rail shows an empty frame", async () => {
    installFetch(() => {
      throw new TypeError("fetch failed");
    });
    const map = await fetchKeyImageAccessUrls([7]);
    expect(map.size).toBe(0);
  });

  it("ignores empty and invalid id lists without calling the server", async () => {
    installFetch(() => respondWith({ success: true, items: [] }));
    expect((await fetchKeyImageAccessUrls([])).size).toBe(0);
    expect((await fetchKeyImageAccessUrls([0, -1, Number.NaN])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("deduplicates ids in one call", async () => {
    installFetch(() =>
      respondWith({
        success: true,
        expiresAt: new Date(Date.now() + 9 * 60 * 1000).toISOString(),
        items: [{ id: 7, imageUrl: "/uploads/radiology-key-images/a.jpg?kimg=T1", thumbnailUrl: null }],
      }),
    );
    await fetchKeyImageAccessUrls([7, 7, 7]);
    expect(calls[0].body).toEqual({ ids: [7] });
  });

  it("three components mounting the same rail share one request, not three", async () => {
    // The reporting workspace reads the rail from three places at once, so the
    // first render of a study fired 5 POSTs to /key-images/access-urls before any
    // response had filled the cache. Nothing may be minted twice while a request
    // for that id is still in flight.
    const resolvers: Array<(r: Response) => void> = [];
    installFetch(() => new Promise<Response>((res) => { resolvers.push(res); }));

    const a = fetchKeyImageAccessUrls([7, 8]);
    const b = fetchKeyImageAccessUrls([7, 8]);
    const c = fetchKeyImageAccessUrls([8, 9]);
    await new Promise((r) => setTimeout(r, 0));

    // One batch for 7+8, and a second only for the id nobody had asked for.
    expect(calls).toHaveLength(2);
    expect(calls[0].body).toEqual({ ids: [7, 8] });
    expect(calls[1].body).toEqual({ ids: [9] });

    const payload = {
      success: true,
      expiresAt: new Date(Date.now() + 9 * 60 * 1000).toISOString(),
      items: [
        { id: 7, imageUrl: "/uploads/radiology-key-images/a.jpg?kimg=T7", thumbnailUrl: null },
        { id: 8, imageUrl: "/uploads/radiology-key-images/b.jpg?kimg=T8", thumbnailUrl: null },
        { id: 9, imageUrl: "/uploads/radiology-key-images/c.jpg?kimg=T9", thumbnailUrl: null },
      ],
    };
    for (const res of resolvers) res(respondWith(payload));

    const [ma, mb, mc] = await Promise.all([a, b, c]);
    expect(ma.get(7)?.imageUrl).toContain("kimg=T7");
    expect(mb.get(8)?.imageUrl).toContain("kimg=T8");
    expect(mc.get(9)?.imageUrl).toContain("kimg=T9");
    expect(calls).toHaveLength(2);
  });

  it("a failed grant releases the id so the next render can try again", async () => {
    let fail = true;
    installFetch(() => (fail
      ? new Response(JSON.stringify({ error: "boom" }), { status: 500 })
      : respondWith({
        success: true,
        expiresAt: new Date(Date.now() + 9 * 60 * 1000).toISOString(),
        items: [{ id: 7, imageUrl: "/uploads/radiology-key-images/a.jpg?kimg=T2", thumbnailUrl: null }],
      })));

    const first = await fetchKeyImageAccessUrls([7]);
    expect(first.size).toBe(0);
    fail = false;
    const second = await fetchKeyImageAccessUrls([7]);
    expect(second.get(7)?.imageUrl).toContain("kimg=T2");
    expect(calls).toHaveLength(2);
  });
});
