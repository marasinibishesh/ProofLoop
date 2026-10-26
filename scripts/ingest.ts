// Loads your documents into Zetaris (the data layer):
//   1. scans PROOFLOOP_DOCS (subfolders too) for .txt, .md, .pdf, .csv and .ics files, skips identical
//      copies, marks older versions, and splits everything into evidence chunks
//   2. writes data-out/evidence.csv, and copies it into ZETARIS_IMPORT_DIR if set
//      (the folder on THIS computer that Zetaris sees as ZETARIS_SHARED_PATH, e.g. a Docker volume)
//   3. registers it with Lightning SQL so agents can query it: PROOFLOOP.evidence
//
//   npm run ingest

import fs from "node:fs";
import path from "node:path";
import { config } from "../src/config.ts";
import { loadLibrary, writeEvidenceCsv } from "../src/data/ingest.ts";
import { sql } from "../src/sponsors/zetaris.ts";

const { evidence, files } = await loadLibrary(config.docsDir);
console.log(`Scanned ${config.docsDir}: ${files.length} supported files`);
for (const f of files) {
  const note = f.duplicateOf ? `identical copy of ${f.duplicateOf}, skipped`
    : f.error ? `NOT READ: ${f.error}`
    : `${f.chunks} chunk(s)${f.newerVersion ? `, older version of ${f.newerVersion} (counts half)` : ""}`;
  console.log(`  ${f.kind.padEnd(8)} ${f.source}  -> ${note}`);
}
const local = writeEvidenceCsv(evidence, path.join(config.root, "data-out"));
console.log(`Wrote ${evidence.length} evidence chunks -> ${local}`);

const importDir = process.env.ZETARIS_IMPORT_DIR?.trim();
if (importDir) {
  fs.mkdirSync(importDir, { recursive: true });
  fs.copyFileSync(local, path.join(importDir, "evidence.csv"));
  console.log(`Copied to ${importDir} (Zetaris reads it as ${config.zetaris?.sharedPath ?? "ZETARIS_SHARED_PATH"}/evidence.csv)`);
}

if (!config.zetaris) {
  console.log("\nZetaris is not configured in .env, so the table was not registered. Set ZETARIS_* and run again.");
  process.exit(0);
}

const [db, table] = config.zetaris.evidenceTable.split(".");
const csvPath = `${config.zetaris.sharedPath.replace(/\/$/, "")}/evidence.csv`;
const statements = [
  `CREATE LIGHTNING DATABASE IF NOT EXISTS ${db} DESCRIBE BY "${db}"`,
  `DROP TABLE IF EXISTS ${db}.${table}`,
  `CREATE LIGHTNING FILESTORE TABLE ${table} FROM ${db} FORMAT CSV OPTIONS (PATH "${csvPath}", header "true", inferSchema "true")`,
  `SELECT count(*) FROM ${db}.${table}`,
];
for (const s of statements) {
  try {
    const r = await sql(s);
    console.log(`OK   ${s}${r.rows.length ? `  -> ${JSON.stringify(r.rows[0])}` : ""}`);
  } catch (e) {
    console.log(`FAIL ${s}\n     ${(e as Error).message}`);
    if (s.startsWith("CREATE LIGHTNING FILESTORE")) {
      console.log("     Check that Zetaris can read the file at that path (see ZETARIS_IMPORT_DIR / ZETARIS_SHARED_PATH).");
      process.exit(1);
    }
  }
}
console.log(`\nDone. Agents will now search ${config.zetaris.evidenceTable} through Zetaris.`);
