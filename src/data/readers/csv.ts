// Reads a spreadsheet saved as CSV. Every row becomes one chunk that names its columns,
// e.g. "type: Flight; date: 2 December 2026; from: Pokhara", so a quote from it is readable on its own.

import { readText } from "./text.ts";

const MAX_ROWS = 2000;

/** RFC 4180 CSV: quoted cells may hold commas, quotes ("") and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export function csvRows(text: string): string[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const names = header.map((h, i) => h.trim() || `column ${i + 1}`);
  return rows.slice(0, MAX_ROWS).map((r) =>
    r.map((v, i) => [names[i] ?? `column ${i + 1}`, v.replace(/\s+/g, " ").trim()]).filter(([, v]) => v).map(([n, v]) => `${n}: ${v}`).join("; "),
  ).filter(Boolean);
}

export function readCsv(file: string): string[] {
  return csvRows(readText(file));
}
