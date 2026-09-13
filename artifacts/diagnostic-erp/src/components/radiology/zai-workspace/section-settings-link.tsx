import { Settings2 } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import type { SectionSettingsLinkSpec } from "@/lib/reportSectionAccordion";

/**
 * Tiny deep-link to the admin page that fills a report section
 * (macros, quick select, layout, doctors, etc.). Kept small so it
 * sits beside accordion labels without competing with the header.
 *
 * `iconOnly` hides the text label — used on dense accordion headers so
 * Clinic / Doctors / Quick Select links stop competing with clinical summaries.
 */
export function SectionSettingsLink({
  href,
  label,
  className,
  testId = "section-settings-link",
  iconOnly = false,
}: SectionSettingsLinkSpec & { className?: string; testId?: string; iconOnly?: boolean }) {
  return (
    <Link
      href={href}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5",
        "text-[9px] font-medium text-muted-foreground/80",
        "hover:bg-muted/60 hover:text-primary",
        "underline-offset-2 hover:underline",
        iconOnly && "px-1.5 py-1 text-muted-foreground/70 hover:text-foreground hover:no-underline",
        className,
      )}
      data-testid={testId}
      title={`Open settings — ${label}`}
      aria-label={`Configure ${label}`}
    >
      <Settings2 size={iconOnly ? 12 : 10} className="shrink-0 opacity-80" aria-hidden />
      {!iconOnly && <span className="max-w-[7rem] truncate">{label}</span>}
    </Link>
  );
}
