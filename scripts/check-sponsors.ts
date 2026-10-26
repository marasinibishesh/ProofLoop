// One real call to each sponsor technology, so we know the foundations work before building on them.
//   npm run check
// Prints PASS / FAIL / SKIP for Nightshift, Zetaris, H-MEM and World Model.
// SKIP means the credentials aren't set in .env yet; engines need no credentials.

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { config } from "../src/config.ts";
import { chat, listModels } from "../src/sponsors/nightshift.ts";
import { sql } from "../src/sponsors/zetaris.ts";
import { openMemory } from "../src/sponsors/hmem.ts";
import { openWorld } from "../src/sponsors/worldModel.ts";

type Result = { name: string; status: "PASS" | "FAIL" | "SKIP"; detail: string };
const results: Result[] = [];

async function check(name: string, configured: boolean, why: string, fn: () => Promise<string>) {
  if (!configured) return results.push({ name, status: "SKIP", detail: why });
  try {
    results.push({ name, status: "PASS", detail: await fn() });
  } catch (e) {
    results.push({ name, status: "FAIL", detail: (e as Error).message });
  }
}

await check("Nightshift (AI provider)", !!config.nightshift, "set METERLESS_RUNTIME_TOKEN in .env", async () => {
  const models = await listModels();
  const nvidia = models.filter((m) => m.startsWith("nvidia/"));
  if (!models.includes(config.nightshift!.model)) {
    throw new Error(`pinned model ${config.nightshift!.model} not offered. NVIDIA models seen: ${nvidia.join(", ") || "none (see Nightshift Mac issue #4)"}`);
  }
  const { text, receipt } = await chat([{ role: "user", content: "Reply with exactly one word: ready" }]);
  return `${models.length} models (${nvidia.length} NVIDIA). Reply "${text.trim().slice(0, 40)}" served by ${receipt.servedModel}` +
    ` routed=${receipt.routedModel ?? "?"} provider=${receipt.provider ?? "?"} receipt=${receipt.receiptId ?? "none"} in ${receipt.ms} ms`;
});

await check("Zetaris (data layer)", !!config.zetaris, "set ZETARIS_ORG_ID and ZETARIS_API_KEY in .env", async () => {
  const r = await sql("SELECT 1");
  return `SELECT 1 -> ${JSON.stringify(r.rows[0] ?? r.rows)} in ${r.ms} ms (query ${r.queryId})`;
});

await check("H-MEM (memory engine)", true, "", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proofloop-hmem-"));
  const memory = await openMemory(dir);
  const rec = memory.add({ content: "Camera-ready paper is due on 20 November", type: "general", source: "check" });
  const hit = memory.query("when is the camera-ready paper due", { threshold: 0.05 });
  const found = hit.memories.some((m) => m.memory.id === rec.id);
  if (!found) throw new Error("stored memory was not recalled");
  return `stored ${rec.id} and recalled it (strategy ${hit.trace.strategy}); ledger entries: ${memory.ledger.history(rec.id).length}`;
});

await check("World Model (evidence graph)", true, "", async () => {
  const world = await openWorld({ namespace: "proofloop-check", conflictPolicy: "highest-confidence-wins" });
  const at = new Date().toISOString();
  const a = await world.assertFact({ about: "talk:proofloop", predicate: "date", value: "3 December", confidence: 0.4, source: { kind: "file", by: "investigator", url: "slides_notes.txt", at } });
  const b = await world.assertFact({ about: "talk:proofloop", predicate: "date", value: "4 December", confidence: 0.9, source: { kind: "file", by: "investigator", url: "programme.txt", at } });
  const facts = world.view("facts").about("talk:proofloop");
  const loser = facts.find((f: any) => f.supersededBy);
  if (!loser) throw new Error("conflict was not detected");
  return `conflict detected: "${loser.value}" superseded by "${facts.find((f: any) => f.id === loser.supersededBy)?.value}" (${a.id.slice(0, 8)} vs ${b.id.slice(0, 8)})`;
});

for (const r of results) console.log(`${r.status.padEnd(4)}  ${r.name}\n      ${r.detail}`);
const failed = results.some((r) => r.status === "FAIL");
console.log(failed ? "\nSome checks failed. Fix these before building on them." : "\nNo failures. SKIP lines just need credentials in .env.");
process.exit(failed ? 1 : 0);
