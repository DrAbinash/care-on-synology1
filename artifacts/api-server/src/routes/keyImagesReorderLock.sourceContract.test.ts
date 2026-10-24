/**
 * @vitest-environment node
 *
 * Source contract: the key-images reorder must serialize per draft.
 *
 * `POST /key-images/reorder` writes each row's sortOrder one UPDATE at a
 * time, in the client-supplied order, inside one transaction — the exact
 * shape its sibling `POST /image-references/reorder` documents as deadlock
 * prone: two interleaved reorders of the same draft hold row locks in
 * opposite orders, and Postgres aborts one of them (40P01) or interleaves a
 * mixed ordering onto the rail. The sibling routes take
 * `pg_advisory_xact_lock` for exactly this reason; this pin keeps the
 * key-images reorder from silently losing the same lock a refactor or a
 * merge could drop again.
 *
 * This is a source contract, not a request test, deliberately: the reorder
 * route needs a live Postgres to observe a deadlock, and this container
 * records that the DB suites do not run here. The lock's presence, its
 * placement inside the transaction, and its per-draft key are all readable
 * from the wiring — which is what a green request suite can silently lose.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "radiology-report-generator.ts"), "utf8");

/** The route's own source, from its registration to the next one. */
function routeSlice(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  expect(start, `route ${startMarker} must exist`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endMarker, start);
  expect(end, `route ${endMarker} must follow ${startMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("key-images reorder serialization (source contract)", () => {
  const route = routeSlice('"/key-images/reorder"', '"/key-images/detach-observation"');

  it("takes the advisory lock its sibling reorder routes already take", () => {
    expect(route).toContain("pg_advisory_xact_lock");
  });

  it("locks on a key-images namespace bound to THIS draft — not the image-refs lock", () => {
    // Same shape as the image-references reorder: hashtext(namespace + draftId).
    // A distinct namespace keeps key-image reorders serialized among
    // themselves without contending with image-reference reorders.
    expect(route).toMatch(/pg_advisory_xact_lock\(hashtext\(\$\{"keyreorder:"\s*\+\s*(?:parsed\.data\.)?draftId\}\)\)/);
  });

  it("takes the lock INSIDE the transaction, before the first per-row UPDATE", () => {
    const txStart = route.indexOf("db.transaction(");
    expect(txStart).toBeGreaterThanOrEqual(0);
    const lockAt = route.indexOf("pg_advisory_xact_lock");
    // `tx` and `.update` may be split across lines in this file's formatting.
    const firstUpdate = route.search(/\btx\s*\.\s*update\b/);
    expect(firstUpdate).toBeGreaterThanOrEqual(0);
    expect(lockAt).toBeGreaterThan(txStart);
    expect(firstUpdate).toBeGreaterThan(lockAt);
  });
});
