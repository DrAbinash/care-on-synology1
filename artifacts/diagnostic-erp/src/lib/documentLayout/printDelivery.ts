/**
 * Shared browser print delivery for all CARE ERP documents.
 * Uses a popup window so `window.print()` reliably opens the browser dialog
 * (hidden 0×0 iframes are blocked by Chromium and leave bills stuck on
 * in-app preview only).
 *
 * Both paths wait for document readiness, images, and fonts before printing
 * exactly once. No Electron APIs.
 */

function waitForImages(doc: Document): Promise<void> {
  const images = Array.from(doc.images);
  if (images.length === 0) return Promise.resolve();
  return Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          const done = () => resolve();
          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });
        }),
    ),
  ).then(() => undefined);
}

async function waitForFonts(doc: Document): Promise<void> {
  try {
    const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) await fonts.ready;
  } catch {
    // FontFaceSet unsupported — proceed
  }
}

function waitForDocumentReady(doc: Document): Promise<void> {
  if (doc.readyState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    doc.addEventListener("readystatechange", () => {
      if (doc.readyState === "complete") resolve();
    });
  });
}

async function prepareAndPrint(target: Window, cleanup: () => void): Promise<void> {
  const doc = target.document;
  await waitForDocumentReady(doc);
  await waitForImages(doc);
  await waitForFonts(doc);
  // Brief yield so layout settles after image dimensions are known.
  await new Promise((r) => setTimeout(r, 50));
  try {
    target.focus();
    target.print();
  } catch (err) {
    console.error("Print failed:", err);
    alert("Unable to open the print dialog. Please check your browser print settings.");
  } finally {
    setTimeout(cleanup, 1500);
  }
}

/** Open a blank popup synchronously from a user click (Save & Print / reprint). */
export function openBlankPrintWindow(): Window | null {
  const w = window.open("", "_blank", "width=520,height=720");
  if (!w) return null;
  try {
    w.document.open();
    w.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>Preparing receipt…</title></head><body style="font-family:Arial,sans-serif;padding:24px;color:#555">Preparing receipt…</body></html>`,
    );
    w.document.close();
  } catch {
    /* ignore */
  }
  return w;
}

/**
 * Write HTML into a popup and print.
 * Pass a window opened synchronously on the user's click when printing after
 * an async save — otherwise pop-ups may be blocked and print() may not run.
 */
export function writeAndPrint(win: Window | null, html: string): void {
  let target = win;
  if (!target) {
    target = window.open("", "_blank", "width=520,height=720");
    if (!target) {
      alert("Pop-up blocked. Please allow pop-ups for this site to print bills.");
      return;
    }
  }

  let printed = false;
  const doPrint = () => {
    if (printed) return;
    printed = true;
    void prepareAndPrint(target!, () => {
      try {
        target!.close();
      } catch {
        /* ignore */
      }
    });
  };

  try {
    target.document.open();
    target.document.write(html);
    target.document.close();
  } catch {
    alert("Unable to write print content. Please try again.");
    return;
  }
  target.onload = doPrint;
  setTimeout(doPrint, 500);
}

/**
 * Print bill/receipt HTML. Opens a popup (same as writeAndPrint) — kept for
 * call-site compatibility after the hidden-iframe path was removed.
 */
export function printViaIframe(html: string): void {
  writeAndPrint(null, html);
}
