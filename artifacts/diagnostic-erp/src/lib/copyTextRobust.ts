/**
 * Copy text on both HTTPS and HTTP LAN (192.168.x ERP).
 * navigator.clipboard requires a secure context; on http://NAS:8888 it is
 * missing or throws — staff then paste whatever was last on the clipboard
 * (often a screenshot). Fall back to a temporary textarea + execCommand.
 */
export async function copyTextRobust(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
