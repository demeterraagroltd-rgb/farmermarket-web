// A minimal, safe CSV writer for the transaction export.
//
// The one thing that makes this more than string-joining: the cells are
// *bank narrations*, text typed by senders we don't control, and the file is
// going to be opened in a spreadsheet. A narration that begins with `=`, `+`,
// `-` or `@` is a formula to Excel and Sheets — "=HYPERLINK(...)" in a transfer
// description would run when an analyst opens the export. So any such cell is
// forced to text with a leading apostrophe. OWASP calls this CSV injection.

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "string" ? value : String(value);
  if (typeof value === "string" && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  // BOM first: without it Excel reads UTF-8 (₦, accented names) as Latin-1.
  return "\uFEFF" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** 2500000 kobo → "25000.00" — a plain decimal, so a spreadsheet can sum the column. */
export function nairaFromKobo(kobo: number | bigint | null | undefined): string {
  if (kobo === null || kobo === undefined) return "";
  const n = typeof kobo === "bigint" ? kobo : BigInt(Math.round(kobo));
  const neg = n < 0n;
  const abs = neg ? -n : n;
  return `${neg ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}
