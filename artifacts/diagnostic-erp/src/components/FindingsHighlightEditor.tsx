import { forwardRef, useRef, useImperativeHandle } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// Heuristic-only line-abnormality scan — a visual aid for rapid scanning,
// not a diagnostic judgement. Deliberately guards against the common false
// positive of a NEGATED finding ("No acute infarct identified") still
// containing the keyword "infarct" — without this guard, a normal/negative
// line would get flagged as abnormal, which is worse than no highlighting
// at all for a clinical review tool.
const ABNORMAL_KEYWORDS = [
  "infarct", "h[ae]morrhage", "tumou?r", "malignan\\w*", "mass lesion",
  "bulge", "herniat\\w*", "desiccat\\w*", "stenosis", "fracture", "effusion",
  "compress\\w*", "o?edema", "abscess", "aneurysm", "thrombus",
  "lymphadenopathy", "metasta\\w*", "cyst", "nodule", "calcificat\\w*",
  "atroph\\w*", "degenerat\\w*", "adenoma",
];
const ABNORMAL_RE = new RegExp(`\\b(${ABNORMAL_KEYWORDS.join("|")})`, "i");
const NEGATION_RE = /\b(no|not|without|absent|unremarkable|normal|denies|negative for|free of)\b/i;

function isAbnormalLine(line: string): boolean {
  if (!line.trim()) return false;
  const m = ABNORMAL_RE.exec(line);
  if (!m) return false;
  const before = line.slice(0, m.index);
  if (NEGATION_RE.test(before)) return false;
  return true;
}

export type FindingsHighlightEditorHandle = { el: HTMLTextAreaElement | null };

/**
 * Drop-in replacement for a plain findings <Textarea> that adds a soft
 * full-line background tint behind any line containing an (un-negated)
 * pathological keyword — including text a Chocolate Box macro just
 * injected, since macro text itself contains the same keywords. Built with
 * the standard "highlighted overlay behind a transparent-background
 * textarea" technique: a CSS grid stacks an aria-hidden highlight layer and
 * the real textarea in the same cell so they always share one box (no
 * manual resize/scroll-height math needed for the vertical-resize handle),
 * with a scroll listener keeping the overlay in sync when content
 * overflows the visible height.
 */
export const FindingsHighlightEditor = forwardRef<FindingsHighlightEditorHandle, {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  dataEditor?: string;
  onScrollSync?: () => void;
}>(function FindingsHighlightEditor({ value, onChange, placeholder, className, disabled, dataEditor, onScrollSync }, ref) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({ el: textareaRef.current }), []);

  const syncScroll = () => {
    if (overlayRef.current && textareaRef.current) {
      overlayRef.current.scrollTop = textareaRef.current.scrollTop;
      overlayRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
    onScrollSync?.();
  };

  const lines = value.split("\n");

  return (
    <div className="grid">
      {/* Highlight layer — invisible text, visible line backgrounds only. */}
      <div
        ref={overlayRef}
        aria-hidden="true"
        className={cn(
          "col-start-1 row-start-1 overflow-hidden whitespace-pre-wrap break-words pointer-events-none",
          "rounded-md border border-transparent px-3 py-2 text-base md:text-sm",
          className,
        )}
        style={{ color: "transparent" }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            className={isAbnormalLine(line) ? "bg-amber-200/60 dark:bg-amber-500/25 -mx-1 px-1 rounded-sm" : undefined}
          >
            {line.length ? line : " "}
          </div>
        ))}
      </div>
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        placeholder={placeholder}
        disabled={disabled}
        data-editor={dataEditor}
        className={cn("col-start-1 row-start-1 relative", className)}
      />
    </div>
  );
});
