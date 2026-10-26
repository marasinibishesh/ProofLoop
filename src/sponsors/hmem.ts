// Meterless H-MEM: memory across runs. Proofloop remembers verified findings and rejected guesses,
// and can show each memory's audit history (TrustLedgerService). Loaded from vendor/hmem
// (run `npm run setup`), the same way the official agentathon-starter does.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "../config.ts";

export type HMEMInstance = {
  add(input: { content: string; type?: string; source?: string }): { id: string; layer: string; content: string };
  mine(event: string, text: string): Promise<{ id: string; content: string }[]>;
  query(q: string, opts?: { topN?: number; threshold?: number }): {
    memories: { relevance: number; memory: { id: string; content: string } }[];
    context: string;
    trace: { strategy: string };
  };
  feedback(memoryId: string, kind: string): void;
  ledger: { history(id: string): { action: string; actor: string; timestamp: number }[] };
};

const ENTRY = path.join(config.root, "vendor", "hmem", "src", "index.ts");

export async function openMemory(persistDir = path.join(config.stateDir, "memory")): Promise<HMEMInstance> {
  if (!fs.existsSync(ENTRY)) throw new Error("H-MEM engine not found. Run: npm run setup");
  const mod = await import(pathToFileURL(ENTRY).href);
  return new mod.HMEM({ persistDir, actor: "proofloop" }) as HMEMInstance;
}
