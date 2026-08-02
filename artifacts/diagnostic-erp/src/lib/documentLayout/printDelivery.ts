/**
 * Shared browser print delivery for all CARE ERP documents.
 * - Hidden iframe for normal direct-print flows
 * - Popup window for user-activation-sensitive reprints (Bill Detail)
 *
 * Both paths wait for document readiness, images, and fonts before printing
 * exactly once. No Electron APIs.
 */

const IFRAME_ID = "__care_print_iframe__";

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

/**
 * Print via a hidden iframe (Billing Desk, Kiosk, Bill Detail ?print=1).
 */
export function printViaIframe(html: string): void {
  const existing = document.getElementById(IFRAME_ID);
  if (existing) existing.remove();

  const iframe = document.createElement("iframe");
  iframe.id = IFRAME_ID;
  iframe.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  if (!win || !doc) {
    alert("Unable to prepare print preview. Please try again or allow iframes.");
    iframe.remove();
    return;
  }

  let printed = false;
  const doPrint = () => {
    if (printed) return;
    printed = true;
    void prepareAndPrint(win, () => {
      try {
        iframe.remove();
      } catch {
        /* ignore */
      }
    });
  };

  doc.open();
  doc.write(html);
  doc.close();
  iframe.onload = doPrint;
  // Fallback if onload does not fire (some browsers with doc.write).
  setTimeout(doPrint, 500);
}

/** Open a blank popup synchronously from a user click (reprint flow). */
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
 * Write HTML into a popup and print (Bill Detail reprint).
 * If `win` is null, opens a new popup (may be blocked).
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
