import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// Defaults below allow this app to run outside Replit (e.g. on Windows)
// without manually setting environment variables. Replit's runtime always
// injects PORT/BASE_PATH via the artifact.toml so those values win.
const rawPort = process.env.PORT ?? "5174";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/super-admin-portal/";

function inlineCssPlugin() {
  return {
    name: "inline-css",
    apply: "build" as const,
    enforce: "post" as const,
    generateBundle(options: any, bundle: any) {
      let cssContent = "";
      for (const [fileName, asset] of Object.entries(bundle)) {
        if (fileName.endsWith(".css") && (asset as any).type === "asset") {
          cssContent += (asset as any).source;
          delete bundle[fileName];
        }
      }
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (fileName.endsWith(".js") && (chunk as any).type === "chunk" && (chunk as any).isEntry) {
          const cssInjected = `
            (function() {
              var style = document.createElement('style');
              style.textContent = ${JSON.stringify(cssContent)};
              document.head.appendChild(style);
            })();
          `;
          (chunk as any).code = cssInjected + (chunk as any).code;
        }
      }
    }
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    inlineCssPlugin(),
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
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        entryFileNames: "superadmin-ui.js",
        assetFileNames: "[name].[ext]",
        chunkFileNames: "[name].js",
        inlineDynamicImports: true,
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
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});

