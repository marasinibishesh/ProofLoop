// Ingest: point Proofloop at a folder (even a messy one like Downloads). It walks the folder, reads every
// supported file (text, Markdown, PDF, CSV spreadsheet, .ics calendar), skips identical copies, marks older
// versions, and splits everything into evidence chunks. The chunks are written as a CSV table that Zetaris
// reads (evidence: id, source, kind, chunk_no, newer_version, text).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Evidence } from "../types.ts";
import { readCsv } from "./readers/csv.ts";
import { readIcs } from "./readers/ics.ts";
import { readPdf } from "./readers/pdf.ts";
import { chunkText, readText } from "./readers/text.ts";
import { detectVersions } from "./versions.ts";

const READERS: Record<string, { kind: Evidence["kind"]; read: (file: string) => string[] | Promise<string[]> }> = {
  ".txt": { kind: "file", read: (f) => chunkText(readText(f)) },
  ".md": { kind: "note", read: (f) => chunkText(readText(f)) },
  ".pdf": { kind: "pdf", read: readPdf },
  ".csv": { kind: "table", read: readCsv },
  ".ics": { kind: "calendar", read: readIcs },
};

export const SUPPORTED = Object.keys(READERS);
export const isSupported = (file: string) => SUPPORTED.includes(path.extname(file).toLowerCase());

const SKIP_DIRS = new Set(["node_modules", "vendor", "data-out", "$recycle.bin", "appdata"]);
const LIMITS = { depth: 4, files: 500, bytes: 25_000_000 };

export type ScannedFile = { file: string; rel: string; size: number; modified: number };

/** Supported files under a folder (hidden folders, dependencies and huge files skipped). Paths use "/". */
export function scanFolder(root: string): ScannedFile[] {
  const out: ScannedFile[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // no permission: skip
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= LIMITS.files || e.name.startsWith(".") || e.name.startsWith("~$")) continue;
      const file = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < LIMITS.depth && !SKIP_DIRS.has(e.name.toLowerCase())) walk(file, depth + 1);
      } else if (e.isFile() && isSupported(e.name)) {
        const st = fs.statSync(file);
        if (st.size > 0 && st.size <= LIMITS.bytes) out.push({ file, rel: path.relative(root, file).split(path.sep).join("/"), size: st.size, modified: st.mtimeMs });
      }
    }
  };
  walk(root, 0);
  return out;
}

/** What Proofloop found in one file, for the page and the ingest report. */
export type FileSummary = {
  source: string;
  kind: Evidence["kind"];
  chunks: number;
  newerVersion?: string;
  duplicateOf?: string;
  error?: string;
};
export type Library = { folder: string; evidence: Evidence[]; files: FileSummary[] };

const cache = new Map<string, { stamp: string; library: Library }>();

/** Reads a folder into evidence. Cached until a file is added, removed or changed. */
export async function loadLibrary(folder: string): Promise<Library> {
  const scanned = scanFolder(folder);
  const stamp = scanned.map((f) => `${f.rel}|${f.size}|${f.modified}`).join("\n");
  const hit = cache.get(folder);
  if (hit?.stamp === stamp) return hit.library;

  const read = await Promise.all(scanned.map(async (f) => {
    const reader = READERS[path.extname(f.file).toLowerCase()];
    try {
      const chunks = await reader.read(f.file);
      return { f, kind: reader.kind, chunks, hash: crypto.createHash("sha1").update(chunks.join("\n").replace(/\s+/g, " ")).digest("hex") };
    } catch (e) {
      return { f, kind: reader.kind, chunks: [] as string[], hash: `error:${f.rel}`, error: (e as Error).message };
    }
  }));
  const versions = detectVersions(read.filter((r) => r.chunks.length).map((r) => ({ rel: r.f.rel, modified: r.f.modified, hash: r.hash })));

  const evidence: Evidence[] = [];
  const files: FileSummary[] = [];
  for (const r of read) {
    const source = r.f.rel;
    const duplicateOf = versions.duplicateOf.get(source);
    const newerVersion = versions.newerVersion.get(source);
    files.push({ source, kind: r.kind, chunks: r.chunks.length, newerVersion, duplicateOf, error: r.error ?? (r.chunks.length ? undefined : "no readable text") });
    if (duplicateOf) continue; // identical copy: read once
    r.chunks.forEach((text, i) => evidence.push({ id: `${source}#${i + 1}`, source, kind: r.kind, text, ...(newerVersion ? { newerVersion } : {}) }));
  }
  const library = { folder, evidence, files };
  cache.set(folder, { stamp, library });
  return library;
}

export async function loadEvidence(folder: string): Promise<Evidence[]> {
  return (await loadLibrary(folder)).evidence;
}

const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

/**
 * CSV with a header row. Line breaks inside a chunk become spaces, so every record is one line and any CSV
 * reader can load it; the evaluator's quote check ignores whitespace, so nothing is lost.
 */
export function toCsv(evidence: Evidence[]): string {
  const rows = evidence.map((e, i) => [e.id, e.source, e.kind, i + 1, e.newerVersion ?? "", e.text.replace(/\s*\n\s*/g, " ")].map(csvCell).join(","));
  return ["id,source,kind,chunk_no,newer_version,text", ...rows].join("\n") + "\n";
}

/** Writes evidence.csv into a folder (for Zetaris: a folder its engine can read). Returns the path. */
export function writeEvidenceCsv(evidence: Evidence[], folder: string): string {
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, "evidence.csv");
  fs.writeFileSync(file, toCsv(evidence));
  return file;
}
