import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Download, RefreshCw, UploadCloud } from "lucide-react";

type SystemInfo = {
  name: string;
  builtAt: string | null;
  nodeVersion: string | null;
  postgresVersion: string | null;
  updatesEnabled: boolean;
  installRoot: string | null;
  runtimeNode: string;
  platform: string;
  uptimeSeconds: number;
};

export default function SystemUpdate() {
  const { toast } = useToast();
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function loadInfo() {
    try {
      const r = await fetch("/api/system/info");
      if (r.ok) setInfo(await r.json());
    } catch { /* ignore */ }
  }
  useEffect(() => { loadInfo(); }, []);

  async function handleUpload() {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".zip")) {
      toast({ title: "Wrong file type", description: "Please choose a .zip file.", variant: "destructive" });
      return;
    }
    setBusy(true);
    setProgress(0);

    const fd = new FormData();
    fd.append("file", file);

    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/system/update");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          toast({
            title: "Update staged",
            description: "The app will restart in a few seconds. This page will reload automatically.",
          });
          // Wait for the launcher to swap files and start the new server.
          setTimeout(() => waitForRestart(), 3000);
        } else {
          let msg = "Update failed.";
          try { msg = JSON.parse(xhr.responseText).error || msg; } catch { /* ignore */ }
          toast({ title: "Update failed", description: msg, variant: "destructive" });
          setBusy(false);
        }
        resolve();
      };
      xhr.onerror = () => {
        toast({ title: "Upload error", description: "Could not reach the server.", variant: "destructive" });
        setBusy(false);
        resolve();
      };
      xhr.send(fd);
    });
  }

  async function waitForRestart() {
    // Poll /api/system/info until we get a fresh response, then reload.
    const start = Date.now();
    while (Date.now() - start < 120_000) {
      try {
        const r = await fetch("/api/system/info", { cache: "no-store" });
        if (r.ok) {
          window.location.reload();
          return;
        }
      } catch { /* server still down */ }
      await new Promise((res) => setTimeout(res, 1500));
    }
    toast({
      title: "Restart took too long",
      description: "Please reload the page manually once the launcher window shows the API server is ready.",
      variant: "destructive",
    });
    setBusy(false);
  }

  return (
    <div className="container mx-auto p-4 lg:p-8 max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">System Update</h1>
        <p className="text-muted-foreground mt-1">
          Upload an update package built from the Replit project (or any compatible build) to upgrade
          this installation in place. Your data, settings, and uploaded files are not touched.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current installation</CardTitle>
          <CardDescription>What's running on this machine right now.</CardDescription>
        </CardHeader>
        <CardContent>
          {!info ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div><dt className="text-muted-foreground">Build</dt><dd className="font-mono">{info.builtAt ?? "unknown"}</dd></div>
              <div><dt className="text-muted-foreground">Node (bundled)</dt><dd className="font-mono">{info.nodeVersion ?? info.runtimeNode}</dd></div>
              <div><dt className="text-muted-foreground">PostgreSQL</dt><dd className="font-mono">{info.postgresVersion ?? "—"}</dd></div>
              <div><dt className="text-muted-foreground">Platform</dt><dd className="font-mono">{info.platform}</dd></div>
              <div className="sm:col-span-2"><dt className="text-muted-foreground">Install root</dt><dd className="font-mono break-all">{info.installRoot ?? "(not a portable build)"}</dd></div>
              <div><dt className="text-muted-foreground">Uptime</dt><dd className="font-mono">{Math.floor(info.uptimeSeconds / 60)} min</dd></div>
              <div><dt className="text-muted-foreground">Updates</dt><dd className={info.updatesEnabled ? "text-emerald-600 font-medium" : "text-amber-600 font-medium"}>{info.updatesEnabled ? "Enabled" : "Disabled (run from a portable build)"}</dd></div>
            </dl>
          )}
          <Button variant="outline" size="sm" className="mt-4" onClick={loadInfo}>
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Apply an update</CardTitle>
          <CardDescription>
            Drop in a <code className="font-mono">DiagnosticERP-Update.zip</code> exported from
            Replit, OpenCode.ai, GitHub Releases, or any other source you trust.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!info?.updatesEnabled && (
            <div className="flex gap-2 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 p-3 text-sm">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                Updates are only applied automatically when running the desktop build
                (DiagnosticERP.exe / Diagnostic ERP Desktop). On the development server the
                upload will be rejected. The download below still works everywhere.
              </div>
            </div>
          )}

          <ol className="text-sm space-y-2 list-decimal list-inside text-muted-foreground">
            <li>Download the latest <code className="font-mono">DiagnosticERP-Update.zip</code> from your build source.</li>
            <li>Pick it below and click <b>Upload &amp; Install</b>.</li>
            <li>The server stages the new files, restarts itself, and the launcher swaps them in. The page reloads automatically.</li>
          </ol>

          <div className="border-2 border-dashed rounded-lg p-6 text-center">
            <UploadCloud className="w-8 h-8 mx-auto text-muted-foreground" />
            <p className="text-sm mt-2">
              {file ? <>Selected: <span className="font-mono">{file.name}</span> ({(file.size / 1024 / 1024).toFixed(1)} MB)</> : "Choose an update zip"}
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <div className="flex gap-2 justify-center mt-3 flex-wrap">
              <Button variant="outline" type="button" onClick={() => fileRef.current?.click()} disabled={busy}>
                Choose file…
              </Button>
              <Button type="button" onClick={handleUpload} disabled={!file || busy}>
                {busy ? "Working…" : "Upload & Install"}
              </Button>
            </div>
            {busy && progress > 0 && progress < 100 && (
              <p className="text-xs text-muted-foreground mt-3">Uploading… {progress}%</p>
            )}
            {busy && progress === 100 && (
              <p className="text-xs text-muted-foreground mt-3">Extracting and restarting — please wait.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle><Download className="w-4 h-4 inline-block mr-2 align-text-top" />Get the update package</CardTitle>
          <CardDescription>Where to download a fresh build.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-3">
          <p>
            From the Replit project, open the <span className="font-mono">windows-build/dist/</span> folder
            after the <b>Windows Build</b> workflow finishes and download:
          </p>
          <ul className="list-disc list-inside space-y-1 font-mono text-xs">
            <li>DiagnosticERP-Update.zip <span className="text-muted-foreground">— small, app-only, recommended for updates</span></li>
            <li>DiagnosticERP-Portable.zip <span className="text-muted-foreground">— full installer, fresh installs only</span></li>
            <li>DiagnosticERP-Setup.exe <span className="text-muted-foreground">— Windows installer</span></li>
            <li>DiagnosticERP-Desktop-Setup.exe <span className="text-muted-foreground">— Electron desktop app</span></li>
          </ul>
          <p className="text-muted-foreground">
            You can also accept update zips published by mirrors such as OpenCode.ai or your own GitHub Releases —
            we only require that the zip contains an <span className="font-mono">app/</span> folder with the
            standard layout.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
