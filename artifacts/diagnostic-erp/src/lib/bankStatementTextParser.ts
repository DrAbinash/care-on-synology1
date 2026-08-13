export interface ParsedBankTxn {
  date: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  reference: string;
}

function normalizeDate(raw: string): string {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return raw;
  const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (!dmy) return raw;
  let [, d, m, y] = dmy;
  if (y.length === 2) y = `20${y}`;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

export function parseBankStatementText(text: string): ParsedBankTxn[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const rows: ParsedBankTxn[] = [];
  for (const line of lines) {
    if (/^date\b/i.test(line)) continue;
    if (/opening\s*balance/i.test(line) && !/\d/.test(line)) continue;
    const parts = line.includes("\t") ? line.split("\t") : line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
    const cells = parts.map((c) => c.replace(/^"|"$/g, "").trim());
    const dateCell = cells.find((c) => /^\d{1,2}[-/]\d{1,2}[-/](\d{2,4})$/.test(c) || /^\d{4}-\d{2}-\d{2}$/.test(c));
    if (!dateCell) continue;
    const nums = cells
      .map((c) => Number(c.replace(/[,₹]/g, "")))
      .filter((n) => Number.isFinite(n) && n !== 0);
    const desc = cells.find((c) => /[A-Za-z]{3,}/.test(c) && c !== dateCell) ?? "";
    const ref = cells.find((c) => /UTR|NEFT|IMPS|CHQ|CHEQUE|\d{6,}/i.test(c) && c !== dateCell) ?? "";
    let debit = 0, credit = 0, balance = 0;
    if (nums.length >= 3) {
      debit = nums[0]; credit = nums[1]; balance = nums[2];
    } else if (nums.length === 2) {
      balance = nums[1];
      if (/cr|credit|deposit|salary/i.test(line)) credit = nums[0];
      else debit = nums[0];
    } else if (nums.length === 1) {
      if (/cr|credit|deposit/i.test(line)) credit = nums[0];
      else debit = nums[0];
    }
    rows.push({
      date: normalizeDate(dateCell),
      description: desc,
      debit, credit, balance, reference: ref,
    });
  }
  return rows.filter((t) => t.debit > 0 || t.credit > 0);
}
