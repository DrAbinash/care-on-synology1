/**
 * Five behavioural journeys (§1 and §8 of the Word-replacement brief), in a real
 * browser, on synthetic patients only.
 *
 * These are the failures a source grep cannot see: a route test can prove a handler
 * refuses, but not that the study the radiologist reopened is the study they saved,
 * or that the paper that reached the printer is the artifact that was signed. Each test
 * therefore drives the real Composer UI — worklist row, Quick Select tile, the
 * Generate/Refine/Apply doors, Save, reload, sign, print — through the genuine API
 * against a real PostgreSQL.
 *
 * NOTHING HERE TOUCHES A PATIENT. The studies are seeded rows in `radiology_worklist`
 * (the table PACS would populate) with SYN- prefixed UHIDs and SYNACC accessions, on a
 * disposable cluster. A run against a database holding clinic records must be refused
 * by whoever points this at it: the identity assertions below match the synthetic names
 * exactly and fail loudly rather than read a real record.
 *
 * Every selector here was read off the shipped component or measured in the browser,
 * not guessed:
 *   editors            components/radiology/zai-workspace/findings-editor.tsx:483
 *                      (`canonical-<field>-editor`; Technique has its own literal at
 *                      ReportCanvas.tsx:1054)
 *   accordion          zai-workspace/report-section-accordion.tsx:115/156
 *                      (`report-section-<id>`, `report-section-header-<id>`)
 *   identity strip     components/radiology/workspace/ComposerIdentityStrip.tsx
 *   tiles              QuickFindingsPanel.tsx `quick-finding-<id>` inside the rail's
 *                      `quick-insert` pane (measured: `clinic-quick-select` is not
 *                      mounted on this study) and FindingsAnatomyStrip.tsx
 *                      `findings-anatomy-tile-<id>`
 *   side row           QuickFindingsPanel.tsx `quick-side-row` (+ data-side),
 *                      `quick-side-left|right|bilateral|unanswered`
 *   tools rail         ReportingToolsPanel.tsx (`reporting-tools`,
 *                      `reporting-tools-tab-<id>`, `reporting-tools-pane-<id>`,
 *                      `quick-insert-source-<id>`); collapsed rail opens on
 *                      `right-panel-expand` / `toggle-right-panel`
 *   generate           ReportCanvas.tsx:686 `generate-professional-report` — measured
 *                      to POST /api/radiology/report-formats/<id>/use. No AI.
 *   composer AI        ReportComposerAssistant.tsx (`ai-mode-observations`,
 *                      `ai-micro-command`, `ai-micro-run`, `ai-report-review`,
 *                      `ai-change-<id>`, `ai-apply-accepted`, `ai-compose-failed`)
 *   save / sign        ReportingStickyActionBar.tsx (`sticky-save-draft`, measured to
 *                      POST /api/radiology/report-generator/save-draft; `sticky-finalize`),
 *                      FinalizeSignDialog.tsx:519 (`finalize-confirm-sign`)
 *   print              WorkspaceTopBar.tsx:706 `btn-workspace-print`
 *
 * Harness:
 *   E2E_BASE_URL        the app under test                      (default :5173)
 *   E2E_STUDY_BRAIN / _LUMBAR / _CHEST / _US  seeded radiology_worklist ids, or
 *   E2E_WORKLIST_JSON   {"brain":1,"lumbar":2,"chest":3,"us":4}
 * Without a harness every test SKIPS with a reason: an X here would otherwise say
 * the journey is broken when it is only unharnessed.
 *
 * Run each journey against a CLEAN synthetic study. Journey 1 selects a box and types
 * into the recommendation of the lumbar study; journey 2 clicks the same box and reads
 * its chip state, so a leftover selection from journey 1 would make journey 2's click a
 * DEselection. `node tmp/rig-reset-journey.cjs <worklistId>` (gitignored rig helper) puts
 * a study back to a clean, unsigned, unmatched-free state between runs.
 */
import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

const USERNAME = process.env.E2E_USERNAME || "abinashsingh@gmail.com";
const PIN = process.env.E2E_PIN || "1234";

const FINDINGS = "canonical-findings-editor";
const IMPRESSION = "canonical-impression-editor";
const RECOMMENDATION = "canonical-recommendation-editor";
const TECHNIQUE = "canonical-technique-editor";
const IDENTITY = "composer-identity-strip";

type StudyIds = { brain: number; lumbar: number; chest: number; us: number };

function resolveStudies(): StudyIds | null {
  const fromEnv = (name: string): number | null => {
    const raw = process.env[name];
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const env: Partial<StudyIds> = {
    brain: fromEnv("E2E_STUDY_BRAIN") ?? undefined,
    lumbar: fromEnv("E2E_STUDY_LUMBAR") ?? undefined,
    chest: fromEnv("E2E_STUDY_CHEST") ?? undefined,
    us: fromEnv("E2E_STUDY_US") ?? undefined,
  };
  if (env.brain && env.lumbar && env.chest && env.us) return env as StudyIds;

  const jsonPath = process.env.E2E_WORKLIST_JSON;
  if (jsonPath && existsSync(jsonPath)) {
    const j = JSON.parse(readFileSync(jsonPath, "utf-8")) as Record<string, number>;
    const merged = {
      brain: j.brain ?? env.brain, lumbar: j.lumbar ?? env.lumbar,
      chest: j.chest ?? env.chest, us: j.us ?? env.us,
    };
    if (merged.brain && merged.lumbar && merged.chest && merged.us) return merged as StudyIds;
  }
  return null;
}

const STUDIES = resolveStudies();

/**
 * Bound a "wait until the app has mounted N of these" check. Playwright's `expect.poll`
 * around `locator.count()` does not return on this app — the strip mounts 55 tiles through
 * a react-query callback and the locator call never settles — so count through the page
 * itself, which is the same DOM read the probes use.
 */
async function waitMounted(page: Page, selector: string, timeoutMs = 20_000): Promise<number> {
  const started = Date.now();
  for (;;) {
    mark(`waitMounted ${selector} trying`);
    const n = await page.evaluate((sel) => document.querySelectorAll(sel).length, selector);
    mark(`waitMounted ${selector} -> ${n}`);
    if (n > 0) return n;
    if (Date.now() - started > timeoutMs) return 0;
    await page.waitForTimeout(400);
  }
}

let t0 = Date.now();
// `E2E_TIMING=1` prints where the minutes go. A journey that stalls is otherwise a
// silent timeout, and three of these five were built by reading that log.
const mark = (s: string) => {
  if (process.env.E2E_TIMING) console.log(`      ${String(Date.now() - t0).padStart(6)}ms ${s}`);
};

const value = (page: Page, testid: string) =>
  page.evaluate((id) => {
    const el = document.querySelector(`[data-testid='${id}']`) as
      | (HTMLTextAreaElement & HTMLInputElement)
      | null;
    if (!el) return null;
    return (el.value ?? el.textContent ?? "").trim();
  }, testid);

/**
 * The report is one accordion (report-section-accordion.tsx), and in the clinic's
 * exclusive mode only a section the radiologist has opened holds a live editor. Values
 * are read from the DOM rather than with `inputValue()` so a collapsed Recommendation
 * still has a value to check after a reload.
 */
async function ensureSectionOpen(page: Page, id: string) {
  const header = page.locator(`[data-testid="report-section-header-${id}"]`);
  if (!(await header.count())) return;
  if ((await header.getAttribute("aria-expanded")) === "true") return;
  await header.click();
  await page.waitForTimeout(800);
}

/**
 * The Findings/Impression fields are a transparent textarea over a highlight layer;
 * Playwright's `fill` bypasses the composition path the app listens to.
 * execCommand("insertText") is what a real keystroke produces.
 */
async function typeInto(page: Page, testid: string, text: string) {
  await ensureSectionOpen(page, testid.replace("canonical-", "").replace("-editor", ""));
  await page.locator(`[data-testid="${testid}"]`).first().waitFor({ state: "attached", timeout: 20_000 });
  const before = (await value(page, testid)) ?? "";
  await page.evaluate(({ testid, text }) => {
    const el = document.querySelector(`[data-testid='${testid}']`) as HTMLTextAreaElement | null;
    if (!el) throw new Error(`${testid} is not mounted`);
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    const ok = document.execCommand("insertText", false, ` ${text}`);
    if (!ok) throw new Error(`execCommand insertText refused in ${testid}`);
  }, { testid, text });
  await page.waitForTimeout(1_200);
  const after = (await value(page, testid)) ?? "";
  expect(after, `typing reached ${testid}`).toContain(text);
  expect(after.length, `${testid} grew by what was typed`).toBeGreaterThan(before.length);
}

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#username").fill(USERNAME);
  await page.locator("#pin").fill(PIN);
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/portal/staff-login")),
    page.getByRole("button", { name: /sign in/i }).click(),
  ]);
  expect(response.status(), `staff-login responded: ${await response.text().catch(() => "")}`).toBe(200);
  await page.waitForURL(/my-daily-summary|dashboard|radiology/, { timeout: 30_000 });
  t0 = Date.now(); mark("logged in");
  // Auto-advance after finalize would move the workspace to the next study under a
  // test that is still reading this one. It is a real clinic preference; a journey
  // that signs and then inspects must pin it off.
  await page.evaluate(() => localStorage.setItem("care_auto_advance_after_finalize", "false"));
}

async function openStudy(page: Page, id: number, modality: string) {
  await page.goto(`/radiology/report/${id}?modality=${modality}`);
  await expect(page.locator(`[data-testid="${FINDINGS}"]`)).toBeAttached({ timeout: 60_000 });
  await expect
    .poll(async () => (await value(page, FINDINGS))?.length ?? 0, { timeout: 60_000, interval: 1_000 })
    .toBeGreaterThan(40);
  mark("study open, findings hydrated");
}

/** Open the Reporting Tools rail on a named tab and wait for that pane. */
async function openRailTab(page: Page, tab: string) {
  const pane = page.locator(`[data-testid="reporting-tools-pane-${tab}"]`);
  if (await pane.isVisible().catch(() => false)) return pane;
  const panel = page.locator('[data-testid="reporting-tools"]');
  if (!(await panel.isVisible().catch(() => false))) {
    await page.locator('[data-testid="toggle-right-panel"]').first().click().catch(async () => {
      await page.getByRole("button", { name: /Reporting Tools/i }).first().click();
    });
    await panel.waitFor({ state: "visible", timeout: 20_000 });
    mark("rail opened");
  }
  await page.locator(`[data-testid="reporting-tools-tab-${tab}"]`).click();
  await pane.waitFor({ state: "visible", timeout: 20_000 });
  mark(`pane ${tab} visible`);
  return pane;
}

const tileScope = (page: Page) =>
  page.locator('[data-testid^="qs-tile-"], [data-testid^="quick-finding-"]');

/** Put the rail's Quick Insert pane on its "Quick Select" source and wait for its tiles. */
async function showQuickSelectSource(page: Page) {
  const pane = await openRailTab(page, "quick-insert");
  mark("pane ready, reading the source chip");
  const source = page.locator('[data-testid="quick-insert-source-quick-select"]');
  const selected = await source.getAttribute("aria-selected", { timeout: 5_000 })
    .catch((e) => { mark("source read failed " + String(e.message).slice(0, 60)); return null; });
  mark("source aria-selected=" + selected);
  if (selected !== "true") {
    await source.click({ timeout: 5_000 }).catch((e) => mark("quick-add source click failed: " + String(e.message).split("Call log")[0].slice(0, 90)));
  }
  mark("quick-add source was " + selected);
  expect(await waitMounted(page, '[data-testid^="qs-tile-findings-"]'),
    "the Quick Select strip mounted no tiles").toBeGreaterThan(0);
  mark("quick-select strip tiles mounted");
  return pane;
}

/**
 * The rail's "Quick Add" source renders QuickFindingsPanel — the mount that carries the
 * side row and the region picker. Measured: in the rail it is NOT wrapped in
 * `clinic-quick-select` (that testid belongs to the retired canvas drawer, ReportCanvas
 * `false &&` block), so the pane root and the panel's own controls are what to target.
 */
async function openQuickAddPanel(page: Page) {
  await openRailTab(page, "quick-insert");
  // The source chips sit in the panel header, OUTSIDE `reporting-tools-pane-*`; a
  // pane-scoped locator would wait for an element that is never inside it.
  const source = page.locator('[data-testid="quick-insert-source-quick-add"]');
  const selected = await source.getAttribute("aria-selected", { timeout: 5_000 })
    .catch(() => null);
  if (selected !== "true") {
    await source.click({ timeout: 5_000 }).catch((e) => mark("quick-add source click failed: " + String(e.message).slice(0, 90)));
  }
  expect(await waitMounted(page, '[data-testid="quick-add-change-region"]'),
    "the Quick Add source did not mount the Clinic Quick Select panel").toBeGreaterThan(0);
  mark("clinic quick-select panel mounted");
  return page.locator('[data-testid="quick-insert"]');
}

/** Point the Quick Add panel at a body region, the way the radiologist does. */
async function chooseRegion(page: Page, want: RegExp): Promise<string | null> {
  await page.locator('[data-testid="quick-add-change-region"]').click({ timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(600);
  const select = page.locator('[data-testid="quick-add-region"]');
  if (!(await select.count())) return null;
  const options = await select.locator("option").allInnerTexts();
  const pick = options.find((t) => want.test(t));
  if (!pick) return null;
  await select.selectOption({ label: pick });
  await page.locator('[data-testid="quick-add-region-done"]').click({ timeout: 5_000 }).catch(() => {});
  expect(await waitMounted(page, '[data-testid^="quick-finding-"]'),
    "the region change left the panel with no boxes").toBeGreaterThan(0);
  mark(`region ${pick} chosen`);
  return pick;
}

/** Find a shipped tile by its catalogue label, opening the rail if the study keeps it there. */
async function findTile(page: Page, label: string | RegExp) {
  const wanted = typeof label === "string"
    ? new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
    : label;
  let tile = tileScope(page).filter({ hasText: wanted }).first();
  if (!(await tile.isVisible().catch(() => false))) {
    await showQuickSelectSource(page);
    tile = tileScope(page).filter({ hasText: wanted }).first();
  }
  mark(`tile ${wanted}`);
  return tile;
}

/** Sentence set of a report body. */
const sentences = (t: string) =>
  (t || "").split(/(?<=[.!?])\s+/).map((x) => x.replace(/\s+/g, " ").trim()).filter((x) => x.length > 3);

/** What a click ADDED, in the words it was written in. */
const addedSentences = (before: string, after: string) => {
  const a = new Set(sentences(before));
  return sentences(after).filter((x) => !a.has(x));
};

/** What a click TOOK AWAY — the normal sentence the abnormal one replaces. */
const removedSentences = (before: string, after: string) => {
  const b = new Set(sentences(after));
  return sentences(before).filter((x) => !b.has(x));
};

/** Wait for a tile's chip state to become the one asked for, or give up honestly. */
async function waitChipState(page: Page, tile: import("@playwright/test").Locator, want: string, ms: number) {
  const until = Date.now() + ms;
  for (;;) {
    const now = await tile.getAttribute("data-chip-state").catch(() => null);
    if (now === want) return true;
    if (Date.now() > until) return false;
    await page.waitForTimeout(400);
  }
}

/**
 * The body that sits under one heading in the flat Findings string. The clinic's
 * ultrasound normal is authored one section per organ, and which section a sided
 * finding lands in is the clinical claim — not where its sentence ends up.
 */
function sectionOf(findings: string, heading: string): string {
  const start = findings.indexOf(heading);
  if (start < 0) return "";
  const rest = findings.slice(start + heading.length);
  const next = rest.search(/\n\s*[A-Z][A-Za-z &]*:\s/);
  return (next < 0 ? rest : rest.slice(0, next)).replace(/\s+/g, " ").trim();
}

/** Point the Quick Add panel at a region by its exact option label. */
async function chooseRegionByLabel(page: Page, label: string) {
  await page.locator('[data-testid="quick-add-change-region"]').click({ timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(500);
  const select = page.locator('[data-testid="quick-add-region"]');
  if (!(await select.count())) return;
  await select.selectOption({ label });
  await page.locator('[data-testid="quick-add-region-done"]').click({ timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(1_200);
  await waitMounted(page, '[data-testid^="quick-finding-"]', 15_000);
  mark(`region ${label} chosen`);
}

/**
 * Withdraw a box that is already on the page, through the door the app actually
 * provides: clicking a lit tile opens its review panel, and the panel's own
 * "Remove from report" is what takes the sentence out.
 *
 * Measured on the lumbar study: clicking a `data-chip-state="selected"` tile leaves
 * the chip selected and mounts `qs-review-findings-<id>` (quick-select-strip.tsx:595
 * routes a selected tile to review, not to un-apply — the two derivations on purpose,
 * because Left and Right of one box are two claims). An earlier probe of this flow
 * clicked the tile, saw the sentence still there, and reported the box as
 * un-withdrawable. It had not pressed Remove.
 */
async function withdrawTile(page: Page, tile: import("@playwright/test").Locator) {
  const testid = await tile.getAttribute("data-testid");
  await tile.click();
  const review = page.locator(`[data-testid="${testid!.replace("qs-tile-", "qs-review-")}"]`);
  await expect.poll(async () => await review.count(), { timeout: 15_000, interval: 500 })
    .toBeGreaterThan(0);
  await page.locator(`[data-testid="${testid!.replace("qs-tile-", "qs-remove-")}"]`).click({ timeout: 10_000 });
  await expect
    .poll(async () => await tile.getAttribute("data-chip-state").catch(() => null), { timeout: 20_000, interval: 500 })
    .not.toBe("selected");
  mark("box withdrawn through its review panel");
}

/**
 * Click a shipped Quick Select tile by label and hand back the tile for its chip state.
 *
 * `fromClean` matters because these journeys share one synthetic study: a box the
 * previous journey left selected would make this journey's click a review, not an
 * apply, and the test would measure the rig's history rather than the action it means
 * to prove. Taking it off first is the same two clicks the radiologist makes.
 */
async function clickTile(page: Page, label: string | RegExp, fromClean = false) {
  const tile = await findTile(page, label);
  await tile.waitFor({ state: "visible", timeout: 20_000 });
  await tile.scrollIntoViewIfNeeded();
  if (fromClean && (await tile.getAttribute("data-chip-state")) === "selected") {
    await withdrawTile(page, tile);
    mark("cleared a leftover selection before measuring this one");
  }
  await tile.click();
  mark("tile clicked");
  return tile;
}

const sideRow = (page: Page) => page.locator('[data-testid="quick-side-row"]').first();

/**
 * The rail's Quick Select strip has no aria-pressed on its side chips: the selected one
 * is the one carrying the active chip class (`bg-primary`, quick-select-strip.tsx:318).
 * Read the lit chip from the DOM so "nobody has chosen a side" is a fact, not a hope.
 */
const sideChipIds = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll('[data-testid^="qs-side-"]')]
    .map((e) => e.getAttribute("data-testid")));

const litSideChip = (page: Page) =>
  page.evaluate(() => {
    const on = [...document.querySelectorAll('[data-testid^="qs-side-"]')]
      .filter((e) => (e.className || "").includes("bg-primary"))
      .map((e) => e.getAttribute("data-testid"));
    return on.length ? on.join(",") : null;
  });

test.afterEach(async ({ page }, info) => {
  if (info.status === "passed" || info.status === "skipped") return;
  const name = info.titlePath.join("__").replace(/[^\w-]+/g, "_");
  await page.screenshot({ path: `test-results/${name}.png`, fullPage: true }).catch(() => {});
});

test.describe("the five journeys that decide whether Word can be retired", () => {
  test.skip(!STUDIES, "needs seeded synthetic studies — set E2E_STUDY_BRAIN/LUMBAR/CHEST/US or E2E_WORKLIST_JSON (see the file header)");
  test.use({ viewport: { width: 1920, height: 1080 } });

  test("1 · a second study opens clean: nothing carries from the study just read", async ({ page }) => {
    test.setTimeout(240_000);
    test.skip(!STUDIES || STUDIES.lumbar === STUDIES.brain,
      "needs two different seeded studies (E2E_STUDY_LUMBAR and E2E_STUDY_BRAIN)");
    await login(page);

    await openStudy(page, STUDIES!.lumbar, "MR");
    const lumbarIdentity = await value(page, IDENTITY);
    const lumbarFindings = await value(page, FINDINGS);
    const lumbarImpression = await value(page, IMPRESSION);
    expect(lumbarFindings!.length, "the lumbar study opened with a real report").toBeGreaterThan(40);
    expect(lumbarIdentity!, "the synthetic lumbar patient is who the strip says").toMatch(/Lumbar\^Synthetic/);

    // Answer a required parameter for THIS patient, then leave — the panel's side is
    // the state that used to travel, because the route reuses the workspace instance.
    await clickTile(page, "Disc bulge L3-L4", true);
    await expect.poll(async () => await value(page, FINDINGS), { timeout: 30_000, interval: 1_000 })
      .not.toBe(lumbarFindings);
    expect(await sideChipIds(page), "this study's strip offers a side choice").toContain("qs-side-left");
    expect(await litSideChip(page), "nobody has chosen a side yet").toBeNull();
    await page.locator('[data-testid="qs-side-left"]').click();
    await expect.poll(async () => await litSideChip(page), { timeout: 10_000, interval: 500 })
      .toBe("qs-side-left");
    await typeInto(page, RECOMMENDATION, "Reviewed for the lumbar study.");

    await page.goto(`/radiology/report/${STUDIES!.brain}?modality=MR`);
    await expect(page.locator(`[data-testid="${FINDINGS}"]`)).toBeAttached({ timeout: 60_000 });
    await expect.poll(async () => await value(page, FINDINGS), { timeout: 60_000, interval: 1_000 })
      .not.toBe(lumbarFindings);
    const brainFindings = await value(page, FINDINGS);

    // The clinical claim set, not the prose: a brain report may not carry the spine
    // study's sentences or the spine radiologist's own recommendation, and the strip
    // must have rebound to the second patient.
    expect(brainFindings!, "no sentence from the spine study's report")
      .not.toContain(lumbarFindings!.slice(0, 60));
    expect(brainFindings!, "no leftover abnormality from the spine study").not.toMatch(/disc bulge/i);
    expect(await value(page, RECOMMENDATION), "the previous study's recommendation did not travel")
      .not.toContain("Reviewed for the lumbar study.");
    expect(await value(page, IMPRESSION), "the spine impression did not travel").not.toBe(lumbarImpression);
    const brainIdentity = await value(page, IDENTITY);
    expect(brainIdentity!, "the identity strip rebound to the second patient").toContain("Brain^Synthetic");
    expect(brainIdentity!, "and holds none of the spine patient").not.toMatch(/Lumbar|SYN-MRI-002/);

    // The parameter the first radiologist chose is not pre-selected for the second: an
    // unanswered side makes a sided tile refuse, rather than guess, for this patient.
    await openRailTab(page, "quick-insert");
    await expect.poll(async () => await litSideChip(page), { timeout: 20_000, interval: 500 })
      .toBeNull();
  });

  test("2 · Quick Select → Generate → Save → reopen keeps every change intact", async ({ page }) => {
    test.setTimeout(240_000);
    await login(page);
    await openStudy(page, STUDIES!.lumbar, "MR");

    // The box the clinic actually presses on a lumbar study. If a journey before this
    // one left it selected, take it off first and prove it came off; if it will not come
    // off, say so rather than measure a deselection as if it were the click.
    const tile = await findTile(page, "Disc bulge L3-L4");
    await tile.scrollIntoViewIfNeeded().catch(() => {});
    if ((await tile.getAttribute("data-chip-state")) === "selected") {
      await withdrawTile(page, tile);
      const off = await waitChipState(page, tile, "idle", 15_000);
      test.skip(!off, "a selection left by an earlier journey on this study would not come off "
        + "— run this journey against a clean study (see the file header)");
    }
    const before = (await value(page, FINDINGS)) ?? "";
    await tile.click();
    const onByState = await waitChipState(page, tile, "selected", 20_000);
    expect(onByState, "the clicked box reads as applied").toBe(true);
    const withFinding = (await value(page, FINDINGS)) ?? "";
    const added = addedSentences(before, withFinding);
    const removed = removedSentences(before, withFinding);
    expect(added.length, "the clicked box wrote its finding").toBeGreaterThan(0);
    // The clinical contract Quick Select exists for: the abnormality REPLACES the normal
    // sentence it contradicts, so one report cannot say both about the same level.
    expect(removed.length, "a normal sentence was retired by the abnormal one").toBeGreaterThan(0);
    const marker = added[0];
    expect(marker, "and the sentence written is the disc bulge").toMatch(/disc bulge/i);
    expect(withFinding, "the retired normal is not still in the report at that level")
      .not.toMatch(/L3-L4: No significant disc bulge or protrusion is seen\./i);

    // Deterministic Generate (its own title says "No AI"): the report is rebuilt from
    // this examination's approved normal plus the recorded findings, so the selected
    // pathology must survive the rebuild.
    const generate = page.locator('[data-testid="generate-professional-report"]');
    await expect(generate).toBeVisible({ timeout: 30_000 });
    const rebuilt = page.waitForResponse((r) => /\/api\/radiology\/report-formats\/\d+\/use/.test(r.url()), { timeout: 60_000 });
    await generate.click();
    expect((await rebuilt).status(), "Generate rebuilt the report on the server").toBe(200);
    await expect
      .poll(async () => await value(page, FINDINGS), { timeout: 60_000, interval: 2_000 })
      .toContain(marker);
    const afterGenerate = await value(page, FINDINGS);
    expect(afterGenerate!.length, "Generate produced a report, not a fragment").toBeGreaterThan(200);
    expect(afterGenerate!, "Generate kept the examination's normal skeleton")
      .toMatch(/conus medullaris|paraspinal|vertebral bodies|liver|lung/i);

    const typed = "Clinical correlation with the ongoing physiotherapy response.";
    await typeInto(page, RECOMMENDATION, typed);

    const snapshot = {
      findings: afterGenerate!,
      impression: (await value(page, IMPRESSION)) ?? "",
      recommendation: (await value(page, RECOMMENDATION)) ?? "",
      technique: (await value(page, TECHNIQUE)) ?? "",
    };
    expect(snapshot.recommendation).toContain(typed);

    const saved = page.waitForResponse((r) => /\/api\/radiology\/report-generator\/save-draft/.test(r.url()), { timeout: 60_000 });
    await page.locator('[data-testid="sticky-save-draft"]').click();
    expect((await saved).status(), "the draft saved on the server").toBe(200);

    await page.reload();
    await expect(page.locator(`[data-testid="${FINDINGS}"]`)).toBeAttached({ timeout: 60_000 });
    const fields: Record<string, string> = {
      findings: FINDINGS, impression: IMPRESSION, recommendation: RECOMMENDATION, technique: TECHNIQUE,
    };
    for (const [field, text] of Object.entries(snapshot)) {
      if (!text) continue;
      await expect
        .poll(async () => await value(page, fields[field]!), { timeout: 60_000, interval: 1_000 })
        .toContain(text.slice(0, Math.min(text.length, 80)));
    }
    // Reopen restores the selection as a selection, not just as text: the same box still
    // reads applied, so pressing it again removes rather than duplicates.
    // Re-open the rail: after a reload it starts collapsed, so the tile has to be
    // mounted again before its chip state means anything.
    const reopened = await findTile(page, "Disc bulge L3-L4");
    await expect
      .poll(async () => await reopened.getAttribute("data-chip-state").catch(() => null),
        { timeout: 30_000, interval: 1_000 })
      .toBe("selected");
  });

  test("2b · a box applied in one session is withdrawn in the next, and the normal comes back", async ({ page }) => {
    test.setTimeout(300_000);
    // The eight steps as the radiologist lives them, because a report he cannot undo is
    // a report he will not trust: normal study → press the abnormality → the normal is
    // replaced → save and close → reopen → change his mind → withdraw → the ORIGINAL
    // normal sentence is back, with nothing duplicated and his own typing untouched.
    //
    // Measured on the rig (synthetic lumbar study 2, box 401) before this journey
    // existed: after Remove the Findings sentence set was identical to the original
    // clean report — 39 sentences, 0 added, 0 lost, 0 duplicates. The chip states along
    // the way were idle → selected → selected (reopened) → idle.
    const NORMAL = "L3-L4: No significant disc bulge or protrusion is seen.";
    await login(page);
    await openStudy(page, STUDIES!.lumbar, "MR");

    const tile = await findTile(page, "Disc bulge L3-L4");
    await tile.scrollIntoViewIfNeeded().catch(() => {});
    if ((await tile.getAttribute("data-chip-state")) === "selected") {
      await withdrawTile(page, tile);
      test.info().annotations.push({ type: "measured", description: "an earlier journey's selection was withdrawn first" });
    }
    const original = (await value(page, FINDINGS)) ?? "";
    expect(original, "1. the study starts as a normal report").toContain(NORMAL);
    expect(original).not.toMatch(/Disc bulge at L3-L4/i);

    await tile.click();
    expect(await waitChipState(page, tile, "selected", 20_000), "2. the box reads as applied").toBe(true);
    const applied = (await value(page, FINDINGS)) ?? "";
    expect(addedSentences(original, applied).length, "3. the abnormality was written").toBeGreaterThan(0);
    expect(applied, "3. and the normal it contradicts is gone").not.toContain(NORMAL);

    // His own words, so a withdrawal can be proved not to swallow them.
    const HIS = "Clinically, the patient reports left-sided radicular pain in an L5 distribution.";
    await typeInto(page, FINDINGS, `\n${HIS}`);
    const withHis = (await value(page, FINDINGS)) ?? "";
    expect(withHis).toContain(HIS);

    const saved1 = page.waitForResponse((r) => /\/api\/radiology\/report-generator\/save-draft/.test(r.url()), { timeout: 60_000 });
    await page.locator('[data-testid="sticky-save-draft"]').click();
    expect((await saved1).status()).toBe(200);
    // 4. close — a reload is the closest thing this app has to closing the study.
    await page.reload();
    await expect.poll(async () => await value(page, FINDINGS), { timeout: 60_000, interval: 1_000 })
      .toContain(HIS);
    await showQuickSelectSource(page);

    // 5. reopen: the box still reads as applied, and pressing it reviews rather than
    // re-applies, because a second write of one claim is a duplicated sentence.
    const again = await findTile(page, "Disc bulge L3-L4");
    await expect
      .poll(async () => await again.getAttribute("data-chip-state").catch(() => null),
        { timeout: 30_000, interval: 1_000 })
      .toBe("selected");
    expect(await value(page, FINDINGS), "5. reopening did not print the finding twice")
      .not.toMatch(/Disc bulge at L3-L4[\s\S]*Disc bulge at L3-L4/i);

    // 6. withdraw it.
    await withdrawTile(page, again);

    // 7. the ORIGINAL normal statement is back, not a paraphrase of it.
    const withdrawn = (await value(page, FINDINGS)) ?? "";
    expect(withdrawn, "7. the retired normal sentence was restored").toContain(NORMAL);
    expect(withdrawn).not.toMatch(/Disc bulge at L3-L4/i);
    expect(withdrawn, "7. the radiologist's own sentence survived the withdrawal").toContain(HIS);

    // 8. nothing contradictory and nothing doubled: every sentence the report holds is
    // one the report held before, plus his.
    const before = new Set(sentences(original));
    const leftover = sentences(withdrawn).filter((s) => !before.has(s) && s !== sentences(HIS)[0]);
    expect(leftover, `withdrawal left wording behind that was never there: ${leftover.join(" || ")}`).toEqual([]);
    const counts = sentences(withdrawn);
    const doubled = counts.filter((s, i) => counts.indexOf(s) !== i);
    expect(doubled, "no sentence appears twice").toEqual([]);

    // And it is still gone after the next save — a withdrawal that only lives in the
    // tab's memory would return on reopen and contradict the Impression.
    const saved2 = page.waitForResponse((r) => /\/api\/radiology\/report-generator\/save-draft/.test(r.url()), { timeout: 60_000 });
    await page.locator('[data-testid="sticky-save-draft"]').click();
    expect((await saved2).status()).toBe(200);
    await page.reload();
    await expect.poll(async () => await value(page, FINDINGS), { timeout: 60_000, interval: 1_000 })
      .toContain(NORMAL);
    await showQuickSelectSource(page);
    const finalTile = await findTile(page, "Disc bulge L3-L4");
    expect(await finalTile.getAttribute("data-chip-state"), "8. the withdrawal persisted across the close")
      .not.toBe("selected");
  });

  test("3 · refining one sentence leaves the rest of the report alone", async ({ page }) => {
    test.setTimeout(420_000);
    await login(page);
    // Refine runs through the local Composer, whose context ceiling is fixed (8192
    // tokens, composerContextBudget.ts). The lumbar report's per-level skeleton needs
    // ~11k on its own and is refused before anything is sent — measured, and reported —
    // so this journey runs on the study whose report fits, which is the one the clinic
    // can actually refine today.
    const refineStudy = Number(process.env.E2E_STUDY_REFINE || STUDIES!.chest);
    await openStudy(page, refineStudy, process.env.E2E_STUDY_REFINE_MODALITY || "CT");
    const beforeFindings = await value(page, FINDINGS);
    const beforeImpression = await value(page, IMPRESSION);

    // Journey 2 owns the Quick Select contract; this one owns the Refine door, so it
    // refines a sentence the shipped report already holds.
    await openRailTab(page, "ai");
    const observations = page.locator('[data-testid="ai-mode-observations"]');
    if (await observations.isVisible().catch(() => false)) await observations.click();
    const instruction = page.locator('[data-testid="ai-micro-command"]');
    // The AI pane renders its assistant after the study's session config loads; an
    // immediate isVisible() check races it and reports "not mounted".
    expect(await waitMounted(page, '[data-testid="ai-micro-command"]', 30_000),
      "the per-sentence Refine control never mounted").toBeGreaterThan(0);
    const firstSentence = (beforeFindings ?? "").split(/(?<=[.!?])\s+/).find((x) => x.length > 30) ?? "";
    expect(firstSentence.length, "the report has a sentence to refine").toBeGreaterThan(30);
    await instruction.fill(`Make this sentence shorter and plainer, keep every clinical fact: ${firstSentence}`);
    // A draft from an earlier session can still be on screen (the job is restored with
    // the study). Discard it first, or the wait below would be satisfied by the old
    // proposal and the journey would measure nothing.
    const review0 = page.locator('[data-testid="ai-report-review"]');
    if (await review0.isVisible().catch(() => false)) {
      await page.getByRole("button", { name: /Discard Revision/i }).first().click().catch(() => {});
      await review0.waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
      mark("previous AI draft discarded");
    }
    await page.locator('[data-testid="ai-micro-run"]').click();
    mark("refine submitted");

    const review = page.locator('[data-testid="ai-report-review"]');
    const failed = page.locator('[data-testid="ai-compose-failed"]');
    const outcome = await Promise.race([
      review.waitFor({ state: "visible", timeout: 300_000 }).then(() => "review" as const),
      failed.waitFor({ state: "visible", timeout: 300_000 }).then(() => "failed" as const),
    ]);
    const failureText = outcome === "failed" ? await failed.innerText().catch(() => "") : "";
    const provenance = (await page.locator('[data-testid="ai-compose-provenance"]').innerText()
      .catch(() => failureText)).replace(/\s+/g, " ").slice(0, 240);
    test.info().annotations.push({ type: "measured", description: `refine outcome=${outcome} · ${provenance}` });
    expect(outcome, `refine refused: ${provenance}`).toBe("review");

    const changeRows = page.locator('[data-testid^="ai-change-"]');
    await expect.poll(async () => await changeRows.count(), { timeout: 10_000, interval: 1_000 })
      .toBeGreaterThanOrEqual(0);
    const rowCount = await changeRows.count();
    if (rowCount === 0) {
      // No tracked change came back. Then the only honest behaviours are: the report is
      // untouched, and the Apply door refuses rather than writing the draft blind.
      expect(await value(page, FINDINGS), "a proposal with no accepted change wrote nothing")
        .toBe(beforeFindings);
      await expect(page.locator('[data-testid="ai-apply-accepted"]')).toBeDisabled();
      const stale = /STALE/.test(await review.innerText().catch(() => ""));
      const evidence = (await review.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 320);
      const badge = (await page.locator('[data-testid="ai-compose-status-badge"]')
        .innerText().catch(() => "")).replace(/\s+/g, " ");
      mark("SKIP (no tracked change)");
      const why = `${stale ? "panel marked the draft STALE" : "no tracked change returned"} · `
        + `badge="${badge}" · ${evidence} · nothing existed to apply, so the door refused `
        + "(measured on this box and reported; not a pass)";
      test.skip(true, why);
      return;
    }

    // Accept the proposal, apply it, and measure what the rest of the report did.
    await page.getByRole("button", { name: /Accept Revision/i }).first().click();
    const apply = page.locator('[data-testid="ai-apply-accepted"]');
    // This is the door that was broken. The client enables Apply on `status === "READY"`
    // and the server had already written STALE_READY, because the tab re-hashed the
    // report WITHOUT the four request-scoped fields `input_hash` covers — the instruction
    // it had typed and the sentence it had selected. Measured on this very journey:
    // stored `16c16133…` against the tab's own `de835134…`, `reportRevision` equal on
    // both sides, nothing in the report changed. The job view now hands that scope back
    // and the tab folds it in, so a draft of an untouched report is applicable.
    await expect
      .poll(async () => await apply.isDisabled().catch(() => true), { timeout: 30_000, interval: 1_000 },
        { message: "Apply accepted changes stayed disabled on a report nobody edited" })
      .toBe(false);
    await apply.click();
    await expect.poll(async () => await value(page, FINDINGS), { timeout: 60_000, interval: 1_000 })
      .not.toBe(beforeFindings);
    const after = await value(page, FINDINGS);
    expect(after!.length, "the refined Findings is still a report, not a fragment").toBeGreaterThan(80);
    expect(await value(page, IMPRESSION), "refining one Findings sentence did not rewrite the Impression")
      .toBe(beforeImpression);
    // Conservation, measured: the sentences the model was not asked about survive.
    const kept = (beforeFindings ?? "").split(/(?<=[.!?])\s+/).filter((x) => x.length > 30);
    const lost = kept.filter((x) => !after!.includes(x) && x !== firstSentence);
    expect(lost.length, `only the target sentence may change; lost: ${lost.join(" || ")}`).toBeLessThanOrEqual(1);

    const saved = page.waitForResponse((r) => /\/api\/radiology\/report-generator\/save-draft/.test(r.url()), { timeout: 60_000 });
    await page.locator('[data-testid="sticky-save-draft"]').click();
    expect((await saved).status()).toBe(200);
    await page.reload();
    await expect.poll(async () => await value(page, FINDINGS), { timeout: 60_000, interval: 1_000 })
      .toBe(after);
  });

  test("3b · a Refine draft the radiologist edited away from IS still refused", async ({ page }) => {
    test.setTimeout(420_000);
    // The other half of the fix, and the half that matters clinically. Journey 3 proves
    // an unchanged report no longer invalidates its own draft; this proves the check did
    // not simply get deleted: edit the report while the AI draft sits in the review pane
    // and the accepted text must NOT be written over the new sentence. A draft composed
    // against the older report would silently drop whatever was typed in between.
    await login(page);
    // The wire is part of the claim: a refusal that only looks polite in the panel but
    // still POSTs /applied would write the stale text. Every composer call is kept.
    const composerRequests: string[] = [];
    page.on("request", (r) => {
      if (/report-composer\/jobs\/\d+\/(applied|freshness)/.test(r.url())) composerRequests.push(r.url());
    });
    const refineStudy = Number(process.env.E2E_STUDY_REFINE || STUDIES!.chest);
    await openStudy(page, refineStudy, process.env.E2E_STUDY_REFINE_MODALITY || "CT");
    const beforeFindings = await value(page, FINDINGS);
    const beforeImpression = await value(page, IMPRESSION);

    await openRailTab(page, "ai");
    expect(await waitMounted(page, '[data-testid="ai-micro-command"]', 30_000),
      "the per-sentence Refine control never mounted").toBeGreaterThan(0);
    const review0 = page.locator('[data-testid="ai-report-review"]');
    if (await review0.isVisible().catch(() => false)) {
      await page.getByRole("button", { name: /Discard Revision/i }).first().click().catch(() => {});
      await review0.waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
    }
    // Ask about the LONGEST sentences, not the first one. Journey 3 refines the first
    // long sentence on this same study and saves it, and a qwen3:14b rewrite of text the
    // clinic has already simplified comes back byte-identical — no tracked change, so
    // there is nothing for the refusal to block. Length is the honest proxy for "this
    // sentence can still be reworded", and the attempt loop names what it asked for.
    const sentences = (beforeFindings ?? "")
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 30)
      // This journey writes the sentence below into the report; a previous run that
      // autosaved it must not become this run's refine target.
      .filter((s) => !/radiologist added this sentence/i.test(s))
      .sort((a, b) => b.length - a.length);
    expect(sentences.length, "the report has a sentence to refine").toBeGreaterThan(0);

    const review = page.locator('[data-testid="ai-report-review"]');
    const failed = page.locator('[data-testid="ai-compose-failed"]');
    const changeRows = page.locator('[data-testid^="ai-change-"]');
    let asked = "";
    let outcome: "review" | "failed" | "none" = "none";
    for (const target of sentences.slice(0, 2)) {
      asked = target;
      await page.locator('[data-testid="ai-micro-command"]')
        .fill(`Rewrite this sentence in plainer English as short sentences, keeping every clinical fact: ${target}`);
      await page.locator('[data-testid="ai-micro-run"]').click();
      mark(`refine submitted for "${target.slice(0, 48)}…"`);
      outcome = await Promise.race([
        review.waitFor({ state: "visible", timeout: 300_000 }).then(() => "review" as const),
        failed.waitFor({ state: "visible", timeout: 300_000 }).then(() => "failed" as const),
      ]);
      if (outcome === "failed") break;
      // The panel renders before the tracked-change rows are diffed in.
      await expect.poll(async () => await changeRows.count(), { timeout: 60_000, interval: 1_000 })
        .toBeGreaterThanOrEqual(0);
      if ((await changeRows.count()) > 0) break;
      mark(`no tracked change for "${target.slice(0, 40)}…" — the model returned the same words`);
      await page.getByRole("button", { name: /Discard Revision/i }).first().click().catch(() => {});
      await review.waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
    }
    let provenance = await page.locator('[data-testid="ai-compose-provenance"]').innerText().catch(() => "");
    if (!provenance) provenance = await failed.innerText().catch(() => "");
    provenance = provenance.replace(/\s+/g, " ").slice(0, 240);
    test.info().annotations.push({
      type: "measured",
      description: `refine outcome=${outcome} rows=${await changeRows.count()} asked="${asked.slice(0, 60)}" · ${provenance}`,
    });
    expect(outcome, `the AI PC refused the refine request: ${provenance}`).toBe("review");
    if ((await changeRows.count()) === 0) {
      const badge = (await page.locator('[data-testid="ai-compose-status-badge"]')
        .innerText().catch(() => "")).replace(/\s+/g, " ");
      test.skip(true, `no tracked change came back for either sentence tried (badge "${badge}"), so there `
        + "was nothing to edit away from — the refusal path needs a live proposal to block");
      return;
    }
    await page.getByRole("button", { name: /Accept Revision/i }).first().click();
    mark("one change accepted; now the radiologist edits the report underneath it");

    // A real edit in the editor, through the same keystroke path the workspace uses.
    const note = "The radiologist added this sentence after the AI draft arrived.";
    await ensureSectionOpen(page, "findings");
    await typeInto(page, FINDINGS, `\n${note}`);
    const edited = await value(page, FINDINGS);
    expect(edited, "the manual edit is in the report before Apply is attempted").toContain(note);
    expect(edited).not.toBe(beforeFindings);

    // Measured, and worth naming: the reporting pane collapses the tools rail the moment
    // it is used (`ReportCanvas.tsx:623` → `enterReportingFocusMode()`), so the draft
    // leaves the screen with the rail. The radiologist gets it back by reopening the tab
    // — which is what the next two lines do, and what a real user does.
    const railGone = (await page.locator('[data-testid="reporting-tools-tab-ai"]').count()) === 0;
    test.info().annotations.push({
      type: "measured",
      description: `editing the report ${railGone ? "collapsed the tools rail (the draft left the screen)" : "left the tools rail open"}`,
    });
    if (railGone) {
      await page.locator('[data-testid="toggle-right-panel"]').click({ timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(1_200);
      await page.locator('[data-testid="reporting-tools-tab-ai"]').click({ timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(2_000);
    }
    expect(await waitMounted(page, '[data-testid="ai-apply-accepted"]', 20_000),
      "the accepted draft was silently lost when the rail was reopened").toBeGreaterThan(0);

    const apply = page.locator('[data-testid="ai-apply-accepted"]');
    // Read the DOM directly rather than `locator.isDisabled()`: an actionability wait on
    // a control that a rail collapse has just removed is what made the first run of this
    // journey consume its entire 420 s timeout without ever failing.
    const applyDisabled = () => page.evaluate(() => {
      const el = document.querySelector('[data-testid="ai-apply-accepted"]') as HTMLButtonElement | null;
      return el ? !!el.disabled : "missing";
    });
    const appliedRequests = () => composerRequests.filter((u) => /\/applied/.test(u));
    if ((await applyDisabled()) === true) {
      test.info().annotations.push({ type: "measured", description: "Apply was already disabled when the rail reopened" });
    } else {
      // Bounded: an unbounded `click()` waits for actionability forever here, and the
      // first run of this journey burned its whole 420 s budget on that.
      const landed = await apply.click({ timeout: 15_000 }).then(() => true).catch(() => false);
      test.info().annotations.push({
        type: "measured",
        description: `Apply click ${landed ? "landed" : "did not land"} on a draft the report has moved away from`,
      });
    }

    await expect
      .poll(async () => (await page.locator('[data-testid="ai-compose-status-badge"]').innerText().catch(() => "")).trim(),
        { timeout: 60_000, interval: 1_000 },
        { message: "the panel never named the staleness it refused for" })
      .toMatch(/STALE/);
    await expect
      .poll(applyDisabled, { timeout: 30_000, interval: 1_000 })
      .toBe(true);

    // Nothing was written: no confirm-applied call reached the server, and the report is
    // byte-identical to what the radiologist typed. This is the whole point of the check.
    await page.waitForTimeout(4_000);
    expect(appliedRequests(), "an out-of-date draft was confirmed to the server").toEqual([]);
    const after = await value(page, FINDINGS);
    expect(after, "an AI draft composed against the previous report overwrote the newer edit")
      .toBe(edited);
    expect(await value(page, IMPRESSION), "the Impression was not rewritten either").toBe(beforeImpression);
    const panel = (await review.innerText().catch(() => "")).replace(/\s+/g, " ");
    expect(`${panel} ${(await page.locator('[data-testid="ai-compose-status-badge"]').innerText().catch(() => "")).replace(/\s+/g, " ")}`,
      "the refusal should say the draft is out of date").toMatch(/STALE|out of date|changed since/i);
  });

  test("4 · sign, print the signed artifact, reopen it unchanged", async ({ page }) => {
    test.setTimeout(240_000);
    await login(page);
    await openStudy(page, STUDIES!.chest, "CT");
    const signedFindings = await value(page, FINDINGS);
    const signedImpression = await value(page, IMPRESSION);

    const finalize = page.locator('[data-testid="sticky-finalize"]');
    await expect(finalize).toBeVisible({ timeout: 30_000 });
    test.skip(await finalize.isDisabled().catch(() => false),
      `Confirm & Sign is disabled for this synthetic study — could not test the signing journey`);
    await finalize.click();

    const confirm = page.locator('[data-testid="finalize-confirm-sign"]');
    await expect(confirm).toBeVisible({ timeout: 30_000 });
    // The clinic prints from the sign dialog itself: once a study is signed the canvas
    // Print door goes away, and the dialog's own "Print the signed report when finalize
    // completes" is what puts paper in the tray. That is the pathway §7 is about.
    const printAfterSign = page.locator('[data-testid="finalize-print-after-sign"]');
    if (await printAfterSign.isVisible().catch(() => false)) {
      await printAfterSign.click();
      expect(await printAfterSign.getAttribute("aria-pressed").catch(() => "true"),
        "print-after-sign is switched on").not.toBe("false");
    }
    // Registered BEFORE the click: the app fires the frozen-artifact print about 100 ms
    // after the sign answers, so a listener attached after the sign would miss it.
    const frozenPrint = new Promise<import("@playwright/test").Response>((resolve, reject) => {
      const done = setTimeout(() => reject(new Error("no /api/patient-reports/<id>/print request reached the browser in 120s")), 120_000);
      page.context().on("response", (r) => {
        if (/\/api\/patient-reports\/\d+\/print(\?|$)/.test(r.url()) && !r.url().includes("preview=true")) {
          clearTimeout(done);
          resolve(r);
        }
      });
    });
    const signedResponse = page.waitForResponse((r) => /\/api\/patient-reports\/\d+\/sign/.test(r.url()) && r.status() === 200, { timeout: 120_000 });
    await confirm.click();
    expect((await signedResponse).status(), "the signature was accepted").toBe(200);
    // The word "signed" appears in the worklist counters whatever happens, so read the
    // lock chip itself: it is the control's own statement about the report.
    await expect
      .poll(async () => await value(page, "signed-report-lock"), { timeout: 60_000, interval: 2_000 })
      .toMatch(/locked|signed/i);
    await expect(page.locator('[data-testid="sticky-finalize"]')).toBeDisabled({ timeout: 30_000 });

    // The paper must be the artifact the server froze at signing, not a live merge of
    // what the editor happens to hold — and it must carry no draft watermark.
    const printed = await frozenPrint;
    const workspacePrint = page.locator('[data-testid="btn-workspace-print"]');
    mark(`workspace Print door after signing: visible=${await workspacePrint.isVisible().catch(() => false)}`);
    expect(printed.status(), "the signed artifact printed from the server").toBe(200);
    const paper = await printed.text();
    expect(paper.length, "the print route returned a document").toBeGreaterThan(500);
    expect(paper.replace(/\s+/g, " "), "the printed paper carries the signed impression")
      .toContain(signedImpression!.slice(0, 40).replace(/\s+/g, " ").trim());
    expect(paper, "a signed report prints with no draft watermark")
      .not.toMatch(/DRAFT \(not signed\)|PREVIEW — NOT SIGNED|PREVIEW - NOT SIGNED/i);
    expect(paper, "the printed paper names the signer or the registration").toMatch(/Sign|Registration|Report #/i);

    const popup = await page.context().waitForEvent("page", { timeout: 60_000 }).catch(() => null);
    if (popup) {
      await popup.waitForLoadState("domcontentloaded").catch(() => {});
      const onScreen = await popup.locator("body").innerText().catch(() => "");
      expect(onScreen, "the window that reached the printer is the signed paper")
        .not.toMatch(/DRAFT \(not signed\)|PREVIEW — NOT SIGNED/i);
      await popup.close().catch(() => {});
    }

    await page.reload();
    await expect(page.locator(`[data-testid="${FINDINGS}"]`)).toBeAttached({ timeout: 60_000 });
    await expect.poll(async () => await value(page, FINDINGS), { timeout: 60_000, interval: 1_000 })
      .toBe(signedFindings);
    expect(await value(page, IMPRESSION), "the signed words did not shift on reopen").toBe(signedImpression);
  });

  test("5 · an unanswered laterality is refused, never invented", async ({ page }) => {
    test.setTimeout(300_000);
    await login(page);
    await openStudy(page, STUDIES!.us, "US");
    const before = await value(page, FINDINGS);

    await openQuickAddPanel(page);
    // The renal-calculus box lives in whichever Quick Add region holds the kidneys, and
    // the region names are clinic-authored, so walk the candidates instead of guessing
    // one. The region picker only exists once "Change / all regions" is pressed.
    await page.locator('[data-testid="quick-add-change-region"]').click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(800);
    const regionOptions = await page.locator('[data-testid="quick-add-region"] option').allInnerTexts()
      .then((xs) => xs.map((x) => x.trim()).filter(Boolean)).catch(() => [] as string[]);
    mark(`regions offered: ${regionOptions.join(" | ").slice(0, 300)}`);
    const candidates = regionOptions.filter((o) => /kidney|renal|urinary|kub|abdomen/i.test(o));
    let calculus = page.locator('[data-testid^="quick-finding-"]').filter({ hasText: /renal calculus/i }).first();
    for (const option of candidates) {
      if (await calculus.isVisible().catch(() => false)) break;
      await chooseRegionByLabel(page, option);
      calculus = page.locator('[data-testid^="quick-finding-"]').filter({ hasText: /renal calculus/i }).first();
    }
    const found = await calculus.isVisible().catch(() => false);
    test.skip(!found, `no "Renal calculus" box is listed in any of the ${candidates.length} `
      + `kidney-bearing regions (offered: ${regionOptions.join(" | ").slice(0, 240)})`
      + " — could not test laterality refusal");
    test.skip(!(await sideRow(page).isVisible().catch(() => false)),
      "no Quick Select box on this study asks for a side — could not test laterality refusal");
    expect(await sideRow(page).getAttribute("data-side"), "the side row must open unanswered").toBe("unanswered");

    // The dangerous case: a sided box, no side chosen. Nothing may be written, and the
    // refusal must name the remedy the radiologist can act on.
    await calculus.click();
    await page.waitForTimeout(3_000);
    expect(await value(page, FINDINGS), "a sided box with no side chosen writes nothing").toBe(before);
    expect(await page.locator("body").innerText(), "and the refusal says what to choose")
      .toMatch(/choose the side|Nothing was applied/i);

    await page.locator('[data-testid="quick-side-left"]').click();
    await expect(sideRow(page)).toHaveAttribute("data-side", "left");
    await calculus.click();
    await expect.poll(async () => await value(page, FINDINGS), { timeout: 30_000, interval: 1_000 })
      .not.toBe(before);
    const after = await value(page, FINDINGS) ?? "";
    const leftSection = sectionOf(after, "Left Kidney:");
    const rightSection = sectionOf(after, "Right Kidney:");
    expect(leftSection, "the chosen side's stone is written under its own heading")
      .toMatch(/calculus in the left kidney/i);
    expect(rightSection, "the other kidney is not made to carry it").not.toMatch(/calculus in the/i);
    expect(rightSection, "and is still described normally").toMatch(/No calculus\./);
    expect(leftSection, "the kidney with the stone is not still said to have none")
      .not.toMatch(/No calculus\./);
  });
});
