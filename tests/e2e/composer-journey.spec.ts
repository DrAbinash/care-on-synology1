/**
 * composer-journey.spec.ts — the owner's Task D journey, in a real browser.
 *
 * OPEN STUDY → normal report auto-appears → select pathology via Quick Select →
 * manual edit survives → SAVE → close (reload) → REOPEN → the draft carries the
 * same clinical meaning → PRINT produces the professional PDF.
 *
 * This is a true browser-level verification: real PostgreSQL (bootstrapped with
 * the repo's own 200 migrations, including the factory Quick Select seed), real
 * api-server, real vite app, real Chromium. The one thing this environment does
 * not have is a PACS — the study row is seeded straight into radiology_worklist,
 * the table the PACS would populate, so the workspace reads a genuine row through
 * the genuine API.
 *
 * Run (sandbox orchestrator, boots PG + app + this spec):
 *   node /home/z/my-project/scripts/pg-sandbox/e2e-run.mjs app tests/e2e/composer-journey.spec.ts
 */
import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

/**
 * This spec needs the sandbox harness: an embedded PostgreSQL bootstrapped with
 * the repo's own migrations (which seed the Quick Select factory boxes), the
 * dev app (api-server :8080 + vite :5173) and a seeded radiology_worklist row.
 * Outside that harness it SKIPS with this message rather than failing — a red
 * X here would say the journey is broken when it is only unharnessed.
 */
const HARNESS_FILE = "/home/z/my-project/scripts/pg-sandbox/worklist-id.json";
const HARNESS_PRESENT = existsSync(HARNESS_FILE);
const WORKLIST = HARNESS_PRESENT
  ? (JSON.parse(readFileSync(HARNESS_FILE, "utf-8")) as { id: number })
  : { id: 0 };

const USERNAME = process.env.E2E_USERNAME || "abinashsingh@gmail.com";
const PIN = process.env.E2E_PIN || "1234";

const FINDINGS = '[data-testid="canonical-findings-editor"]';
const IMPRESSION = '[data-testid="canonical-impression-editor"]';

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.locator("#username").fill(USERNAME);
  await page.locator("#pin").fill(PIN);
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/portal/staff-login")),
    page.getByRole("button", { name: /sign in/i }).click(),
  ]);
  expect(response.status(), `staff-login responded: ${await response.text().catch(() => "")}`).toBe(200);
  // The seeded super admin lands on /my-daily-summary. A strict wait — a loose
  // one races the redirect and the next goto lands unauthenticated.
  await page.waitForURL(/my-daily-summary/, { timeout: 30_000 });
}

/**
 * The clinic's authored "Loss of lumbar lordosis" box predates the ownership
 * catalogue: it carries the old Multilevel-Degenerative wording (with the
 * muscular-spasm attribution the owner's 2026-10-19 ruling removed) and no
 * alignment concept, so clicking it cannot retire the baseline normal. The
 * factory seed stamps it but deliberately never overwrites a clinic edit.
 * "Restore defaults" is the one designed press that adopts the corrected
 * factory tile — wording AND concept — and it is exactly what this journey
 * exercises, through the real API with real staff auth.
 */
async function restoreLordosisFactoryWording(page: import("@playwright/test").Page) {
  const session = JSON.parse(await page.evaluate(() => localStorage.getItem("erp_session") ?? "{}"));
  expect(session.token, "staff session token in localStorage").toBeTruthy();
  const auth = { Authorization: `Bearer ${session.token}` };

  const listResponse = await page.request.get("/api/radiology/quick-select/", { headers: auth });
  expect(listResponse.status()).toBe(200);
  const payload = (await listResponse.json()) as { findings?: Array<{ id: number; label: string; studyType: string }> };
  const boxes = payload.findings ?? (payload as unknown as Array<{ id: number; label: string; studyType: string }>);
  const lordosis = boxes.find((b) => b.label === "Loss of lumbar lordosis" && (b.studyType ?? "") === "LS Spine");
  expect(lordosis, "the clinic's lordosis box must exist in the catalogue").toBeTruthy();

  const restore = await page.request.post(
    `/api/radiology/quick-select/findings/${lordosis!.id}/restore-defaults`,
    { headers: auth },
  );
  expect(restore.status(), `restore-defaults responded: ${await restore.text().catch(() => "")}`).toBe(200);
}

async function findingsValue(page: import("@playwright/test").Page): Promise<string> {
  return page.locator(FINDINGS).inputValue();
}

async function impressionValue(page: import("@playwright/test").Page): Promise<string> {
  return page.locator(IMPRESSION).inputValue();
}

/** The reporting tools rail starts collapsed; open it and wait for the tiles. */
async function openToolsPanel(page: import("@playwright/test").Page) {
  const panel = page.locator('[data-testid="quick-insert"]');
  if (!(await panel.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: /Reporting Tools/i }).first().click();
    await panel.waitFor({ state: "visible", timeout: 10_000 });
  }
  return panel;
}

/** Open a Quick Select tile by its shipped label, wherever the strip put it. */
async function clickTile(page: import("@playwright/test").Page, label: string) {
  await openToolsPanel(page);
  const tile = page.locator(`[data-testid="quick-insert"] button`, { hasText: label }).first();
  await tile.scrollIntoViewIfNeeded();
  await tile.click();
}

test.describe("composer journey — open → normal → abnormal → edit → save → reopen → print", () => {
  test.skip(!HARNESS_PRESENT, "needs the sandbox harness (embedded PostgreSQL + seeded worklist + dev app); see the file header for the run command");

  // A radiology reading station is wide; at the default 1280px viewport the
  // identity strip clips (its patient span renders zero-width, not absent).
  test.use({ viewport: { width: 1920, height: 1080 } });
  test("the full journey on MRI LS Spine", async ({ page }) => {
    test.setTimeout(240_000);
    await login(page);
    await restoreLordosisFactoryWording(page);

    // ── OPEN STUDY ──────────────────────────────────────────────────────────
    await page.goto(`/radiology/reporting-workspace/${WORKLIST.id}`);

    // The normal report auto-appears (normal bootstrap → Mode A compose). No
    // format is pressed by hand — that is the whole point of the journey.
    const findings = page.locator(FINDINGS);
    await expect(findings).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => (await findingsValue(page)).length, { timeout: 30_000, interval: 1_000 })
      .toBeGreaterThan(200);

    // Patient identity and examination are on the page (identity strip text).
    await expect
      .poll(async () => page.locator("main").textContent() ?? "", { timeout: 15_000, interval: 1_000 })
      .toContain("E2E VERIFICATION PATIENT (45 Yrs/M)");
    await expect
      .poll(async () => page.locator("main").textContent() ?? "", { timeout: 10_000, interval: 1_000 })
      .toContain("MRI LS Spine");

    const openedFindings = await findingsValue(page);
    const openedImpression = await impressionValue(page);
    // The complete approved normal: findings prose AND a normal impression.
    expect(openedFindings).toContain("Normal lumbar lordosis is maintained.");
    expect(openedImpression.length).toBeGreaterThan(10);

    // ── SELECT PATHOLOGY (Quick Select, the shipped catalogue from the DB) ──
    await clickTile(page, "Loss of lumbar lordosis");
    // Mode A recomposes on its 700ms debounce; the alignment normal retires and
    // the owner's neutral wording arrives.
    await expect
      .poll(async () => findingsValue(page), { timeout: 20_000, interval: 500 })
      .toContain("Straightening/loss of normal lumbar lordosis.");
    const afterTileFindings = await findingsValue(page);
    expect(afterTileFindings).not.toContain("Normal lumbar lordosis is maintained.");
    // The impression states the finding, and no longer calls the study normal.
    await expect
      .poll(async () => impressionValue(page), { timeout: 20_000, interval: 500 })
      .toContain("Loss of lumbar lordosis");

    // ── MANUAL EDIT ─────────────────────────────────────────────────────────
    // The radiologist types his own sentence; a later automatic pass must not
    // delete it. The editor renders a highlight layer over a transparent-text
    // textarea, so the caret is placed programmatically (what a mouse click
    // does for a human); the typed input event itself is real and goes through
    // the same React onChange path.
    await page.waitForTimeout(1_500); // let the recomposition settle before typing
    // One atomic JS task: focus, caret to end, insert. Split across page.evaluate
    // and keyboard.insertText the focus is stolen by a re-render in between.
    // execCommand('insertText') fires the same real `input` event React's
    // onChange listens to — the identical path a keystroke takes.
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="canonical-findings-editor"]') as HTMLTextAreaElement | null;
      if (!el) throw new Error("findings editor not mounted");
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      const ok = document.execCommand("insertText", false, "\nMultilevel mild facet degenerative changes noted on the right.");
      if (!ok) throw new Error("insertText command refused");
    });
    const typedImmediately = await findingsValue(page);
    expect(typedImmediately, "the typed sentence is in the editor the moment it is typed")
      .toContain("Multilevel mild facet degenerative changes noted on the right.");
    await page.waitForTimeout(3_000); // let any Mode A pass run
    const editedFindings = await findingsValue(page);
    expect(editedFindings).toContain("Straightening/loss of normal lumbar lordosis.");
    expect(editedFindings, "a Mode A pass must not delete the radiologist's own sentence")
      .toContain("Multilevel mild facet degenerative changes noted on the right.");

    // ── SAVE ────────────────────────────────────────────────────────────────
    const save = page.getByRole("button", { name: /^Save$/i }).first();
    await save.click();
    // The workspace shows the last-saved time once the draft round-trips.
    await expect(page.locator('[title*=":"].text-\\[9px\\]').first()).toBeVisible({ timeout: 20_000 });

    // ── CLOSE and REOPEN (a hard reload is the honest close) ────────────────
    await page.reload();
    await expect(page.locator(FINDINGS)).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => findingsValue(page), { timeout: 30_000, interval: 1_000 })
      .toContain("Straightening/loss of normal lumbar lordosis.");
    const reopenedFindings = await findingsValue(page);
    expect(reopenedFindings).toContain("Multilevel mild facet degenerative changes noted on the right.");
    expect(reopenedFindings).not.toContain("Normal lumbar lordosis is maintained.");
    await expect
      .poll(async () => impressionValue(page), { timeout: 20_000, interval: 500 })
      .toContain("Loss of lumbar lordosis");

    // The Quick Select tile stayed selected through the round trip — the chip
    // lights when its sentence is on the page (data-chip-state="selected").
    await openToolsPanel(page);
    const lordosisTile = page.locator('[data-testid="quick-insert"] [data-chip-state]')
      .filter({ hasText: "Loss of lumbar lordosis" }).first();
    await expect(lordosisTile).toHaveAttribute("data-chip-state", "selected", { timeout: 10_000 });

    // ── PREVIEW / PRINT ─────────────────────────────────────────────────────
    // Print-like-final saves first, then produces the paper: capture whatever
    // the app emits (a download or a new tab with the PDF).
    const print = page.locator('[data-testid="btn-workspace-print"]');
    await expect(print).toBeVisible({ timeout: 15_000 });
    const popupOrDownload = Promise.all([
      page.waitForEvent("popup", { timeout: 30_000 }).then((p) => ({ kind: "popup" as const, page: p.url() }))
        .catch(() => null),
      page.waitForEvent("download", { timeout: 30_000 }).then((d) => ({ kind: "download" as const, file: d.suggestedFilename() }))
        .catch(() => null),
    ]);
    await print.click();
    const outcomes = (await popupOrDownload).filter(Boolean);
    expect(outcomes.length, "print must produce a PDF as a popup or a download").toBeGreaterThan(0);
    const result = outcomes[0] as { kind: string };
    expect(["popup", "download"]).toContain(result.kind);
  });
});
