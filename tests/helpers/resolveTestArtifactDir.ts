/**
 * Shared test artifact directory resolver.
 *
 * Order: CARE_TEST_ARTIFACT_DIR → /opt/cursor/artifacts → tmpdir()/care-test-artifacts.
 * Writes are diagnostics only — callers must treat failure as non-fatal.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function resolveArtifactDir(): string {
  const env = (process.env.CARE_TEST_ARTIFACT_DIR ?? "").trim();
  if (env) {
    mkdirSync(env, { recursive: true });
    return env;
  }
  const preferred = "/opt/cursor/artifacts";
  try {
    mkdirSync(preferred, { recursive: true });
    return preferred;
  } catch {
    const fallback = join(tmpdir(), "care-test-artifacts");
    mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

/** Best-effort diagnostic write. Returns the path written, or null on failure. */
export function writeTestArtifact(name: string, content: string | NodeJS.ArrayBufferView): string | null {
  try {
    const dir = resolveArtifactDir();
    const path = join(dir, name);
    writeFileSync(path, content);
    return path;
  } catch {
    return null;
  }
}

/** Best-effort merge into an existing JSON artifact object. */
export function mergeJsonArtifact(name: string, extra: Record<string, unknown>): void {
  try {
    const dir = resolveArtifactDir();
    const path = join(dir, name);
    let prev: Record<string, unknown> = {};
    try {
      prev = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      /* first writer */
    }
    writeFileSync(path, JSON.stringify({ ...prev, ...extra }, null, 2));
  } catch {
    /* diagnostic only */
  }
}
