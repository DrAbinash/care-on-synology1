import { describe, expect, it } from "vitest";
import { ensurePrintLetterpadLogo } from "./radiologyReportPrintLiveMerge";
import { CARE_LETTERHEAD_LOGO_DATA_URL } from "./careLetterheadLogo";

describe("ensurePrintLetterpadLogo", () => {
  it("replaces relative CARE logo paths with the bundled data URL", () => {
    const html = `<div class="hdr"><div class="hdr-inner letterpad-bill"><img class="logo" src="/care-diagnostics-letterhead-logo.png" alt="CARE"/></div></div>`;
    const out = ensurePrintLetterpadLogo(html);
    expect(out).toContain(CARE_LETTERHEAD_LOGO_DATA_URL.slice(0, 40));
    expect(out).not.toContain('src="/care-diagnostics-letterhead-logo.png"');
  });

  it("fills an empty logo src", () => {
    const html = `<div class="hdr-inner letterpad-bill"><img class="logo" src="" alt="CARE"/></div>`;
    const out = ensurePrintLetterpadLogo(html);
    expect(out).toContain('src="data:image/png;base64,');
  });
});
