import { build } from "esbuild";
import { rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await build({
  entryPoints: ["src/server.ts"],
  platform: "node",
  bundle: true,
  format: "esm",
  outfile: "dist/server.mjs",
  logLevel: "info",
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  external: ["pg", "pg-native"],
});
