/**
 * pdfArchive.ts — E-12: the PDF/A variant of the frozen report PDF.
 *
 * The regular /pdf door renders through headless Chromium and serves the
 * bytes — right for reading and printing. Long-term legal retention wants
 * PDF/A: fonts embedded, device-independent colour, a self-contained
 * document. That conversion belongs to Ghostscript. When the NAS has no
 * `gs` the door answers 501 with a clear message instead of silently
 * serving non-archival bytes under an archival request.
 *
 * The availability probe is cached per process: `gs` cannot appear or
 * vanish under a running server without a restart, and the probe is a fork
 * the hot path should not pay on every request. `CARE_GHOSTSCRIPT_BIN`
 * overrides the binary name for packaged deployments.
 */

import { spawn } from "node:child_process";

const GS_VERSION_TIMEOUT_MS = 5_000;
const GS_CONVERT_TIMEOUT_MS = 120_000;

let gsProbe: Promise<string | null> | null = null;

function probeGhostscript(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(bin, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(null);
    }, GS_VERSION_TIMEOUT_MS);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? bin : null);
    });
  });
}

/** The Ghostscript binary this server can run, or null when there is none. */
export function ghostscriptBin(): Promise<string | null> {
  const bin = process.env.CARE_GHOSTSCRIPT_BIN || "gs";
  gsProbe ??= probeGhostscript(bin);
  return gsProbe;
}

/**
 * The Ghostscript invocation that turns a PDF into a PDF/A-2b document.
 * Pure on purpose — the args are the contract the route and the tests share.
 *
 *   -dPDFA=2                     — PDF/A-2b: keeps transparency (PDF/A-1 drops it)
 *   -dPDFACompatibilityPolicy=1  — abort on non-compliant content rather than
 *                                   quietly emitting bytes that claim PDF/A but
 *                                   are not (a legal-retention copy must be
 *                                   honestly compliant or not exist)
 *   UseDeviceIndependentColor    — no device-dependent colour in the archive
 *   -sOutputFile=- and trailing  — stream: PDF in on stdin, PDF/A out on stdout
 *   "-"                          — so no temp files touch the disk
 */
export function pdfArchiveArgs(): string[] {
  return [
    "-dPDFA=2",
    "-dBATCH",
    "-dNOPAUSE",
    "-dNOOUTERSAVE",
    "-sDEVICE=pdfwrite",
    "-dPDFACompatibilityPolicy=1",
    "-sColorConversionStrategy=UseDeviceIndependentColor",
    "-dEmbedAllFonts=true",
    "-dSubsetFonts=true",
    "-sOutputFile=-",
    "-",
  ];
}

export type PdfArchiveResult =
  | { ok: true; bytes: Buffer }
  | { ok: false; reason: "failed"; message: string };

/** Convert a rendered PDF buffer to PDF/A-2b through the given gs binary. */
export function convertPdfToPdfA(bin: string, pdf: Buffer): Promise<PdfArchiveResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, pdfArchiveArgs(), { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    let settled = false;
    const finish = (result: PdfArchiveResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, reason: "failed", message: "Ghostscript did not finish in time" });
    }, GS_CONVERT_TIMEOUT_MS);
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => {
      if (stderr.length < 2_000) stderr += c.toString("utf8");
    });
    child.on("error", (err) => {
      finish({ ok: false, reason: "failed", message: err.message });
    });
    child.on("close", (code) => {
      if (code === 0) {
        const bytes = Buffer.concat(chunks);
        if (bytes.length > 0) {
          finish({ ok: true, bytes });
        } else {
          finish({ ok: false, reason: "failed", message: "Ghostscript produced no output" });
        }
      } else {
        finish({
          ok: false,
          reason: "failed",
          message: stderr.trim().split("\n").slice(-3).join(" ") || `Ghostscript exited with code ${code}`,
        });
      }
    });
    child.stdin.on("error", () => {
      /* EPIPE when gs exits before drinking the input — the close handler reports it */
    });
    child.stdin.end(pdf);
  });
}

/** Test hook: forget the cached probe (the server process caches for life). */
export function resetGhostscriptProbeForTests(): void {
  gsProbe = null;
}
