// Loads a folder into Zetaris, the data layer: scans it, writes the evidence CSV, puts the CSV where Zetaris can
// read it, and registers it with Lightning SQL as the evidence table. Used by `npm run ingest` and by the page's
// "Choose folder" button, so both do exactly the same thing.

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "../config.ts";
import { sql } from "../sponsors/zetaris.ts";
import { loadLibrary, writeEvidenceCsv, type FileSummary } from "./ingest.ts";

const run = promisify(execFile);

export type IngestResult = { folder: string; files: FileSummary[]; chunks: number; rows?: number };

/** The docker command: DOCKER_BIN, else the first docker found on PATH or in Docker Desktop's usual places. */
function dockerBin(): string {
  const candidates = [
    process.env.DOCKER_BIN,
    ...(process.env.PATH ?? "").split(path.delimiter).map((d) => path.join(d, "docker")),
    path.join(os.homedir(), ".docker", "bin", "docker"),
    "/usr/local/bin/docker",
    "/opt/homebrew/bin/docker",
  ].filter((c): c is string => !!c);
  return candidates.find((c) => fs.existsSync(c)) ?? "docker";
}

/**
 * Puts the CSV where Zetaris reads files (ZETARIS_SHARED_PATH): into ZETARIS_IMPORT_DIR when that folder is set
 * (a folder on this computer that Zetaris sees), otherwise into the local Zetaris container with `docker cp`.
 */
async function shareWithZetaris(csv: string, log: (line: string) => void): Promise<void> {
  const importDir = process.env.ZETARIS_IMPORT_DIR?.trim();
  if (importDir) {
    fs.mkdirSync(importDir, { recursive: true });
    fs.copyFileSync(csv, path.join(importDir, "evidence.csv"));
    log(`Copied to ${importDir}`);
    return;
  }
  const container = process.env.ZETARIS_CONTAINER?.trim() || "zetaris-driver-1";
  const target = `${config.zetaris!.sharedPath.replace(/\/$/, "")}/evidence.csv`;
  const docker = dockerBin();
  await run(docker, ["cp", csv, `${container}:${target}`]);
  // The query engine runs as the zetaris user; make the file its own.
  await run(docker, ["exec", "-u", "0", container, "chown", "zetaris:zetaris", target]).catch(() => undefined);
  log(`Copied into the Zetaris container (${container}:${target})`);
}

export async function ingestFolder(folder: string, log: (line: string) => void = () => {}): Promise<IngestResult> {
  const { evidence, files } = await loadLibrary(folder);
  const csv = writeEvidenceCsv(evidence, path.join(config.root, "data-out"));
  log(`Read ${files.length} supported files: ${evidence.length} passages`);
  if (!config.zetaris) return { folder, files, chunks: evidence.length };

  await shareWithZetaris(csv, log);
  const [db, table] = config.zetaris.evidenceTable.split(".");
  const csvPath = `${config.zetaris.sharedPath.replace(/\/$/, "")}/evidence.csv`;
  // Rebuilt from scratch each time, as in the KB (kbase.zetaris.com/knowledge/connecting-to-test-data-sources):
  // Lightning has no IF NOT EXISTS, and a filestore table is a view that DROP TABLE cannot remove.
  // The database holds only this evidence table. "Doesn't exist" on the first run is fine.
  try {
    await sql(`DROP LIGHTNING DATABASE ${db}`);
  } catch (e) {
    if (!/(doesn't|does not|not) exist/i.test((e as Error).message)) throw e;
  }
  await sql(`CREATE LIGHTNING DATABASE ${db} DESCRIBE BY "Proofloop evidence"`);
  // Quotes in the text are doubled ("") in the CSV.
  await sql(`CREATE LIGHTNING FILESTORE TABLE ${table} FROM ${db} FORMAT CSV OPTIONS (PATH "${csvPath}", header "true", inferSchema "true", escape '"')`);
  const rows = Number((await sql(`SELECT count(*) FROM ${db}.${table}`)).rows[0]?.[0] ?? 0);
  log(`Registered ${config.zetaris.evidenceTable} in Zetaris: ${rows} rows`);
  return { folder, files, chunks: evidence.length, rows };
}
