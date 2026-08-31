import { Settings2 } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import type { SectionSettingsLinkSpec } from "@/lib/reportSectionAccordion";

/**
 * Tiny deep-link to the admin page that fills a report section
 * (macros, quick select, layout, doctors, etc.). Kept small so it
 * sits beside accordion labels without competing with the header.
 */
export function SectionSettingsLink({
  href,
  label,
  className,
  testId = "section-settings-link",
}: SectionSettingsLinkSpec & { className?: string; testId?: string }) {
  return (
    <Link
      href={href}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5",
        "text-[9px] font-medium text-muted-foreground/80",
        "hover:bg-muted/60 hover:text-primary",
        "underline-offset-2 hover:underline",
        className,
      )}
      data-testid={testId}
      title={`Open settings — ${label}`}
      aria-label={`Configure ${label}`}
    >
      <Settings2 size={10} className="shrink-0 opacity-80" aria-hidden />
      <span className="max-w-[7rem] truncate">{label}</span>
    </Link>
  );
}
