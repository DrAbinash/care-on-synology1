import { saveAs } from "file-saver";

/** Save print-layout HTML as a Word-readable .doc (HTML mime). */
export function saveHtmlAsWord(html: string, filename: string): void {
  const name = filename.endsWith(".doc") ? filename : `${filename}.doc`;
  const blob = new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" });
  saveAs(blob, name);
}
