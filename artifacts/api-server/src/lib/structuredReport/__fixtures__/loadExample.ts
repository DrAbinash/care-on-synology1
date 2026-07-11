import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** Loads one of the D1 §17 worked-example fixtures by file name (parsed JSON, untyped —
 * the validator accepts `unknown` and is what actually asserts the shape). */
export function loadExample(fileName: string): unknown {
  const raw = readFileSync(join(here, fileName), "utf8");
  return JSON.parse(raw);
}
