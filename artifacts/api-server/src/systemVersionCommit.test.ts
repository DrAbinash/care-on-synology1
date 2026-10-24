import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildIdentityPayload, parseImageBuildInfo } from "./lib/buildIdentity";

/**
 * Why this file exists: the login footer and Settings → About read `GIT_COMMIT` from the
 * environment, and only `deploy-synology.sh` refreshes that value in the NAS `.env`. He
 * deploys from the Synology Container Manager GUI, so the stamp froze at `2d51e8d7`
 * (16 September) while the image was built 24 October from `b12dafe7`, and the version
 * report on the strength of that stale string claimed production was 421 commits behind
 * main. `.env` no longer pins it, which stops the lie but leaves the field empty — so
 * these surfaces must fall through to the commit the image resolved about itself.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
/** Strip comments so the explanation above cannot satisfy a code assertion. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/(\s)\/\/[^/\n]*$/gm, "$1");

const systemSrc = code(readFileSync(join(SRC, "routes/system.ts"), "utf8"));

function routeBody(path: string): string {
  const start = systemSrc.indexOf(`router.get("${path}"`);
  if (start < 0) throw new Error(`route ${path} not found in routes/system.ts`);
  const next = systemSrc.indexOf("router.get(", start + 10);
  return systemSrc.slice(start, next > start ? next : systemSrc.length);
}

const IMAGE_WITH_COMMIT = parseImageBuildInfo(
  JSON.stringify({
    imageBuiltAt: "2026-10-24T02:53:13Z",
    commit: "b12dafe797d53fee712b5e9d1105bfd852ecdafe",
    identitySource: "build-context-git",
  }),
);
const IMAGE_WITHOUT_COMMIT = parseImageBuildInfo(null);

describe("the build identity outranks an unusable environment stamp", () => {
  test("an unpinned .env still reports the commit the image resolved", () => {
    // This is today's production condition: compose interpolates `${GIT_COMMIT:-unknown}`.
    const payload = buildIdentityPayload({ GIT_COMMIT: "unknown" }, IMAGE_WITH_COMMIT);
    expect(payload.commit.startsWith("b12dafe7")).toBe(true);
    expect(payload.identitySource).toBe("build-context-git");
  });

  test("the image commit outranks a stale stamp rather than being checked against it", () => {
    // The bug being prevented: a real-but-old value in the env must never win.
    const payload = buildIdentityPayload({ GIT_COMMIT: "2d51e8d7" }, IMAGE_WITH_COMMIT);
    expect(payload.commit.startsWith("b12dafe7")).toBe(true);
  });

  test("with no image identity the declared stamp is still reported, not swallowed", () => {
    const payload = buildIdentityPayload({ GIT_COMMIT: "2d51e8d7" }, IMAGE_WITHOUT_COMMIT);
    expect(payload.commit.startsWith("2d51e8d7")).toBe(true);
  });

  test("when nothing is known the answer is unknown, never a guess", () => {
    expect(buildIdentityPayload({}, IMAGE_WITHOUT_COMMIT).commit).toBe("unknown");
  });
});

describe("both version surfaces consult the build identity before giving up", () => {
  test("the login footer route falls back to build identity", () => {
    const body = routeBody("/api/system/version/short");
    expect(body).toContain("buildIdentityPayload()");
    // The old shape: the env stamp alone, with no fallthrough, which is what printed
    // a wrong commit for eight days and would now print "unknown" forever.
    expect(/commit:\s*\(?\s*process\.env\.GIT_COMMIT/.test(body)).toBe(false);
  });

  test("the full version route puts build identity ahead of the env chain", () => {
    const body = routeBody("/api/system/version");
    expect(body).toContain("buildIdentityPayload()");
    expect(body.indexOf("buildIdentityPayload()")).toBeLessThan(body.indexOf("process.env.GIT_COMMIT"));
  });

  test("a script-stamped value keeps working — the stamp is consulted, not retired", () => {
    expect(routeBody("/api/system/version/short")).toContain("process.env.GIT_COMMIT");
    expect(routeBody("/api/system/version")).toContain("process.env.GIT_COMMIT");
  });

  test("the footer commit stays an 8-character label", () => {
    expect(routeBody("/api/system/version/short")).toContain("slice(0, 8)");
  });
});
