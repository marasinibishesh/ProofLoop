// Meterless World Model: the evidence graph. Every claim the agents accept is asserted as a fact with
// provenance (which file, which quote). When two sources give different values for the same thing,
// the engine's conflict policy picks a winner, marks the other as superseded, and logs why.
// Loaded from vendor/world-model (run `npm run setup`).

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "../config.ts";

const ENTRY = path.join(config.root, "vendor", "world-model", "src", "index.ts");

export type ConflictPolicy = "most-recent-wins" | "highest-confidence-wins" | "source-priority";

export async function openWorld(opts: { namespace?: string; persist?: boolean; conflictPolicy?: ConflictPolicy; sourcePriority?: string[] } = {}) {
  if (!fs.existsSync(ENTRY)) throw new Error("World Model engine not found. Run: npm run setup");
  const mod = await import(pathToFileURL(ENTRY).href);
  return new mod.WorldModel({
    namespace: opts.namespace ?? "proofloop",
    storage: opts.persist ? "local" : "memory",
    directory: config.stateDir,
    conflictPolicy: opts.conflictPolicy ?? "highest-confidence-wins",
    sourcePriority: opts.sourcePriority,
  });
}
