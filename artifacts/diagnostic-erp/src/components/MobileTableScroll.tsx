import { cn } from "@/lib/utils";

/**
 * Horizontal scroll frame for wide data tables on mobile.
 * Prevents parent overflow-x-hidden / flex shrink from clipping columns.
 */
export function MobileTableScroll({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-full max-w-full min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x",
        className,
      )}
    >
      {children}
    </div>
  );
}
