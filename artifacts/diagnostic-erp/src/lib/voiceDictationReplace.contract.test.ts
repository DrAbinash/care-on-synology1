/**
 * PR #1174 — the legacy dictation button's Replace mode, pinned at the source
 * level (this package's node-env convention).
 *
 * VoiceDictationButton's preview card offers an Insert mode toggle —
 * Append / Replace — and even relabels the confirm button to match. But
 * `handleInsert` never read `insertMode`: every one of its six call sites
 * wires `onInsert` to an appending setter, so the radiologist who selected
 * Replace and clicked "Replace" got an APPEND. On a clinical report the label
 * must not lie about what the click does.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8").replace(/\r\n/g, "\n");

const BUTTON = "components/VoiceDictationButton.tsx";
const GENERATOR = "pages/RadiologyReportGenerator.tsx";
const USG = "pages/UsgReporting.tsx";
const DOPPLER = "pages/UsgDopplerReporting.tsx";
const SESSION = "hooks/useVoiceSession.ts";
const MIC = "components/radiology/FieldCareMic.tsx";

describe("PR #1174 — the Replace insert mode must do what its label says", () => {
  const button = read(BUTTON);

  it("1. handleInsert reads the selected mode and passes it to onInsert", () => {
    const at = button.indexOf("function handleInsert");
    expect(at).toBeGreaterThan(-1);
    const block = button.slice(at, at + 600);
    expect(block).toMatch(/onInsert\([\s\S]*insertMode\);/);
  });

  it("2. the component's onInsert prop carries the mode", () => {
    expect(button).toMatch(/onInsert: \(text: string, mode: "append" | "replace"\) => void/);
  });

  it("3. RadiologyReportGenerator's three sites honour replace (clinicalHistory, sections, impression)", () => {
    const src = read(GENERATOR);
    const sites = src.match(/onInsert=\{\(text, mode\) =>/g) ?? [];
    expect(sites.length).toBeGreaterThanOrEqual(3);
    // and no appending-only site is left behind
    expect(src).not.toMatch(/onInsert=\{\(t\) => set\w+\(\(v\) => v \+ t\)\}/);
    expect(src).not.toMatch(/onInsert=\{\(text\) => insertText\(/);
  });

  it("4. UsgReporting's insertText takes the mode and replaces when told", () => {
    const src = read(USG);
    const fnAt = src.indexOf("function insertText");
    expect(fnAt).toBeGreaterThan(-1);
    expect(src.slice(fnAt, fnAt + 120)).toMatch(/insertText\(draftId: number \| "new", text: string, mode: "append" \| "replace"/);
    // both call sites pass the mode through
    const sites = src.match(/onInsert=\{\(text, mode\) => insertText\(/g) ?? [];
    expect(sites.length).toBe(2);
  });

  it("5. UsgDopplerReporting's waveform site honours replace", () => {
    const src = read(DOPPLER);
    expect(src).toContain('onInsert={(text, mode) => upd("waveformDescription"');
    expect(src).not.toContain('onInsert={(text) => upd("waveformDescription"');
  });
});

describe("PR #1174 — the canonical voice session reads the mode at result time", () => {
  const session = read(SESSION);
  const mic = read(MIC);

  it("6. mode and dictation target are mirrored into refs the session callbacks read", () => {
    expect(session).toMatch(/const modeRef = useRef\(mode\);/);
    expect(session).toMatch(/const dictationTargetRef = useRef\(dictationTarget\);/);
    expect(session).toMatch(/modeRef\.current = mode;/);
    expect(session).toMatch(/dictationTargetRef\.current = dictationTarget;/);
  });

  it("7. the transcript handler routes by the CURRENT mode and target, not the start-time closure", () => {
    expect(session).toMatch(/if \(modeRef\.current === "dictation"\)/);
    expect(session).toMatch(/target: dictationTargetRef\.current/);
  });

  it("8. the handlers no longer depend on mode/dictationTarget — a session started before a switch still routes correctly", () => {
    // The dep arrays of handleFinalTranscript and handleUtterance must not
    // carry the two state values; if they do, a session created before the
    // switch keeps the stale closure.
    for (const name of ["handleFinalTranscript", "handleUtterance"]) {
      const at = session.indexOf(`const ${name} = useCallback(`);
      expect(at).toBeGreaterThan(-1);
      const block = session.slice(at, at + 4000);
      const deps = block.match(/\}, \[([^\]]*)\]\);/);
      expect(deps).not.toBeNull();
      expect(deps![1]).not.toContain("mode");
      expect(deps![1]).not.toContain("dictationTarget");
    }
  });

  it("9. FieldCareMic still arms in one tick — setMode, setDictationTarget, startListening", () => {
    const at = mic.indexOf("onClick={() => {");
    const block = mic.slice(at, at + 500);
    expect(block).toContain('voice.setMode("dictation")');
    expect(block).toContain("voice.setDictationTarget(target)");
    expect(block).toContain('voice.startListening("toggle")');
  });
});
