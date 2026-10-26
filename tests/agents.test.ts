// The agent loop in sample mode (no credentials): evidence, quote checks, retries, conflicts, memory.

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ask } from "../src/agents/orchestrator.ts";
import { quoteFound } from "../src/agents/evaluator.ts";
import type { Brain, DraftClaim, Judgement } from "../src/agents/brain.ts";
import { LocalEvidenceStore } from "../src/data/evidenceStore.ts";
import { loadEvidence } from "../src/data/ingest.ts";
import { openMemory } from "../src/sponsors/hmem.ts";
import type { Claim, Evidence, SubQuestion } from "../src/types.ts";

const SAMPLES = path.join(import.meta.dirname, "..", "samples", "conference");
const freshMemory = () => openMemory(fs.mkdtempSync(path.join(os.tmpdir(), "proofloop-agents-")));

describe("quote check", () => {
  it("finds quotes regardless of case, curly quotes and line breaks", () => {
    expect(quoteFound("day 2 - 4 december 2026 10:30", "Day 2 - 4 December 2026\n10:30  Session B")).toBe(true);
    expect(quoteFound("“Keep it short”", 'Note: "keep it short" please')).toBe(true);
    expect(quoteFound("talk is on 5 December", "My talk is on 3 December")).toBe(false);
  });
});

describe("sample questions", () => {
  it("answers the to-do question with confirmed, quoted points", async () => {
    const a = await ask("What do I need to do before the conference, and by when?", { memory: await freshMemory() });
    expect(a.points.length).toBeGreaterThanOrEqual(4);
    expect(a.points.every((p) => p.label === "confirmed")).toBe(true);
    expect(a.points.some((p) => p.statement.includes("20 November 2026"))).toBe(true);
    expect(a.points.flatMap((p) => p.sources).every((s) => s.quote.length > 0)).toBe(true);
  });

  it("resolves the talk-date conflict with the World Model and keeps the programme", async () => {
    const a = await ask("When exactly is my talk?", { memory: await freshMemory() });
    const p = a.points.find((x) => x.label === "conflict");
    expect(p?.statement).toContain("4 December");
    expect(p?.sources.find((s) => s.kept === false)?.source).toBe("slides_notes.txt");
    expect(a.trace.some((t) => t.agent === "world-model" && t.detail?.includes("1 superseded"))).toBe(true);
  });

  it("refuses to confirm hearsay: the dinner date is not proven after a retry", async () => {
    const a = await ask("When is the conference dinner?", { memory: await freshMemory() });
    expect(a.points).toHaveLength(0);
    expect(a.unproven[0]?.statement).toContain("dinner");
    expect(a.trace.map((t) => t.action)).toEqual(expect.arrayContaining(["reject", "send back", "gave up"]));
  });

  it("remembers verified findings for the next question (H-MEM)", async () => {
    const memory = await freshMemory();
    await ask("When exactly is my talk?", { memory });
    const second = await ask("When exactly is my talk?", { memory });
    expect(second.memory.some((m) => m.includes("4 December"))).toBe(true);
  });
});

describe("the evaluator sends bad claims back", () => {
  it("rejects a quote that isn't in the file, and accepts the corrected retry", async () => {
    const calls: (string | undefined)[] = [];
    const brain: Brain = {
      label: "test brain",
      plan: async (): Promise<SubQuestion[]> => [{ id: "s1", text: "How long is the talk?" }],
      investigate: async (_q, _s, _e: Evidence[], hint?: string): Promise<DraftClaim[]> => {
        calls.push(hint);
        const quote = hint ? "15 minutes + 5 minutes questions" : "The talk lasts twenty minutes"; // first one is invented
        return [{ statement: "The talk is 15 minutes plus 5 for questions.", quote, source: "programme.txt", subject: "talk", predicate: "length", value: "15+5" }];
      },
      judge: async (_c: Claim): Promise<Judgement> => ({ supported: true, confidence: 0.9, reason: "In the programme." }),
    };
    const a = await ask("How long is my talk?", { brain, store: new LocalEvidenceStore(loadEvidence(SAMPLES)), memory: await freshMemory() });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("was not found word for word");
    expect(a.points[0]?.label).toBe("confirmed");
    expect(a.trace.some((t) => t.action === "reject (code check)")).toBe(true);
  });
});
