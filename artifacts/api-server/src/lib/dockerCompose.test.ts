import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Fix: care-migrate previously had no `profiles:` key, meaning a normal
// `docker compose up -d` would start it alongside every other service —
// contradicting the file's own comments, which claimed it was "NOT in the
// automatic startup chain." This risked care-migrate running a competing
// migration alongside care-db-patch-v2 during a routine Synology Container
// Manager rebuild. This test guards against that regression.
//
// Uses simple text-block parsing rather than a YAML library, to avoid
// adding a new dependency (or relying on one only present transitively)
// just for this one regression check.

const COMPOSE_PATH = resolve(__dirname, "../../../../docker-compose.yml");

function getServiceBlock(composeText: string, serviceName: string): string {
  // Matches from "  <serviceName>:" (2-space indented, top-level under
  // services:) up to the next 2-space-indented service key or EOF.
  const re = new RegExp(`\\n  ${serviceName}:\\n([\\s\\S]*?)(?=\\n  [a-zA-Z_-]+:\\n|\\nvolumes:\\n|$)`);
  const m = composeText.match(re);
  return m ? m[1] : "";
}

describe("docker-compose.yml — care-migrate manual-only guard", () => {
  const composeText = readFileSync(COMPOSE_PATH, "utf-8");

  test("care-migrate service block includes profiles: [manual] (or equivalent list form)", () => {
    const block = getServiceBlock(composeText, "migrate");
    expect(block, "migrate service block should exist and be non-empty").not.toBe("");
    const hasProfilesGate =
      /profiles:\s*\[\s*manual\s*\]/.test(block) ||
      /profiles:\s*\n\s*-\s*manual/.test(block);
    expect(hasProfilesGate, "migrate service must be gated behind profiles: [manual]").toBe(true);
  });

  test("core deployment services (db, db-patch-v2, schema-verify, api, web) are NOT profile-gated", () => {
    for (const name of ["db", "db-patch-v2", "schema-verify", "api", "web"]) {
      const block = getServiceBlock(composeText, name);
      expect(block, `service "${name}" should exist in docker-compose.yml`).not.toBe("");
      expect(block, `service "${name}" should not require a profile to start`).not.toMatch(/^\s*profiles:/m);
    }
  });
});
