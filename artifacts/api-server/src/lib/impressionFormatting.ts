/**
 * Parse and render impression bullets consistently across print-preview,
 * legacy HTML builder, and quality gates.
 */

export type ImpressionStyle = "bulleted" | "numbered" | "plain";

/** The heading-case vocabulary the client's fmtHeading uses, shared by the
 *  draft print-preview route so one document prints one case from every door. */
export type ServerHeadingCase = "all_caps" | "title_case";

/** Parse a headingCase query value; anything unrecognized is the historical
 *  default (title case), so existing callers stay byte-identical. */
export function parseHeadingCase(value: unknown): ServerHeadingCase {
  return value === "all_caps" || value === "title_case" ? value : "title_case";
}

/** The server twin of the client's fmtHeading: case-format a section heading. */
export function fmtServerHeading(text: string, headingCase: ServerHeadingCase = "title_case"): string {
  if (headingCase === "all_caps") return text.toUpperCase();
  return text.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/** Strip a leading manual number or bullet the radiologist may have typed. */
export function normalizeImpressionBullet(text: string): string {
  const trimmed = text.trim();
  const stripped = trimmed.replace(/^\s*(?:\d+[\.\)]\s+|[-•*]\s+)/, "").trim();
  return stripped || trimmed;
}

/** Parse draft.impression (JSON array or newline-separated plain text). */
export function parseImpressionBullets(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  let parts: string[] = [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      parts = parsed.flatMap((item) => String(item).split(/\n+/));
    }
  } catch {
    parts = raw.split(/\n+/);
  }
  if (parts.length === 0) parts = [raw];
  return parts.map((s) => s.trim()).filter(Boolean).map(normalizeImpressionBullet);
}

export function renderImpressionSectionHtml(
  bullets: string[],
  style: ImpressionStyle,
  esc: (s: string) => string,
  headingCase: ServerHeadingCase = "title_case",
): string {
  const items = bullets.filter(Boolean);
  if (items.length === 0) return "";
  const heading = `<div class="section-heading">${fmtServerHeading("Impression", headingCase)}</div>`;
  if (style === "numbered") {
    return `${heading}<ol>${items.map((b) => `<li>${esc(b)}</li>`).join("")}</ol>`;
  }
  if (style === "plain") {
    return `${heading}<p>${items.map((b) => esc(b)).join("; ")}</p>`;
  }
  return `${heading}<ul>${items.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`;
}

export function parseImpressionStyle(value: unknown): ImpressionStyle {
  if (value === "numbered" || value === "plain" || value === "bulleted") return value;
  return "bulleted";
}
