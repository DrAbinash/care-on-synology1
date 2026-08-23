/**
 * Clinic acceptance walkthrough for Voice Report Composer (PR #584 hardening).
 * Uses injected voice transcripts — no microphone required.
 */
import { expect, test } from "@playwright/test";
import path from "node:path";

const ARTIFACTS = "/opt/cursor/artifacts";

test.use({ video: "on", viewport: { width: 1600, height: 900 } });
test.setTimeout(120_000);

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.__voiceInjectedTranscripts = [];
  });
});

async function staffLogin(page: import("@playwright/test").Page) {
  await page.goto("/portal/staff-login");
  await page.locator("#username").waitFor({ state: "visible", timeout: 15_000 });
  await page.locator("#username").fill("abinashsingh@gmail.com");
  await page.locator("#pin").fill("1234");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).not.toHaveURL(/staff-login/, { timeout: 15_000 });
}

async function selectStudyRegion(page: import("@playwright/test").Page, region: string) {
  await page.getByTestId("study-setup-strip").waitFor({ state: "visible", timeout: 20_000 });
  const regionSelect = page.getByTestId("region-select");
  await regionSelect.selectOption(region);
  await page.waitForTimeout(500);
}

const LS_NORMAL =
  "Lumbar vertebrae show normal alignment and marrow signal. No spondylolisthesis. Disc spaces are maintained. No acute fracture. Conus medullaris at L1 with normal appearance. Cauda equina nerve roots are normally distributed. Paraspinal soft tissues are unremarkable. Sacroiliac joints are normal.";

const BRAIN_NORMAL =
  "Grey-white matter differentiation is preserved. No focal cortical or subcortical signal abnormality, mass lesion, or acute infarct identified. Ventricular system and sulcal spaces are normal. No midline shift.";

async function bootstrapLsSpineNormal(page: import("@playwright/test").Page) {
  await page.goto("/radiology/reporting-workspace");
  await selectStudyRegion(page, "LS Spine");
  const startBtn = page.getByTestId("btn-start-report");
  if (await startBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await startBtn.click();
  } else {
    await page.getByRole("textbox", { name: /Type findings/i }).fill(LS_NORMAL);
  }
  await expect(page.getByText(/Lumbar vertebrae show normal/i)).toBeVisible({ timeout: 15_000 });
}

async function dictateInjected(
  page: import("@playwright/test").Page,
  transcript: string,
) {
  await page.evaluate((t) => {
    window.__voiceInjectedTranscripts = [t];
  }, transcript);
  const ptt = page.getByTestId("voice-ptt");
  await expect(ptt).toBeVisible({ timeout: 10_000 });
  await ptt.dispatchEvent("pointerdown");
  await ptt.dispatchEvent("pointerup");
  await expect(page.getByTestId("voice-preview")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("voice-confirm").click();
}

async function usePhraseFallbackIfNeeded(page: import("@playwright/test").Page, optional = false) {
  const fallback = page.getByTestId("voice-composer-phrase-fallback");
  if (await fallback.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await fallback.click();
  }
  const preview = page.getByTestId("voice-composer-preview");
  if (optional) {
    await preview.waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
    return;
  }
  await expect(preview).toBeVisible({ timeout: 15_000 });
}

test("MRI LS Spine — dictate, preview diff, apply, second level, undo, impression", async ({ page }) => {
  await staffLogin(page);
  await bootstrapLsSpineNormal(page);

  await page.getByTestId("voice-mode").selectOption("dictation");
  await page.getByTestId("voice-dictation-target").selectOption("findings");

  await dictateInjected(page, "Diffuse disc bulge at L4-5.");
  await usePhraseFallbackIfNeeded(page);

  await expect(page.getByText("WILL ADD")).toBeVisible();
  await expect(page.getByText("UNTOUCHED")).toBeVisible();
  await page.screenshot({ path: path.join(ARTIFACTS, "ls_spine_preview_diff.png"), fullPage: false });

  await page.getByTestId("voice-composer-preview").getByRole("button", { name: /apply/i }).click();
  await expect(page.getByTestId("canonical-findings-editor")).toContainText(/L4-5/i);
  await page.screenshot({ path: path.join(ARTIFACTS, "ls_spine_after_apply.png"), fullPage: false });

  await dictateInjected(page, "Disc desiccation at L3-4.");
  await usePhraseFallbackIfNeeded(page);
  await page.getByTestId("voice-composer-preview").getByRole("button", { name: /apply/i }).click();
  await expect(page.getByTestId("canonical-findings-editor")).toContainText(/L3-4/i);
  await page.screenshot({ path: path.join(ARTIFACTS, "ls_spine_two_levels.png"), fullPage: false });

  const undoBtn = page.getByTestId("voice-undo");
  if (await undoBtn.isVisible()) {
    await undoBtn.click();
  } else {
    await page.keyboard.press("Control+z");
  }
  await page.screenshot({ path: path.join(ARTIFACTS, "ls_spine_after_undo.png"), fullPage: false });

  await dictateInjected(page, "generate impression");
  await usePhraseFallbackIfNeeded(page, true);
  const applyImp = page.getByTestId("voice-composer-preview").getByRole("button", { name: /apply/i });
  if (await applyImp.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await applyImp.click();
  }
  await page.screenshot({ path: path.join(ARTIFACTS, "ls_spine_impression.png"), fullPage: false });
});

test("MRI Brain — normal baseline, abnormal finding, preview, apply, impression", async ({ page }) => {
  await staffLogin(page);
  await page.goto("/radiology/reporting-workspace");
  await selectStudyRegion(page, "Brain");
  const startBtn = page.getByTestId("btn-start-report");
  if (await startBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await startBtn.click();
  } else {
    await page.getByRole("textbox", { name: /Type findings/i }).fill(BRAIN_NORMAL);
  }
  await expect(page.getByText(/Grey-white matter/i)).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("voice-mode").selectOption("dictation");
  await page.getByTestId("voice-dictation-target").selectOption("findings");

  await dictateInjected(page, "Few punctate white matter hyperintense lesions Fazekas grade 1.");
  await usePhraseFallbackIfNeeded(page);
  await expect(page.getByText("WILL ADD")).toBeVisible();
  await page.screenshot({ path: path.join(ARTIFACTS, "brain_preview_diff.png"), fullPage: false });

  await page.getByTestId("voice-composer-preview").getByRole("button", { name: /apply/i }).click();
  await expect(page.getByTestId("canonical-findings-editor")).toContainText(/white matter/i);
  await page.screenshot({ path: path.join(ARTIFACTS, "brain_after_apply.png"), fullPage: false });

  await dictateInjected(page, "generate impression");
  await usePhraseFallbackIfNeeded(page, true);
  const applyImp = page.getByTestId("voice-composer-preview").getByRole("button", { name: /apply/i });
  if (await applyImp.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await applyImp.click();
  }
  await page.screenshot({ path: path.join(ARTIFACTS, "brain_impression.png"), fullPage: false });
});
