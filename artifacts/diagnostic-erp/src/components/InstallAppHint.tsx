import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandaloneApp(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * One-line hint on the portal login page: install caredeoghar.com/erp as a
 * desktop app so staff never type URLs or LAN IPs.
 */
export function InstallAppHint() {
  const [installed, setInstalled] = useState(() =>
    typeof window !== "undefined" && isStandaloneApp(),
  );
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    setInstalled(isStandaloneApp());
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  if (installed) return null;

  const handleInstall = async () => {
    if (!installPrompt) return;
    setInstalling(true);
    try {
      await installPrompt.prompt();
      await installPrompt.userChoice;
      setInstallPrompt(null);
      if (isStandaloneApp()) setInstalled(true);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="mt-4 border-t pt-4 text-center text-xs text-muted-foreground space-y-2">
      <p>
        <strong className="text-foreground">Tip:</strong> Install Care ERP as an app (Chrome/Edge menu →{" "}
        <span className="font-medium">Install Care Diagnostics Billing ERP</span>) — open it from your taskbar
        instead of typing a web address.
      </p>
      {installPrompt && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={installing}
          onClick={() => void handleInstall()}
        >
          <Download size={13} />
          {installing ? "Installing…" : "Install app"}
        </Button>
      )}
    </div>
  );
}
