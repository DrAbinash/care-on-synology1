import { Sun, Moon, Monitor } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useColorScheme, type ColorScheme } from "@/lib/colorScheme";

const OPTIONS: Array<{ value: ColorScheme; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System Default", icon: Monitor },
];

/**
 * Low-profile theme selector — Dark / Light / System. Reads and writes the
 * app-wide ColorSchemeProvider (src/lib/colorScheme.ts), so it stays in
 * sync no matter which page mounts it.
 */
export function ThemeSelector({ className }: { className?: string }) {
  const { scheme, isDark, setScheme } = useColorScheme();
  const ActiveIcon = isDark ? Moon : scheme === "system" ? Monitor : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Theme"
          className={className ?? "p-2 rounded-md text-sidebar-foreground hover:bg-sidebar-accent transition-colors"}
        >
          <ActiveIcon size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel className="text-xs">Theme</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={scheme} onValueChange={(v) => setScheme(v as ColorScheme)}>
          {OPTIONS.map(({ value, label, icon: Icon }) => (
            <DropdownMenuRadioItem key={value} value={value} className="text-xs gap-2">
              <Icon size={13} className="text-muted-foreground" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
