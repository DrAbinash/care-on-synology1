/**
 * Structural guards on deploy/synology/care-hope-network.override.yml.
 *
 * This file has no runtime to execute — it is read by `docker compose -f` on the NAS,
 * which nothing in this repository does. So the guard is on its CONTENT, and it targets
 * the three ways an override like this damages a live deployment:
 *
 *  1. replacing `api`'s network list instead of adding to it — that detaches the API
 *     from care-db and care-redis, i.e. from the Bill Desk;
 *  2. declaring the network `external: true`, which makes `docker compose up` fail on a
 *     box where nobody created the network first, i.e. a CARE deploy blocked by a HOPE
 *     prerequisite (§2 puts it the other way round);
 *  3. drifting past networking into image/port/volume/env territory, which is where an
 *     "additive" file stops being additive.
 *
 * The additive claim itself was MEASURED on the production box against the live compose
 * file (resolved JSON, volume arrays sorted so a re-ordering is not miscounted,
 * base-vs-base as the control): 0 lines differ for the control, 1 line differs with the
 * override — the added `care_hope_net` membership. See
 * docs/CARE_ERP_DEPLOYMENT_RUNBOOK.md §14a. These guards exist so the file that was
 * measured cannot quietly become a different file afterwards.
 *
 * No YAML parser is imported: `yaml` is not a dependency of `scripts/`, and a test that
 * needed one would fail in CI on an install that is correct. The assertions are
 * line-oriented, which is also what makes drift impossible to sneak past.
 */
import { test, expect, describe } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(REPO, "deploy/synology/care-hope-network.override.yml");
const text = readFileSync(FILE, "utf8");

/** Everything that is not a comment or blank — the whole configuration, exactly. */
const configLines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));

const EXPECTED = [
  "name: care-hope-net",
  "",
  "services:",
  "  api:",
  "    networks:",
  "      - default",
  "      - care_hope_net",
  "",
  "networks:",
  "  care_hope_net:",
  "    name: care_hope_net",
  "    driver: bridge",
].filter((l) => l.trim());

describe("the override is exactly the membership change that was measured", () => {
  test("O1 nothing beyond the eight configuration lines was added", () => {
    // The strongest form of "additive": not one extra key. An `image:`, `ports:`,
    // `volumes:`, `environment:` or `env_file:` line appearing later fails here, and
    // `default` disappearing fails here too.
    expect(configLines).toEqual(EXPECTED);
  });

  test("O2 api keeps `default`, so it stays attached to its own database", () => {
    const nets = configLines.slice(configLines.indexOf("    networks:") + 1)
      .filter((l) => /^\s+- /.test(l));
    expect(nets).toEqual(["      - default", "      - care_hope_net"]);
    // Listing only the new network would REMOVE the implicit default in compose, and the
    // API would come back up with no route to care-db. That is a Bill Desk outage caused
    // by a HOPE change, so the order is asserted as well as the membership.
    expect(configLines.indexOf("      - default")).toBeLessThan(configLines.indexOf("      - care_hope_net"));
  });

  test("O3 the network is created when missing, never demanded as a prerequisite", () => {
    expect(text).not.toMatch(/^\s*external:\s*true\s*$/m);
    expect(text).not.toMatch(/^\s*external:\s*$/m);
    // A fixed `name:` is what lets HOPE's separate project say the same network. Without
    // it compose prefixes the project (`care-erp-github_care_hope_net`) and the peer's
    // `docker network connect` fails against a name nobody wrote down.
    expect(text).toMatch(/^  care_hope_net:\n\s+name: care_hope_net/m);
    expect(text).toMatch(/driver: bridge/);
  });

  test("O4 the file says applying it is the owner's decision, not this repository's", () => {
    // An operator reading only the file must learn that before they run anything.
    expect(text).toMatch(/NOT APPLIED BY ANYTHING IN THIS REPOSITORY/);
    expect(text).toMatch(/docs\/CARE_ERP_DEPLOYMENT_RUNBOOK\.md/);
    expect(text).toMatch(/config --quiet|--quiet|config/);
    expect(text).toMatch(/approval/);
  });

  test("O5 the defect is quoted with its measurement date, so a reader can re-run it", () => {
    expect(text).toMatch(/192\.168\.1\.137:7080/);
    expect(text).toMatch(/hope-route-probe\.mjs/);
    expect(text).toMatch(/2026-10-15/);
    // The two forms that answer today and break on the next recreate are named as
    // not-the-answer, so nobody "fixes" the route with one of them.
    expect(text).toMatch(/192\.168\.64\.1:7080/);
    expect(text).toMatch(/192\.168\.48\.4:5000/);
    expect(text).toMatch(/recreate/);
  });

  test("O6 no obsolete `version:` key (compose warns and some CI treats it as an error)", () => {
    expect(text).not.toMatch(/^version:/m);
    expect(text).toMatch(/^name: care-hope-net$/m);
  });
});
