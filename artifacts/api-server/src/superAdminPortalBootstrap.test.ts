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

  it("scopes pairing CSS so it cannot restyle login PIN or portal buttons", () => {
    const app = bootstrapSource();
    expect(app).toMatch(/<html lang="en" class="sa-boot">/);
    expect(app).toMatch(/html\.sa-boot body/);
    expect(app).toMatch(/classList\.remove\("sa-boot"\)/);
    // Amber pairing chrome is ID-scoped to the two pairing actions only.
    // A global button rule painted the login PIN eye-toggle solid yellow and
    // covered the input (no digits could be typed).
    expect(app).toMatch(/html\.sa-boot #pair-btn/);
    expect(app).toMatch(/html\.sa-boot #auth-btn/);
    expect(app).toMatch(/html\.sa-boot #pair-btn,[\s\S]*?#fbbf24[\s\S]*?width: 100%/);
    expect(app).not.toMatch(/html\.sa-boot button \{/);
    expect(app).not.toMatch(/\n\s+button \{/);
    expect(app).not.toMatch(/\n\s+body \{/);
  });

  it("unlocks the login PIN field when it is visible and auto-login is not running", () => {
    const app = bootstrapSource();
    expect(app).toMatch(/Enter Super Admin PIN/);
    expect(app).toMatch(/#pin, input\[type="password"\]/);
    expect(app).toMatch(/Auto-login via USB/);
    expect(app).toMatch(/inp\.disabled = false/);
  });

  it("restores sa-boot if the USB UI bundle does not export SuperAdminPortal", () => {
    const app = bootstrapSource();
    expect(app).toMatch(/classList\.add\("sa-boot"\)/);
    expect(app).toMatch(/SuperAdminPortal component was not found/);
  });

  // The second factor itself is asserted in a browser against the page this
  // route serves (see the PR evidence); these only pin the shipped shape.
  it("installs the authentication-code shim beside the PIN fallback", () => {
    const app = bootstrapSource();
    expect(app).toMatch(/installLoginPinFallbackShim\(\);\s*\n\s*installLoginTotpShim\(\);/);
    expect(app).toMatch(/function installLoginTotpShim\(\)/);
    expect(app).toMatch(/window.__saTotpShimInstalled/);
  });

  it("adds the code field only on the server's demand, with a label and no stylesheet", () => {
    const app = bootstrapSource();
    // Field id and the human label the operator reads.
    expect(app).toMatch(/id = "sa-totp-code"/);
    expect(app).toMatch(/textContent = "Authentication code"/);
    expect(app).toMatch(/setAttribute\("autocomplete", "one-time-code"\)/);
    // Only `requiresTotp` reveals it — the not-enrolled 403 must not grow a box.
    expect(app).toMatch(/j\.requiresTotp !== true/);
    // Inline styles only: a <style> here leaked into the portal before.
    expect(app).not.toMatch(/function installLoginTotpShim[\s\S]*?<style>/);
    expect(app).toMatch(/setAttribute\("style", "margin-top:10px;text-align:left"\)/);
  });

  it("sends a 6-digit value as totpCode and anything longer as a backup code", () => {
    const app = bootstrapSource();
    expect(app).toMatch(/body\.totpCode = value/);
    expect(app).toMatch(/body\.backupCode = value/);
    expect(app).toMatch(/\/\^\[0-9\]\{6\}\$\/\.test\(value\)/);
    // Never discard a secret the bundle already proved.
    expect(app).toMatch(/if \(!body\.totpCode && !body\.backupCode\) \{/);
  });
});
