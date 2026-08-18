import React from "react";
import { AlertTriangle } from "lucide-react";

/**
 * App-wide error boundary.
 *
 * Why this exists:
 *   Before this component, App.tsx had ~150 lazy-loaded page routes wrapped
 *   in a single <Suspense>, but nothing caught render errors or dynamic
 *   import failures. Any uncaught error thrown by ANY one page (a bad API
 *   response shape, a null-pointer in a render function, or a failed
 *   dynamic import of a chunk after a rebuild) unmounted the ENTIRE React
 *   tree, leaving the whole ERP blank — not just the one broken module.
 *   This is the most likely cause of "some pages don't open / go blank"
 *   reports, since it affects the whole app, not the specific page.
 *
 * What this does:
 *   - Catches render/runtime errors from whatever page is mounted below it.
 *   - Shows a readable, dismissible error screen instead of a blank page.
 *   - Detects the well-known "stale chunk after redeploy" failure signature
 *     (Vite/webpack dynamic import 404s) and offers a one-click hard reload,
 *     which is the correct fix for that specific failure (the browser has
 *     an old index.html/JS reference to a chunk hash that no longer exists
 *     on the server after a new deployment).
 *   - Resets automatically when the user navigates to a different route,
 *     so one broken page doesn't "stick" as broken after navigating away.
 */

interface Props {
  children: React.ReactNode;
  /** Current location — used only to auto-reset the boundary on navigation. */
  resetKey?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

function isChunkLoadError(error: Error | null): boolean {
  if (!error) return false;
  const msg = `${error.message || ""} ${error.name || ""}`.toLowerCase();
  return (
    msg.includes("failed to fetch dynamically imported module") ||
    msg.includes("loading chunk") ||
    msg.includes("importing a module script failed") ||
    msg.includes("failed to import") ||
    msg.includes("dynamically imported module")
  );
}

export class ModuleErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[ERP] Module render error:", error, info?.componentStack);

    // Stale-chunk-after-deploy is a known, self-resolving condition: the
    // fix is simply to fetch the latest index.html and chunks. We only
    // auto-reload ONCE (guarded via sessionStorage) to avoid a reload loop
    // if the underlying error is something else that merely resembles this.
    if (isChunkLoadError(error)) {
      const key = "erp_chunk_reload_attempted";
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        window.location.reload();
      }
    }
  }

  componentDidUpdate(prevProps: Props) {
    // Auto-recover when the user navigates to a different route — a broken
    // page shouldn't keep every other page broken after the user leaves it.
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      const chunkError = isChunkLoadError(this.state.error);
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-8 text-center">
          <AlertTriangle size={40} className="text-amber-500" />
          <h2 className="text-xl font-bold">
            {chunkError ? "Updating…" : "This page hit an error"}
          </h2>
          <p className="text-sm text-muted-foreground max-w-md">
            {chunkError
              ? "The app was updated on the server. Reloading to get the latest version…"
              : "Something went wrong loading this module. Other pages in the ERP are unaffected — you can try again or go back to the dashboard."}
          </p>
          {!chunkError && (
            <p className="text-xs font-mono bg-muted px-3 py-1 rounded max-w-lg break-words">
              {this.state.error?.message || "Unknown error"}
            </p>
          )}
          <div className="flex gap-3 mt-2">
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg"
            >
              Reload Page
            </button>
            {!chunkError && (
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="px-5 py-2 border text-sm font-semibold rounded-lg"
              >
                Try Again
              </button>
            )}
            <a
              href="/erp/dashboard"
              className="px-5 py-2 border text-sm font-semibold rounded-lg inline-flex items-center"
            >
              Go to Dashboard
            </a>
          </div>
        </div>
      );
    }
    // overflow-y-auto (not overflow-hidden): document-style pages such as
    // My Daily Summary are taller than the pane. overflow-hidden clipped them
    // so they appeared cut off and could not scroll. Workspace pages that
    // use h-full plus their own overflow still fill this sized parent.
    return (
      <div className="h-full min-h-0 flex-1 flex flex-col w-full overflow-y-auto">
        {this.props.children}
      </div>
    );
  }
}

export default ModuleErrorBoundary;
