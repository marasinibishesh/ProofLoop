// Proves the two Meterless engines work inside Proofloop (no credentials needed).
// Run: npm test   (after npm run setup)

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openMemory } from "../src/sponsors/hmem.ts";
import { openWorld } from "../src/sponsors/worldModel.ts";

describe("H-MEM memory", () => {
  it("remembers a verified finding and recalls it with provenance", async () => {
    const memory = await openMemory(fs.mkdtempSync(path.join(os.tmpdir(), "proofloop-test-")));
    const rec = memory.add({ content: "Register for the conference by 15 November (acceptance_letter.txt)", type: "general", source: "evaluator" });
    const result = memory.query("by when must I register", { threshold: 0.05 });
    expect(result.memories.map((m) => m.memory.id)).toContain(rec.id);
    expect(memory.ledger.history(rec.id).length).toBeGreaterThan(0);
  });
});

describe("World Model evidence graph", () => {
  it("detects conflicting dates from two sources and keeps the more trusted one", async () => {
    const world = await openWorld({ namespace: "test-conflict", conflictPolicy: "highest-confidence-wins" });
    const at = new Date().toISOString();
    await world.assertFact({ about: "talk:508", predicate: "date", value: "3 December", confidence: 0.4, source: { kind: "file", url: "slides_notes.txt", at } });
    await world.assertFact({ about: "talk:508", predicate: "date", value: "4 December", confidence: 0.9, source: { kind: "file", url: "programme.txt", at } });
    const facts = world.view("facts").about("talk:508");
    const superseded = facts.filter((f: { supersededBy?: string }) => f.supersededBy);
    expect(superseded.map((f: { value: string }) => f.value)).toEqual(["3 December"]);
    expect(world.view("graph").entity("talk:508")?.attrs.date).toBe("4 December");
  });
});
