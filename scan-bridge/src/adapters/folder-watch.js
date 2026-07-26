// Folder-watch adapter — for scanners that save images via their own software.
// The scanner's bundled application (or Windows Fax and Scan, VueScan, etc.)
// saves to a watched folder; this adapter returns the newest image file.
//
// CONFIGURATION (env vars):
//   SCAN_WATCH_FOLDER   Absolute path to the folder to watch (default: OS temp dir + /scans)
//   SCAN_FILE_PATTERN   Glob pattern to match scan files (default: *.jpg,*.jpeg,*.png,*.pdf,*.tiff,*.bmp)
//
// REAL DEPLOYMENT:
// 1. Configure your scanner software to save scans to SCAN_WATCH_FOLDER.
// 2. Run the bridge with BRIDGE_SCAN_VENDOR=folder-watch.
// 3. Staff clicks "Scanner" in the ERP → bridge returns the newest file.

import { promises as fs } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";

const WATCH_FOLDER = process.env.SCAN_WATCH_FOLDER ?? join(tmpdir(), "care-scans");
const FILE_PATTERNS = (process.env.SCAN_FILE_PATTERN ?? "*.jpg,*.jpeg,*.png,*.pdf,*.tiff,*.bmp")
  .split(",")
  .map((s) => s.trim().toLowerCase().replace(/^\*\./, ""));

function extMatches(filename) {
  const ext = basename(filename).split(".").pop()?.toLowerCase() ?? "";
  return FILE_PATTERNS.includes(ext);
}

function mimeFromExt(filename) {
  const ext = basename(filename).split(".").pop()?.toLowerCase() ?? "";
  const map = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    pdf: "application/pdf",
    tiff: "image/tiff",
    tif: "image/tiff",
    bmp: "image/bmp",
  };
  return map[ext] || "application/octet-stream";
}

export default {
  name: "folder-watch",
  async status() {
    try {
      const entries = await fs.readdir(WATCH_FOLDER, { withFileTypes: true });
      const files = entries.filter((e) => e.isFile() && extMatches(e.name));
      return {
        deviceConnected: files.length > 0,
        watchFolder: WATCH_FOLDER,
        fileCount: files.length,
        type: "folder-watch",
      };
    } catch (e) {
      return {
        deviceConnected: false,
        watchFolder: WATCH_FOLDER,
        error: e.message,
        type: "folder-watch",
      };
    }
  },

  async scan() {
    let entries;
    try {
      entries = await fs.readdir(WATCH_FOLDER, { withFileTypes: true });
    } catch (e) {
      throw new Error(`Cannot read watch folder "${WATCH_FOLDER}": ${e.message}`);
    }

    const files = entries
      .filter((e) => e.isFile() && extMatches(e.name))
      .map((e) => ({ name: e.name, path: join(WATCH_FOLDER, e.name) }));

    if (files.length === 0) {
      throw new Error(
        `No scan files found in "${WATCH_FOLDER}". Please scan a document using your scanner software and save it to this folder, or configure SCAN_WATCH_FOLDER.`
      );
    }

    // Get file stats to find the newest
    const withStats = await Promise.all(
      files.map(async (f) => {
        const stat = await fs.stat(f.path);
        return { ...f, mtime: stat.mtimeMs };
      })
    );
    withStats.sort((a, b) => b.mtime - a.mtime);
    const newest = withStats[0];

    const buffer = await fs.readFile(newest.path);
    return {
      imageBase64: buffer.toString("base64"),
      mimeType: mimeFromExt(newest.name),
      // index.js's POST /scan handler reads `result.filename` (lowercase n) on
      // whatever adapter it calls; this was `fileName`, so the response always
      // carried filename: null for folder-watch scans (the image itself still
      // came through — a cosmetic miss, not a failure, but worth matching the
      // shared contract every other adapter (wia.js, mock.js) already uses).
      filename: newest.name,
    };
  },
};
