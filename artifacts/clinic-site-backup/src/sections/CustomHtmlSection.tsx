import DOMPurify from "dompurify";
import type { Section } from "../types";

function get(c: Record<string, unknown>, k: string, fb = ""): string {
  return typeof c[k] === "string" ? (c[k] as string) : fb;
}

function sanitizeCustomHtml(html: string): string {
  if (!html) return "";
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ["iframe"],
    ADD_ATTR: ["allowfullscreen", "loading", "referrerpolicy", "frameborder", "allow", "target"],
  });
}

export default function CustomHtmlSection({ section }: { section: Section }) {
  const c = section.config;
  const html = get(c, "html");
  const sanitized = sanitizeCustomHtml(html);
  return <section className="section"><div className="container-narrow" dangerouslySetInnerHTML={{ __html: sanitized }} /></section>;
}
