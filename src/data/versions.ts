// Finds older versions and identical copies among the user's files, so agents trust the newest version.
//   programme_draft.txt, programme.txt, programme_v2.pdf  -> one family; programme_v2.pdf is the newest
//   report.pdf and "report (1).pdf" with the same text  -> identical copies; only one is read
// Families are matched inside one folder, by file name with version words, numbers and dates removed.

import path from "node:path";

export type VersionedFile = { rel: string; modified: number; hash: string };
export type Versions = {
  /** older file -> the newest file in its family */
  newerVersion: Map<string, string>;
  /** identical copy -> the file that is read instead */
  duplicateOf: Map<string, string>;
};

const WORDS = { older: ["draft", "old", "prelim", "preliminary"], newer: ["final", "updated", "revised", "latest", "new"] };
const VERSION = /(?:^|[\s_\-.(])v(?:er(?:sion)?)?[\s_\-.]?(\d+)/i;
const DATE = /(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/;

/** Folder + name without extension, version words, numbers, dates and copy markers. */
export function familyKey(rel: string): string {
  const dir = path.posix.dirname(rel);
  const base = path.posix.basename(rel, path.posix.extname(rel)).toLowerCase();
  const stripped = base
    .replace(/^copy of\s+/, "")
    .replace(/\s*-\s*copy\b/g, "")
    .replace(/\(\d+\)/g, "")
    .replace(new RegExp(VERSION.source, "gi"), " ")
    .replace(new RegExp(DATE.source, "g"), " ")
    // Letters-only boundaries: "_" counts as a separator ("programme_draft"), unlike in \b.
    .replace(new RegExp(`(^|[^a-z])(${[...WORDS.older, ...WORDS.newer, "copy", "rev\\d*"].join("|")})(?![a-z])`, "g"), "$1")
    .replace(/[^a-z0-9]+/g, "");
  return `${dir}/${stripped || base}`;
}

/** [version number, version word, date in name]: higher is newer. No number counts as version 1. */
export function versionRank(rel: string): number[] {
  const base = path.posix.basename(rel, path.posix.extname(rel)).toLowerCase();
  const num = Number(VERSION.exec(base)?.[1] ?? 1);
  const words = base.split(/[^a-z]+/);
  const word = words.some((w) => WORDS.newer.includes(w)) ? 1 : words.some((w) => WORDS.older.includes(w)) ? -1 : 0;
  const d = DATE.exec(base);
  return [num, word, d ? Number(d[1] + d[2] + d[3]) : 0];
}

/**
 * Compares two files of one family: >0 if a is newer. Names decide first; the modified time only counts
 * when it differs by more than a minute (a fresh git clone or copy gives every file nearly the same time).
 */
function compare(a: VersionedFile, b: VersionedFile): number {
  const ra = versionRank(a.rel), rb = versionRank(b.rel);
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
  return Math.abs(a.modified - b.modified) > 60_000 ? a.modified - b.modified : 0;
}

export function detectVersions(files: VersionedFile[]): Versions {
  const duplicateOf = new Map<string, string>();
  const byHash = new Map<string, VersionedFile[]>();
  for (const f of files) byHash.set(f.hash, [...(byHash.get(f.hash) ?? []), f]);
  for (const copies of byHash.values()) {
    if (copies.length < 2) continue;
    // Same content, so keep the cleanest name: no copy marker, then the shallowest folder, then the shortest
    // ("report.pdf" over "Downloads/report (1).pdf"). Not the newest: a fresh download is always newer.
    const copyMarker = (rel: string) => (/\(\d+\)|\bcopy\b/i.test(path.posix.basename(rel)) ? 1 : 0);
    const depth = (rel: string) => rel.split("/").length;
    const keep = [...copies].sort((a, b) =>
      copyMarker(a.rel) - copyMarker(b.rel) || depth(a.rel) - depth(b.rel) || a.rel.length - b.rel.length || a.rel.localeCompare(b.rel))[0];
    for (const c of copies) if (c !== keep) duplicateOf.set(c.rel, keep.rel);
  }

  const newerVersion = new Map<string, string>();
  const families = new Map<string, VersionedFile[]>();
  for (const f of files.filter((f) => !duplicateOf.has(f.rel))) {
    const key = familyKey(f.rel);
    families.set(key, [...(families.get(key) ?? []), f]);
  }
  for (const family of families.values()) {
    if (family.length < 2) continue;
    const newest = family.reduce((best, f) => (compare(f, best) > 0 ? f : best));
    // Only files that are clearly older are marked; a tie means we can't tell, so both stay current.
    for (const f of family) if (f !== newest && compare(newest, f) > 0) newerVersion.set(f.rel, newest.rel);
  }
  return { newerVersion, duplicateOf };
}
