// The agent loop in sample mode (no credentials): evidence, quote checks, retries, conflicts, memory.

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ask } from "../src/agents/orchestrator.ts";
import { quoteFound } from "../src/agents/evaluator.ts";
import { dropDiscredited, sameValue, unifySubjects } from "../src/agents/answer.ts";
import { SampleBrain, type Brain, type DraftClaim, type Judgement } from "../src/agents/brain.ts";
import { LocalEvidenceStore } from "../src/data/evidenceStore.ts";
import { loadEvidence } from "../src/data/ingest.ts";
import { openMemory } from "../src/sponsors/hmem.ts";
import type { Claim, Evidence, SubQuestion } from "../src/types.ts";

const SAMPLES = path.join(import.meta.dirname, "..", "samples", "conference");
const freshMemory = () => openMemory(fs.mkdtempSync(path.join(os.tmpdir(), "proofloop-agents-")));
// Always the bundled sample replies and files, whatever .env says (a runtime token or PROOFLOOP_DOCS would
// otherwise send these tests to live Nemotron or to the user's own folder).
const sample = async () => ({
  brain: new SampleBrain(path.join(SAMPLES, "sample-replies.json")),
  store: new LocalEvidenceStore(await loadEvidence(SAMPLES)),
  memory: await freshMemory(),
});

describe("quote check", () => {
  it("finds quotes regardless of case, curly quotes and line breaks", () => {
    expect(quoteFound("day 2 - 4 december 2026 10:30", "Day 2 - 4 December 2026\n10:30  Session B")).toBe(true);
    expect(quoteFound("“Keep it short”", 'Note: "keep it short" please')).toBe(true);
    expect(quoteFound("talk is on 5 December", "My talk is on 3 December")).toBe(false);
  });
});

describe("sample questions", () => {
  it("answers the to-do question with confirmed, quoted points", async () => {
    const a = await ask("What do I need to do before the conference, and by when?", await sample());
    expect(a.points.length).toBeGreaterThanOrEqual(4);
    expect(a.points.every((p) => p.label === "confirmed")).toBe(true);
    expect(a.points.some((p) => p.statement.includes("20 November 2026"))).toBe(true);
    expect(a.points.flatMap((p) => p.sources).every((s) => s.quote.length > 0)).toBe(true);
  });

  it("resolves the talk-date conflict with the World Model and keeps the final programme", async () => {
    const a = await ask("When exactly is my talk?", await sample());
    const p = a.points.find((x) => x.label === "conflict");
    expect(p?.statement).toContain("4 December");
    expect(p?.sources.find((s) => s.kept)?.source).toBe("programme.txt");
    expect(p?.sources.filter((s) => s.kept === false).map((s) => s.source).sort()).toEqual(["calendar.ics", "programme_draft.txt", "slides_notes.txt"]);
    expect(a.trace.some((t) => t.agent === "world-model" && t.detail?.includes("3 superseded"))).toBe(true);
  });

  it("trusts the newest version: the draft programme counts half", async () => {
    const a = await ask("When exactly is my talk?", await sample());
    const draft = a.points.flatMap((p) => p.sources).find((s) => s.source === "programme_draft.txt");
    expect(draft?.confidence).toBe(0.45); // judged 0.9, halved because programme.txt is newer
    expect(draft?.reason).toContain("Older version of the file: programme.txt is newer");
  });

  it("combines a spreadsheet, a calendar and documents in one answer", async () => {
    const a = await ask("When do I travel, where do I stay, and when is my talk?", await sample());
    const sources = new Set(a.points.flatMap((p) => p.sources.map((s) => s.source)));
    expect(sources).toEqual(new Set(["travel_bookings.csv", "programme.txt", "calendar.ics", "programme_draft.txt", "slides_notes.txt"]));
    expect(a.points.filter((p) => p.label === "confirmed").map((p) => p.statement).join(" ")).toContain("Sample Guest House");
    expect(a.points.some((p) => p.label === "conflict" && p.statement.includes("4 December"))).toBe(true);
  });

  it("refuses to confirm hearsay: the dinner date is not proven after a retry", async () => {
    const a = await ask("When is the conference dinner?", await sample());
    expect(a.points).toHaveLength(0);
    expect(a.unproven[0]?.statement).toContain("dinner");
    expect(a.trace.map((t) => t.action)).toEqual(expect.arrayContaining(["reject", "send back", "gave up"]));
  });

  it("remembers verified findings for the next question (H-MEM)", async () => {
    const memory = await freshMemory();
    await ask("When exactly is my talk?", { ...(await sample()), memory });
    const second = await ask("When exactly is my talk?", { ...(await sample()), memory });
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
    const a = await ask("How long is my talk?", { brain, store: new LocalEvidenceStore(await loadEvidence(SAMPLES)), memory: await freshMemory() });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("was not found word for word");
    expect(a.points[0]?.label).toBe("confirmed");
    expect(a.trace.some((t) => t.action === "reject (code check)")).toBe(true);
  });
});

describe("grouping claims about the same thing", () => {
  it("gives one name to one thing, and keeps different things apart", () => {
    const names = unifySubjects(["The DBMS internal exam", "DBMS exam", "Database Management Systems - DBMS (IT 312) exam",
      "Computer Networks (IT 311) exam", "bus to Kathmandu", "bus back to Pokhara", "my talk", "my talk (paper #508)", "keynote talk"]);
    expect(names.get("The DBMS internal exam")).toBe("DBMS exam");
    expect(names.get("Database Management Systems - DBMS (IT 312) exam")).toBe("DBMS exam");
    expect(names.get("Computer Networks (IT 311) exam")).toBe("Computer Networks (IT 311) exam");
    expect(names.get("bus back to Pokhara")).toBe("bus back to Pokhara");
    expect(names.get("my talk (paper #508)")).toBe("my talk");
    expect(names.get("keynote talk")).toBe("keynote talk");
  });

  it("treats a longer value as agreeing with a shorter one", () => {
    expect(sameValue("4 December 2026 at 10:30", "4 December")).toBe(true);
    expect(sameValue("3 December 2026", "13 December 2026")).toBe(false);
  });
});

describe("live steps", () => {
  it("streams every trace step as it happens, in the same order as the final trace", async () => {
    const streamed: unknown[] = [];
    const a = await ask("When is the conference dinner?", { ...(await sample()), onTrace: (m) => { if (m.type === "step") streamed.push(m.event); } });
    expect(streamed.length).toBeGreaterThan(5);
    expect(streamed).toEqual(a.trace);
    expect(a.trace.some((t) => t.action === "send back")).toBe(true);
  });
});

describe("points that rest on a discredited file", () => {
  it("moves a point to not proven when its only source lost a disagreement about the same thing", () => {
    const ev = (source: string) => ({ id: `${source}#1`, source, kind: "file" as const, text: "" });
    const acc = (statement: string, subject: string, source: string) =>
      ({ ok: true as const, claim: { id: statement, subQuestionId: "s1", statement, quote: "", evidenceId: `${source}#1`, subject }, evidence: ev(source), confidence: 0.5, reason: "" });
    const accepted = [acc("Starts on 5 Jan", "internship", "v2.pdf"), acc("Starts at 09:00 on 15 Dec", "internship", "calendar.ics")];
    const points = [
      { statement: "Starts on 5 Jan", label: "conflict" as const, sources: [{ source: "v2.pdf", quote: "", confidence: 0.9, reason: "", kept: true }, { source: "calendar.ics", quote: "", confidence: 0.5, reason: "", kept: false }] },
      { statement: "Starts at 09:00 on 15 Dec", label: "confirmed" as const, sources: [{ source: "calendar.ics", quote: "", confidence: 0.5, reason: "" }] },
    ];
    const r = dropDiscredited(accepted, points);
    expect(r.points.map((p) => p.statement)).toEqual(["Starts on 5 Jan"]);
    expect(r.notProven[0]?.statement).toBe("Starts at 09:00 on 15 Dec");
  });
});
