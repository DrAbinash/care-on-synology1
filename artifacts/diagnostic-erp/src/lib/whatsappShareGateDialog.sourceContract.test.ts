/**
 * Source contracts — the WhatsApp share dialog's blocked states. The pure
 * decisions live in whatsappShareGate.ts; these pins guard the WIRING so the
 * dialog can never again show a silently-disabled Send over a draft report
 * (the #1168 finding), and so a countersign failure is never reported as a
 * WhatsApp send failure.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIALOG = readFileSync(join(SRC, "components/radiology/WhatsAppReportShareDialog.tsx"), "utf8");

describe("WhatsApp share dialog — wiring (#1168)", () => {
  it("1. decides its blocked states through the shared gate, not inline flags", () => {
    expect(DIALOG).toContain("whatsappShareGate(");
    // The private isDeliverable/needsVerify derivation is gone.
    expect(DIALOG).not.toMatch(/const needsVerify =/);
  });

  it("2. a verify-then-send failure gets its own toast title, not 'WhatsApp send failed'", () => {
    // The countersign and the send are different doors; a 409 from /verify
    // used to surface as "WhatsApp send failed", which names the wrong door.
    expect(DIALOG).toContain('"Verify failed"');
    // The verify step's failure must not fall through into the send.
    const verifyBlock = DIALOG.slice(
      DIALOG.indexOf("if (offerVerifyThenSend)"),
      DIALOG.indexOf("const result = await sendShare"),
    );
    expect(verifyBlock).toContain("return");
  });

  it("3. the send button stays honest about what the gate allows", () => {
    expect(DIALOG).toContain("!gate.isDeliverable && !gate.offerVerifyThenSend");
  });
});
