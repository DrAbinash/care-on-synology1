import { defineConfig } from "drizzle-kit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));

// Load a workspace-root .env (if present) so `pnpm db:push` works on
// Windows/macOS/Linux without manually exporting DATABASE_URL.
const rootEnv = path.resolve(here, "../../.env");
if (existsSync(rootEnv)) {
  dotenv.config({ path: rootEnv });
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(here, "./src/schema/index.ts").replace(/\\/g, "/"),
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
