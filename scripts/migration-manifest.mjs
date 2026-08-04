#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const featureDir = path.join(root, "migrations");
const drizzleDir = path.join(root, "lib/db/drizzle");

function files(dir, ext = ".sql") {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .sort()
    .map((file) => {
      const full = path.join(dir, file);
      const stat = fs.statSync(full);
      return { file, bytes: stat.size };
    });
}

const manifest = {
  generatedAt: new Date().toISOString(),
  drizzle: files(drizzleDir),
  featureSql: files(featureDir),
};

const out = path.join(root, "migration-manifest.json");
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${path.relative(root, out)} (${manifest.drizzle.length} drizzle, ${manifest.featureSql.length} feature SQL migrations)`);
