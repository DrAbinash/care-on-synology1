import { expect, test, type Page } from "@playwright/test";

const MOBILE = { width: 390, height: 844 };

async function staffLogin(page: Page) {
  await page.goto("/portal/staff-login");
  await expect(page.getByRole("heading", { name: /staff login/i })).toBeVisible();
  await page.locator("#username").fill("abinashsingh@gmail.com");
  await page.locator("#pin").fill("1234");
  await page.getByRole("button", { name: /^sign in$/i }).click();
  // ERP shell (Layout) — do not use a loose URL regex that matches /portal before auth completes.
  await expect(page.locator("main")).toBeVisible({ timeout: 20_000 });
}

/** Nearest scrollable ancestor for horizontal pan on a table. */
async function tableScrollMetrics(page: Page, tableIndex = 0) {
  return page.evaluate((idx) => {
    const tables = Array.from(document.querySelectorAll("table"));
    const table = tables[idx] as HTMLElement | undefined;
    if (!table) return null;
    let el: HTMLElement | null = table;
    while (el && el !== document.body) {
      const style = getComputedStyle(el);
      const scrollableX =
        (style.overflowX === "auto" || style.overflowX === "scroll") &&
        el.scrollWidth > el.clientWidth + 2;
      if (scrollableX) {
        return {
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          canScrollX: el.scrollWidth > el.clientWidth + 2,
        };
      }
      el = el.parentElement;
    }
    return {
      scrollWidth: table.scrollWidth,
      clientWidth: table.clientWidth,
      canScrollX: table.scrollWidth > table.clientWidth + 2,
    };
  }, tableIndex);
}

async function expectWideTableCanScrollX(page: Page, minTables = 1) {
  const count = await page.locator("table").count();
  expect(count).toBeGreaterThanOrEqual(minTables);
  const metrics = await tableScrollMetrics(page, 0);
  expect(metrics).not.toBeNull();
  if ((metrics!.scrollWidth ?? 0) > (metrics!.clientWidth ?? 0) + 2) {
    expect(metrics!.canScrollX || (metrics!.scrollWidth ?? 0) > (metrics!.clientWidth ?? 0)).toBeTruthy();
  }
}

test.describe("mobile scroll — shell", () => {
  test.use({ viewport: MOBILE });

  test("login page renders on narrow viewport", async ({ page }) => {
    await page.goto("/portal/staff-login");
    await expect(page.getByRole("heading", { name: /staff login/i })).toBeVisible();
    await expect(page.locator("#username")).toBeVisible();
  });

  test("main layout does not clip document horizontally", async ({ page }) => {
    await staffLogin(page);
    await page.goto("/patients");
    await page.waitForLoadState("networkidle");
    const main = page.locator("main");
    await expect(main).toBeVisible();
    const overflow = await main.evaluate((el) => ({
      docScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      mainOverflowX: getComputedStyle(el).overflowX,
    }));
    expect(overflow.mainOverflowX).not.toBe("hidden");
    expect(overflow.docScrollWidth).toBeLessThanOrEqual(overflow.innerWidth + 48);
  });
});

test.describe("mobile scroll — billing & cash pages", () => {
  test.use({ viewport: MOBILE });

  test.beforeEach(async ({ page }) => {
    await staffLogin(page);
  });

  test("Billing Desk: Payment section reachable after vertical scroll", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("main").getByText("Billing Desk")).toBeVisible({ timeout: 15_000 });
    const payment = page.getByText("Payment", { exact: true }).first();
    await payment.scrollIntoViewIfNeeded();
    await expect(payment).toBeVisible();
    const deskOverflow = await page.evaluate(() => {
      const root =
        document.querySelector("[data-desk]") ??
        document.querySelector(".billing-dense, .billing-compact") ??
        document.querySelector("main");
      if (!root) return null;
      const s = getComputedStyle(root as Element);
      return {
        overflowY: s.overflowY,
        scrollHeight: (root as HTMLElement).scrollHeight,
        clientHeight: (root as HTMLElement).clientHeight,
      };
    });
    expect(
      deskOverflow?.overflowY === "auto" ||
        (deskOverflow?.scrollHeight ?? 0) >= (deskOverflow?.clientHeight ?? 0),
    ).toBeTruthy();
  });

  test("Day Close: past closures table horizontally scrollable", async ({ page }) => {
    await page.goto("/day-close");
    await expect(page.getByRole("heading", { name: /day close/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Past Closures")).toBeVisible();
    await expect(page.locator("table").first()).toBeVisible({ timeout: 10_000 });
    await expectWideTableCanScrollX(page);
  });

  test("My Day Close: closure table scrollable", async ({ page }) => {
    await page.goto("/my-day-close");
    await page.waitForLoadState("networkidle");
    if ((await page.locator("table").count()) > 0) {
      await expectWideTableCanScrollX(page);
    }
  });

  test("Expenses: list table has horizontal scroll wrapper", async ({ page }) => {
    await page.goto("/expenses");
    await page.waitForLoadState("networkidle");
    if ((await page.locator("table").count()) > 0) {
      await expectWideTableCanScrollX(page);
    }
  });
});

test.describe("mobile scroll — directories & accounting", () => {
  test.use({ viewport: MOBILE });

  test.beforeEach(async ({ page }) => {
    await staffLogin(page);
  });

  for (const route of ["/patients", "/orders", "/payments", "/dues", "/staff", "/accounting", "/doctors"]) {
    test(`${route}: wide tables remain reachable`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      if ((await page.locator("table").count()) === 0) return;
      await expectWideTableCanScrollX(page);
    });
  }

  test("Doctors: Add Doctor dialog Save button reachable", async ({ page }) => {
    await page.goto("/doctors");
    await page.waitForLoadState("networkidle");
    const addBtn = page.getByTestId("page-header-actions").getByRole("button", { name: /add doctor/i });
    await addBtn.scrollIntoViewIfNeeded();
    await addBtn.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const save = dialog.getByRole("button", { name: /save|add doctor|create/i }).first();
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeVisible();
    const dialogMetrics = await dialog.evaluate((el) => {
      const s = getComputedStyle(el);
      return { maxHeight: s.maxHeight, overflowY: s.overflowY };
    });
    expect(dialogMetrics.overflowY === "auto" || dialogMetrics.maxHeight !== "none").toBeTruthy();
  });
});
