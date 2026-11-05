/**
 * Premise pin for the teardown fix, run against the REAL installed library rather
 * than a mock: dcmjs-dimse's `Client` exposes `abort()` and `clearRequests()` and has
 * no `close()`. If a future version adds `close()`, this suite turns red and the
 * teardown helper can be revisited with evidence — no other test in this PR asserts
 * the library's shape, so nothing here can drift silently.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

describe("E. the pinned DIMSE library's actual surface", () => {
  it("E1 the installed dcmjs-dimse Client has abort and clearRequests, and no close", async () => {
    const dimse = (await import("dcmjs-dimse")) as unknown as Record<string, any>;
    const Client = dimse.Client ?? dimse.default?.Client;
    expect(typeof Client, "Client is exported").toBe("function");

    const entry = createRequire(import.meta.url).resolve("dcmjs-dimse");
    const version = JSON.parse(
      readFileSync(join(dirname(dirname(entry)), "package.json"), "utf8"),
    ).version as string;

    // Constructing a Client opens nothing — send() is what connects.
    const client = new Client();
    expect(typeof client.abort, `abort() exists in dcmjs-dimse@${version}`).toBe("function");
    expect(typeof client.clearRequests, `clearRequests() exists in dcmjs-dimse@${version}`).toBe("function");
    expect(typeof client.send).toBe("function");
    expect(typeof client.close, "close() belongs to Server, not Client").toBe("undefined");
  });

  it("E2 aborting a client that never sent throws, which is why teardown cannot be a bare call", async () => {
    const dimse = (await import("dcmjs-dimse")) as unknown as Record<string, any>;
    const Client = dimse.Client ?? dimse.default?.Client;
    const client = new Client();
    expect(() => client.abort()).toThrow(/Network has not been initialized/);
  });
});
