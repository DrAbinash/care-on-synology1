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

  it("re-appends the code field after the login card re-renders, and keeps the draft", () => {
    const app = bootstrapSource();
    // The card is React-owned and destroys appended nodes on re-render, so the
    // demand and the typed draft live outside the DOM.
    expect(app).toMatch(/let demanded = false;/);
    expect(app).toMatch(/let draft = "";/);
    expect(app).toMatch(/if \(demanded\) addCodeField\(\)/);
    expect(app).toMatch(/input\.value = draft;/);
    expect(app).toMatch(/addEventListener\("input", function \(\) \{ draft = input\.value; \}\)/);
    // A session ends the demand, so the heartbeat cannot leave a stray box up.
    // [\s\S] not \n: this file is checked out CRLF on Windows.
    expect(app).toMatch(/if \(res && res\.status === 200\)[\s\S]{0,220}?demanded = false;[\s\S]{0,40}?draft = "";/);
  });

  // ── Security key ─────────────────────────────────────────────────────────────
  // Greps are the wrong instrument for route behaviour, which is why the mounted
  // endpoints are proven in superAdminKeyLogin.request.test.ts. These exist for the
  // page itself: the sign-in form is superadmin-ui.js read off the pen drive, so the
  // only place this ceremony can live is the host shim, and a shim nobody greps for
  // goes missing the first time somebody re-edits this string.

  it("installs the security key shim beside the PIN fallback and the code field", () => {
    const app = bootstrapSource();
    expect(app).toMatch(/installLoginPinFallbackShim\(\);[\s\S]{0,120}?installLoginTotpShim\(\);[\s\S]{0,120}?installLoginKeyShim\(\);/);
  });

  it("calls the path the server actually mounts, and asks the browser to sign, not to register", () => {
    const app = bootstrapSource();
    // The old defect was a login button pointed at a URL nothing answered.
    expect(app).toMatch(/\/api\/super-admin\/key-login\/begin/);
    expect(app).toMatch(/navigator\.credentials\.get\(\{/);
    expect(app).not.toMatch(/navigator\.credentials\.create\(\{/);
    // userVerification comes from the server's options; a hardcoded "discouraged"
    // here would let a found key sign without the owner's PIN or touch.
    expect(app).toMatch(/userVerification: opts\.userVerification \|\| "required"/);
    expect(app).toMatch(/challenge: b64uToBuf\(opts\.challenge\)/);
    expect(app).toMatch(/rpId: opts\.rpId/);
  });

  it("sends the signature on the bundle's own login request and spends it once", () => {
    const app = bootstrapSource();
    expect(app).toMatch(/body\.webauthnChallenge = signed\.webauthnChallenge;/);
    expect(app).toMatch(/body\.keyAssertion = signed\.keyAssertion;/);
    expect(app).toMatch(/if \(!body\.keyAssertion\) \{/);
    // One challenge, one attempt: the server consumes it whether the signature works
    // or not, so the copy the page holds has to go when it is sent.
    expect(app).toMatch(/if \(spent\) \{[\s\S]{0,200}?signed = null;/);
    expect(app).toMatch(/if \(!begun\.ok \|\| !opts \|\| !opts\.challenge\) \{/);
  });

  it("shows the key button only when the server demands a key, and names the enrolment path", () => {
    const app = bootstrapSource();
    expect(app).toMatch(/let demanded = false;[\s\S]{0,120}?let signed = null;/);
    expect(app).toMatch(/if \(demanded\) addKeyButton\(\)/);
    expect(app).toMatch(/j\.requiresKey !== true && j\.requiresKeyEnrollment !== true/);
    expect(app).toMatch(/No key is enrolled for this account[\s\S]{0,120}?Settings → Security/);
    // Inline styles only: a stylesheet on this page leaked into the portal once
    // (see the html.sa-boot scoping), which is why no <style> is added here.
    expect(app).toMatch(/btn\.id = "sa-key-btn";/);
    expect(app).not.toMatch(/sa-key-btn \{/);
  });

  it("refuses to run the ceremony where WebAuthn does not exist", () => {
    const app = bootstrapSource();
    // Measured in the browser harness: served over plain http on a LAN address,
    // navigator.credentials is undefined, so a key button that does nothing reads as a
    // broken YubiKey. The page has to name the cause.
    expect(app).toMatch(/if \(!navigator\.credentials \|\| !navigator\.credentials\.get\) \{/);
    expect(app).toMatch(/must be opened over https to use a security key/);
  });

  it("keeps the drive's bearer secret out of the page global", () => {
    const app = bootstrapSource();
    // The pairing script already holds the key; publishing it on window would let any
    // later script — including the portal bundle this page injects — read it off the
    // global instead of receiving it the way it already does.
    expect(app).toMatch(/let pairedDriveKey = "";/);
    // The seam is a function: the pairing code pushes the value in, and nothing can
    // read it back off the global afterwards.
    expect(app).toMatch(/function setPairedDriveKey\(value\) \{/);
    expect(app).toMatch(/pairedDriveKey = typeof value === "string" \? value\.trim\(\) : "";/);
    expect(app).toMatch(/setPairedDriveKey\(keyText\);/);
    expect(app).toMatch(/"x-sa-usb-key": pairedDriveKey/);
    expect(app).not.toMatch(/window\.__sa(UsbKey|DriveKey|Key)\b/);
  });
});
