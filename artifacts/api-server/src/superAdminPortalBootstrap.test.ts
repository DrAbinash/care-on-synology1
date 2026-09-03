import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function bootstrapSource(): string {
  return readFileSync(join(__dirname, "app.ts"), "utf8");
}

describe("super-admin portal bootstrap safety", () => {
  it("bootstrap HTML marks #root with data-sa-bootstrap for USB UI createRoot gate", () => {
    const app = bootstrapSource();
    expect(app).toMatch(/data-sa-bootstrap="1"/);
    expect(app).toMatch(/\/\^\\\/super-admin-portal/);
  });

  it("scopes pairing CSS under html.sa-boot so it cannot restyle the portal after login", () => {
    const app = bootstrapSource();
    expect(app).toMatch(/<html lang="en" class="sa-boot">/);
    expect(app).toMatch(/html\.sa-boot button/);
    expect(app).toMatch(/html\.sa-boot body/);
    expect(app).toMatch(/classList\.remove\("sa-boot"\)/);
    // Amber pairing chrome (yellow gradient + width:100%) must stay scoped.
    // After login these leaked onto every portal <button>, including HelpCircle.
    expect(app).toMatch(/html\.sa-boot button \{[\s\S]*?#fbbf24[\s\S]*?width: 100%/);
    expect(app).not.toMatch(/[^.]button \{[\s\S]*?#fbbf24/);
    // Unscoped pairing rules were the PR #674 regression: full-width amber
    // HelpCircle buttons + body overflow:hidden on the referral report.
    expect(app).not.toMatch(/\n\s+button \{/);
    expect(app).not.toMatch(/\n\s+body \{/);
  });

  it("restores sa-boot if the USB UI bundle does not export SuperAdminPortal", () => {
    const app = bootstrapSource();
    expect(app).toMatch(/classList\.add\("sa-boot"\)/);
    expect(app).toMatch(/SuperAdminPortal component was not found/);
  });
});
