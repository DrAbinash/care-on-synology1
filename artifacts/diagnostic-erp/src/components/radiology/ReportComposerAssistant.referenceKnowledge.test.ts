/**
 * The radiologist has to be able to see, before pressing Apply, whether reference knowledge was in
 * front of the model and which of the clinic's own sections it was — with the document SHA, because
 * the section text on disk can have changed since the draft was written. These tests call the real
 * component (the house style in this folder: hooks mocked, the element tree walked) so a field that
 * exists in the payload but never reaches the screen cannot pass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (value: unknown) => [typeof value === "function" ? value() : value, vi.fn()],
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
  useEffect: vi.fn(),
}));

import { ReportComposerAssistant } from "./ReportComposerAssistant";
import type { ComposeJobView } from "@/lib/reportComposer/types";

const BRAIN_SHA = "d34b5594cc53" + "0".repeat(52);
const SPINE_SHA = "b1172beaea9d" + "0".repeat(52);

function jobWith(provenance: Record<string, unknown>): ComposeJobView {
  return {
    id: 1,
    status: "READY",
    model: "qwen3:14b",
    sources: { "quick-findings": "3" },
    draft: { findings: "Restricted diffusion in the left thalamus.", impression: "Acute infarct." },
    validation: { ok: true, warnings: [], provenance },
  } as unknown as ComposeJobView;
}

function props(over: Record<string, unknown> = {}) {
  return {
    job: null,
    busy: false,
    reviewOpen: true,
    showAiChanges: false,
    isFinalized: false,
    aiMode: "TEXT_ONLY",
    onAiModeChange: () => {},
    primaryRegionLabel: "Brain",
    selectedKeyImageCount: 0,
    inputPreview: null,
    onPreview: () => {},
    onCompose: () => {},
    onImpression: () => {},
    onToggleReview: () => {},
    onToggleShowChanges: () => {},
    onAcceptChange: () => {},
    onRejectChange: () => {},
    onAcceptAll: () => {},
    onRejectAll: () => {},
    onApply: () => {},
    onDiscard: () => {},
    onRegenerate: () => {},
    microInstruction: "",
    onMicroInstructionChange: () => {},
    onMicroSubmit: () => {},
    ...over,
  } as unknown as Parameters<typeof ReportComposerAssistant>[0];
}

/** All text nodes under the element with this data-testid, joined. */
function textOfTestId(node: unknown, testId: string): string | undefined {
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = textOfTestId(n, testId);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!node || typeof node !== "object") return undefined;
  const el = node as { props?: Record<string, unknown> };
  const propsOf = el.props ?? {};
  if (propsOf["data-testid"] === testId) return joinText(propsOf["children"]);
  return textOfTestId(propsOf["children"], testId);
}

function joinText(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(joinText).join("");
  const el = node as { props?: { children?: unknown } };
  return joinText(el.props?.children);
}

beforeEach(() => {
  vi.stubGlobal("React", React);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("the AI review panel reports reference knowledge", () => {
  it("names every retrieved section with its document SHA when RAG contributed", () => {
    const tree = ReportComposerAssistant(
      props({
        job: jobWith({
          referenceKnowledge: [
            { address: "mri-brain-v1.md#58", file: "mri-brain-v1.md", id: 58, title: "DIAGNOSTIC SYNTHESIS — OBSERVATION TO RADIOLOGICAL DIAGNOSIS", version: BRAIN_SHA, chars: 900 },
            { address: "mri-brain-v1.md#5", file: "mri-brain-v1.md", id: 5, title: "ACUTE ISCHEMIC INFARCTION", version: BRAIN_SHA, chars: 700 },
          ],
          referenceKnowledgeNote: "2 reference section(s) added within 1500 tokens",
        }),
      }),
    );
    const line = textOfTestId(tree, "ai-compose-reference-knowledge");
    expect(line).toBeDefined();
    expect(line).toContain("Reference knowledge: 2 section(s)");
    expect(line).toContain("mri-brain-v1.md#58");
    expect(line).toContain("ACUTE ISCHEMIC INFARCTION");
    expect(line).toContain(`v ${BRAIN_SHA.slice(0, 12)}`);
  });

  it("spells out the reason when nothing was retrieved, so OFF and inert are distinguishable", () => {
    const off = textOfTestId(
      ReportComposerAssistant(props({ job: jobWith({ referenceKnowledgeNote: "reference knowledge OFF (feature flag)" }) })),
      "ai-compose-reference-knowledge",
    );
    expect(off).toContain("Reference knowledge: none");
    expect(off).toContain("OFF (feature flag)");

    const denied = textOfTestId(
      ReportComposerAssistant(props({ job: jobWith({ referenceKnowledgeNote: "every authored finding is stated in the negative (infarc, ischae)" }) })),
      "ai-compose-reference-knowledge",
    );
    expect(denied).toContain("stated in the negative");

    const legacy = textOfTestId(
      ReportComposerAssistant(props({ job: jobWith({}) })),
      "ai-compose-reference-knowledge",
    );
    expect(legacy).toContain("not recorded for this run");
  });

  it("never presents the reference sections as findings or as a confirmation", () => {
    const line = textOfTestId(
      ReportComposerAssistant(
        props({
          job: jobWith({
            referenceKnowledge: [
              { address: "mri-ls-spine-v1.2.md#14", file: "mri-ls-spine-v1.2.md", id: 14, title: "LATERAL RECESS STENOSIS", version: SPINE_SHA, chars: 800 },
            ],
          }),
        }),
      ),
      "ai-compose-reference-knowledge",
    );
    // The label is the only claim this line makes; it must not read as clinical content.
    expect(line?.startsWith("Reference knowledge:")).toBe(true);
    expect(line).not.toMatch(/findings? (of|for) this patient/i);
    expect(line).not.toMatch(/confirmed|approved|signed/i);
    expect(line).toContain("CARE's own documents");
  });

  it("shows the line only inside the existing review block, never as a separate surface", () => {
    const closed = textOfTestId(
      ReportComposerAssistant(props({ reviewOpen: false, job: jobWith({ referenceKnowledgeNote: "x" }) })),
      "ai-compose-reference-knowledge",
    );
    expect(closed).toBeUndefined();
    // and the review block itself still exists untouched around it
    const open = textOfTestId(
      ReportComposerAssistant(props({ reviewOpen: true, job: jobWith({ referenceKnowledgeNote: "x" }) })),
      "ai-compose-reference-knowledge",
    );
    expect(open).toBeDefined();
  });
});
