// Loads your documents into Zetaris (the data layer):
//   1. scans the folder (subfolders too) for .txt, .md, .pdf, .csv and .ics files, skips identical
//      copies, marks older versions, and splits everything into evidence chunks
//   2. writes data-out/evidence.csv and puts it where Zetaris reads files (ZETARIS_IMPORT_DIR if set,
//      otherwise into the local Zetaris container with `docker cp`)
//   3. registers it with Lightning SQL so agents can query it: PROOFLOOP.evidence
//
//   npm run ingest                (the folder chosen on the page, else PROOFLOOP_DOCS, else the sample)
//
// The page's "Choose folder" button does the same thing; this script is for the command line.

import { config } from "../src/config.ts";
import { ingestFolder } from "../src/data/zetarisIngest.ts";

try {
  const r = await ingestFolder(config.docsDir, (line) => console.log(line));
  console.log(`Scanned ${config.docsDir}: ${r.files.length} supported files`);
  for (const f of r.files) {
    const note = f.duplicateOf ? `identical copy of ${f.duplicateOf}, skipped`
      : f.error ? `NOT READ: ${f.error}`
      : `${f.chunks} chunk(s)${f.newerVersion ? `, older version of ${f.newerVersion} (counts half)` : ""}`;
    console.log(`  ${f.kind.padEnd(8)} ${f.source}  -> ${note}`);
  }
  console.log(config.zetaris
    ? `\nDone. ${r.chunks} chunks, ${r.rows} rows in ${config.zetaris.evidenceTable}. Agents will now search it through Zetaris.`
    : "\nZetaris is not configured in .env, so the table was not registered. Set ZETARIS_* and run again.");
} catch (e) {
  console.error(`FAIL ${(e as Error).message}`);
  console.error("Check that Zetaris is running (docker compose ps) and can read the file (ZETARIS_IMPORT_DIR / ZETARIS_CONTAINER).");
  process.exit(1);
}
