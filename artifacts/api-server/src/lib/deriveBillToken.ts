/** Bill-level queue token shown on receipts/WhatsApp — derived from per-dept test tokens. */
export function deriveBillTokenFromTestTokens(
  testTokens: Array<{ tokenNo: number }>,
  tokenDate?: string,
): { tokenNo: number; tokenDate: string } | null {
  if (!testTokens.length) return null;
  const minTokenNo = testTokens.reduce((min, t) => (t.tokenNo < min ? t.tokenNo : min), testTokens[0].tokenNo);
  const today = new Date();
  const defaultDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return { tokenNo: minTokenNo, tokenDate: tokenDate ?? defaultDate };
}
