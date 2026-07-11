/**
 * Pure decision logic for whether the bootstrap admin account should be
 * force-reset on this startup. Extracted into its own tiny module (rather
 * than living inline in index.ts) specifically so it can be unit tested
 * without importing index.ts itself — index.ts starts a real HTTP server
 * and connects to the database as top-level side effects, which makes it
 * unsafe to import directly in a test.
 *
 * Bug fixed here: seedBootstrapAdminIfNeeded() in index.ts previously had
 * `const force = true;` hardcoded, completely ignoring BOOTSTRAP_ADMIN_FORCE.
 * This meant the bootstrap admin's PIN was silently reset to the default on
 * EVERY container restart — including routine Synology Container Manager
 * rebuilds — even after the doctor had changed it through the UI.
 */
export function shouldForceBootstrapReset(env: NodeJS.ProcessEnv): boolean {
  return env["BOOTSTRAP_ADMIN_FORCE"] === "true" || env["BOOTSTRAP_ADMIN_FORCE"] === "1";
}
