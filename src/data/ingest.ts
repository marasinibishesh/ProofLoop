// Ingest: turns a folder of documents and notes into evidence chunks (one paragraph block each), and
// writes them as a CSV table that Zetaris reads (evidence: id, source, kind, chunk_no, text).

import fs from "node:fs";
import path from "node:path";
import type { Evidence } from "../types.ts";
import { isSupported, readText } from "./readers/text.ts";

/** Reads every supported file in a folder and splits it into paragraph-block chunks. */
export function loadEvidence(folder: string): Evidence[] {
  const out: Evidence[] = [];
  for (const name of fs.readdirSync(folder).sort()) {
    const file = path.join(folder, name);
    if (!fs.statSync(file).isFile() || !isSupported(file)) continue;
    const blocks = readText(file).split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    blocks.forEach((text, i) => out.push({ id: `${name}#${i + 1}`, source: name, kind: name.endsWith(".md") ? "note" : "file", text }));
  }
  return out;
}

const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

/**
 * CSV with a header row. Line breaks inside a chunk become spaces, so every record is one line and any CSV
 * reader can load it; the evaluator's quote check ignores whitespace, so nothing is lost.
 */
export function toCsv(evidence: Evidence[]): string {
  const rows = evidence.map((e, i) => [e.id, e.source, e.kind, i + 1, e.text.replace(/\s*\n\s*/g, " ")].map(csvCell).join(","));
  return ["id,source,kind,chunk_no,text", ...rows].join("\n") + "\n";
}

/** Writes evidence.csv into a folder (for Zetaris: a folder its engine can read). Returns the path. */
export function writeEvidenceCsv(evidence: Evidence[], folder: string): string {
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, "evidence.csv");
  fs.writeFileSync(file, toCsv(evidence));
  return file;
}
