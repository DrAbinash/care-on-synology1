/**
 * ContentOverrideDialog — the way back from a content refusal (ruling 3).
 *
 * The signing door refuses a report whose Findings is empty, whose Impression
 * was drawn and left blank, or whose `{tokens}` were never filled, and the
 * refusal sentence tells the radiologist to pass a documented reason. Before
 * this screen existed that instruction was a dead end: no surface in the
 * workspace could send the pair, so the only way to sign an exceptional report
 * was to invent findings text he did not write.
 *
 * Two rules own this component:
 *  - the reason must be long enough to mean something, and the length that
 *    counts is the number the SERVER sent (`contentOverride.minReasonChars`),
 *    judged after trimming exactly as the door judges it;
 *  - the reason never reaches the patient. It is written to the audit with the
 *    signer's identity (ruling 2), and this screen says so in one line, because
 *    a radiologist who thinks the note is printed will write it differently.
 *
 * Nothing here decides policy: the sentence is the door's, the minimum is the
 * door's, and the retry runs the whole finalize gauntlet again, so every other
 * gate still applies to the report that is signed.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle } from "lucide-react";
import {
  contentRefusalHeadline,
  overrideReasonProblem,
  type ContentRefusal,
} from "@/lib/contentOverride";

const SECTION_NAMES: Record<string, string> = {
  findings: "Findings",
  impression: "Impression",
};

/** What is missing, in the door's own words rather than a paraphrase of them. */
function missingList(refusal: ContentRefusal): string {
  if (refusal.level === "placeholder") {
    return `Unresolved: ${refusal.placeholders.join(", ")}`;
  }
  const sections = refusal.sections.map((s) => SECTION_NAMES[s] ?? s).join(" and ");
  return sections ? `Empty: ${sections}` : "";
}

export function ContentOverrideDialog({
  refusal,
  busy,
  onSign,
  onDismiss,
}: {
  refusal: ContentRefusal | null;
  busy: boolean;
  /** Sends the documented retry. Resolves to the sentence to show, or null when
   *  the attempt was made and the gauntlet reported its own outcome. */
  onSign: (reason: string) => Promise<string | null>;
  onDismiss: () => void;
}) {
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  // A refusal for a different report must not inherit what was typed for this
  // one — the reason is a statement about specific text.
  useEffect(() => {
    setReason("");
    setProblem(null);
  }, [refusal?.code, refusal?.sentence]);

  const min = refusal?.minReasonChars ?? 15;
  const typed = reason.trim().length;
  const blocking = useMemo(
    () => (refusal ? overrideReasonProblem(reason, refusal.minReasonChars) : null),
    [reason, refusal],
  );

  if (!refusal) return null;

  async function submit() {
    const message = await onSign(reason);
    // null means the retry actually ran; the gauntlet owns the toast.
    if (message) setProblem(message);
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onDismiss(); }}>
      <DialogContent className="max-w-lg" data-testid="content-override-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />
            {contentRefusalHeadline(refusal.level)}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">{refusal.sentence}</p>
          {missingList(refusal) ? (
            <p className="font-medium" data-testid="content-override-missing">{missingList(refusal)}</p>
          ) : null}

          <div>
            <Label htmlFor="content-override-reason">
              Why is this report being signed as it stands?
            </Label>
            <Textarea
              id="content-override-reason"
              data-testid="content-override-reason"
              className="mt-1 min-h-[72px]"
              value={reason}
              disabled={busy}
              placeholder="e.g. Findings dictated by phone; the sentences will be added to the printed addendum."
              onChange={(e) => {
                setReason(e.target.value);
                setProblem(null);
              }}
            />
            <p className="mt-1 text-xs text-muted-foreground" data-testid="content-override-count">
              {typed} of at least {min} characters
            </p>
          </div>

          {/* A disabled button with nothing next to it is the silence this codebase
              keeps having to fix, so the live judgement is said out loud: the
              click is refused by the same sentence the button is gated on. */}
          {(problem ?? blocking) ? (
            <p className="text-xs text-destructive" data-testid="content-override-problem">
              {problem ?? blocking}
            </p>
          ) : null}

          {/* Ruling 2: the reason is an audit record, not a sentence in the document. */}
          <p className="text-xs text-muted-foreground">
            Your reason is recorded in the signing audit with your name and the time. It does not
            print on the report the patient receives.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onDismiss} disabled={busy}>
            Go back and finish the report
          </Button>
          <Button
            onClick={() => { void submit(); }}
            disabled={busy || blocking !== null}
            data-testid="content-override-confirm"
          >
            {busy ? "Signing…" : "Sign with this reason"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
