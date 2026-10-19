/**
 * One CSV cell, quoted, and safe to open in a spreadsheet: a value starting
 * with = + - @ (or a tab / carriage return) is prefixed with ' so Excel and
 * Sheets show it as text instead of running it as a formula. Customer-entered
 * text (names, messages) reaches these exports.
 */
export function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\n");
}
