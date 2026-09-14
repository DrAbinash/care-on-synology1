import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { execSync } from "node:child_process";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// Defaults below allow this app to run outside Replit (e.g. on Windows)
// without manually setting environment variables. Replit's runtime always
// injects PORT/BASE_PATH via the artifact.toml so those values win.
const rawPort = process.env.PORT ?? "5173";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";

/**
 * Bake a short Git SHA into the SPA. Prefer stamped env (Docker/compose
 * GIT_COMMIT / CARE_GIT_SHA / VITE_GIT_COMMIT); fall back to local git;
 * never fail the production build when .git is unavailable.
 */
function resolveViteGitCommit(): string {
  const fromEnv = (
    process.env.GIT_COMMIT ||
    process.env.CARE_GIT_SHA ||
    process.env.VITE_GIT_COMMIT ||
    ""
  )
    .trim()
    .replace(/^["']|["']$/g, "");
  if (fromEnv && fromEnv.toLowerCase() !== "unknown") {
    return fromEnv.split(/\s+/)[0]!.slice(0, 12);
  }
  try {
    return execSync("git rev-parse --short=12 HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

const viteGitCommit = resolveViteGitCommit();

export default defineConfig({
  base: basePath,
  define: {
    // Ensures import.meta.env.VITE_GIT_COMMIT is always a string literal in the bundle.
    "import.meta.env.VITE_GIT_COMMIT": JSON.stringify(viteGitCommit),
  },
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          // Stable names for lazy export libs — anonymous index-*.js chunks
          // break Word export when Cloudflare/tunnel serves HTML for a stale hash.
          if (id.includes("/docx/") || id.endsWith("/docx") || id.includes("\\docx\\")) {
            return "vendor-docx";
          }
          if (id.includes("file-saver")) {
            return "vendor-filesaver";
          }
          if (id.includes("jspdf")) {
            return "vendor-jspdf";
          }
          if (id.includes("recharts") || id.includes("d3-") || id.includes("d3/")) {
            return "vendor-charts";
          }
          if (id.includes("@radix-ui")) {
            return "vendor-radix";
          }
          if (id.includes("@tanstack")) {
            return "vendor-query";
          }
          if (id.includes("framer-motion")) {
            return "vendor-animation";
          }
        },
      },
    },
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
