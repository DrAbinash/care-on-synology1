// ─────────────────────────────────────────────────────────────────────────────
// Pack loader — parse YAML content packs from disk or in-memory strings.
// YAML syntax errors are captured per-file (never thrown) so the validator can
// report them alongside other issues (K1: "validate YAML syntax").
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { ContentPack, LoadedPack } from "./types";

/** Parse a single YAML string into a LoadedPack, capturing syntax errors. */
export function loadPackFromString(source: string, raw: string): LoadedPack {
  try {
    const parsed = parseYaml(raw, { prettyErrors: true }) as ContentPack;
    if (parsed == null || typeof parsed !== "object") {
      return { source, raw, parsed: null, parseError: "Pack is empty or not a YAML mapping" };
    }
    return { source, raw, parsed };
  } catch (err) {
    return { source, raw, parsed: null, parseError: err instanceof Error ? err.message : String(err) };
  }
}

/** Load every *.yaml / *.yml file in a directory (non-recursive), sorted by name. */
export function loadPacksFromDir(dir: string): LoadedPack[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort();
  return files.map((f) => loadPackFromString(f, readFileSync(join(dir, f), "utf8")));
}
