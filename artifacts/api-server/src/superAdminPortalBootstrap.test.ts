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
});
