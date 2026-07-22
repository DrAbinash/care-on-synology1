// §10 — USG demo write-safety guard.
//
// /radiology/usg-demo (UsgDemoMode) MUST be safe by construction: it may never
// write to any patient, worklist, PACS, Form F, AI, or messaging surface. The
// component achieves this by making NO network calls at all — it renders purely
// synthetic, in-memory samples. This test statically pins that property so a
// future edit that introduces a real write (fetch/mutation/api call) fails CI
// instead of silently letting the demo touch production data.
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "UsgDemoMode.tsx"), "utf8");

// Any of these appearing in the demo source would mean it can perform I/O.
const FORBIDDEN: Array<[string, RegExp]> = [
  ["fetch(", /\bfetch\s*\(/],
  ["XMLHttpRequest", /XMLHttpRequest/],
  ["navigator.sendBeacon", /sendBeacon/],
  ["axios", /\baxios\b/],
  ["useMutation", /useMutation/],
  ["useQuery", /useQuery/],
  ["apiRequest / api client", /\bapiRequest\b|@\/lib\/api|from ["']@\/lib\/queryClient/],
  [".post( / .put( / .patch( / .delete(", /\.(post|put|patch|delete)\s*\(/],
];

test("UsgDemoMode makes no write/network calls (safe by construction)", () => {
  const hits = FORBIDDEN.filter(([, re]) => re.test(SRC)).map(([label]) => label);
  expect(hits, `USG demo must not perform I/O, but found: ${hits.join(", ")}`).toEqual([]);
});

test("UsgDemoMode always shows the DEMO banner and supports reset", () => {
  expect(SRC).toMatch(/DEMO MODE/);
  expect(SRC).toMatch(/synthetic data only/i);
  expect(SRC).toMatch(/setResetKey/); // reset control present
});
