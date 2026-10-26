// The agent loop:
//   memory recall (H-MEM) -> plan (planner) -> for each sub-question:
//     investigate (Zetaris evidence) -> evaluate each claim -> weak claims go back with a reason (max 2 retries)
//   -> accepted claims become World Model facts (conflict policy picks winners)
//   -> verified and rejected findings are written to H-MEM -> answer.
// Every step lands in the trace, including which model answered.

import { config, live } from "../config.ts";
import { loadEvidence } from "../data/ingest.ts";
import { LocalEvidenceStore, ZetarisEvidenceStore, type EvidenceStore } from "../data/evidenceStore.ts";
import { openMemory, type HMEMInstance } from "../sponsors/hmem.ts";
import { openWorld } from "../sponsors/worldModel.ts";
import { Trace } from "../trace/trace.ts";
import type { Answer, Claim } from "../types.ts";
import { buildPoints, type FactOutcome } from "./answer.ts";
import { NemotronBrain, SampleBrain, type Brain } from "./brain.ts";
import { review, type Review } from "./evaluator.ts";
import { investigate } from "./investigator.ts";
import { plan } from "./planner.ts";

export const MAX_RETRIES = 2;

/** voice: set when the question was spoken and transcribed by ElevenLabs (input only, no reasoning). */
export type Deps = { brain?: Brain; store?: EvidenceStore; memory?: HMEMInstance; voice?: { model: string; ms: number } };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9#]+/g, "-").replace(/^-|-$/g, "");
const sameClaim = (a: Claim, b: Claim) => a.statement.trim().toLowerCase() === b.statement.trim().toLowerCase();

export async function ask(question: string, deps: Deps = {}): Promise<Answer> {
  const started = Date.now();
  const trace = new Trace();
  const brain = deps.brain ?? (live.model ? new NemotronBrain(trace) : new SampleBrain());
  const store = deps.store ?? (live.data ? new ZetarisEvidenceStore(config.zetaris!.evidenceTable, trace) : new LocalEvidenceStore(await loadEvidence(config.docsDir)));
  const memory = deps.memory ?? (await openMemory());
  if (deps.voice) trace.add("voice", "transcribe", `spoken question transcribed by ElevenLabs ${deps.voice.model} in ${deps.voice.ms} ms (input only; reasoning below runs on ${brain.label})`);
  trace.add("planner", "start", `question: ${question} | model: ${brain.label} | data: ${store.name}`);

  // 1. What do we already know? (H-MEM)
  const recalled = recall(memory, question);
  trace.add("memory", "recall", recalled.length ? recalled.join(" | ") : "nothing relevant yet");

  // 2. Plan.
  const subs = await plan(brain, question, recalled, trace);

  // 3. Investigate + evaluate each sub-question, sending weak claims back.
  const accepted: Extract<Review, { ok: true }>[] = [];
  const rejected: Extract<Review, { ok: false }>[] = [];
  for (const sub of subs) {
    let hint: string | undefined;
    // Failures from the latest attempt that produced claims. If a retry finds nothing better,
    // these are what we report as "not proven"; if a retry succeeds, they are replaced.
    let lastFailures: Extract<Review, { ok: false }>[] = [];
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const { claims, evidence } = await investigate(brain, store, question, sub, trace, hint);
      if (claims.length === 0) {
        if (attempt > 0) trace.add("investigator", "gave up", `${sub.id}: no better evidence found after the evaluator's feedback`);
        break;
      }
      const failures: Extract<Review, { ok: false }>[] = [];
      for (const claim of claims) {
        if (accepted.some((a) => sameClaim(a.claim, claim))) continue;
        const r = await review(brain, claim, evidence.get(claim.evidenceId), trace);
        if (r.ok) accepted.push(r);
        else failures.push(r);
      }
      lastFailures = failures;
      if (failures.length === 0 || attempt === MAX_RETRIES) break;
      hint = failures.map((f) => f.retryHint).join(" ");
      trace.add("evaluator", "send back", `${sub.id}: ${failures.length} claim(s) sent back to the investigator`);
    }
    rejected.push(...lastFailures);
  }
  const unproven = rejected.filter((r) => !accepted.some((a) => sameClaim(a.claim, r.claim)));

  // 4. World Model: every accepted claim becomes a fact with provenance; conflicts are refereed.
  const world = await openWorld({ namespace: `run-${trace.runId}`, conflictPolicy: "highest-confidence-wins" });
  const factIds = new Map<string, string>();
  for (const a of accepted) {
    if (!a.claim.subject || !a.claim.predicate || !a.claim.value) continue;
    const fact = await world.assertFact({
      about: `topic:${slug(a.claim.subject)}`,
      predicate: slug(a.claim.predicate),
      value: a.claim.value,
      confidence: a.confidence,
      source: { kind: "file", by: "proofloop-evaluator", url: a.evidence.source, at: new Date().toISOString() },
    });
    factIds.set(a.claim.id, fact.id);
  }
  const outcomes: FactOutcome[] = [];
  for (const [claimId, factId] of factIds) {
    const about = accepted.find((a) => a.claim.id === claimId)!.claim.subject!;
    const fact = world.view("facts").about(`topic:${slug(about)}`).find((f: { id: string }) => f.id === factId);
    outcomes.push({ claimId, kept: !fact?.supersededBy });
  }
  const conflicts = outcomes.filter((o) => !o.kept).length;
  trace.add("world-model", "facts", `${factIds.size} fact(s) asserted; ${conflicts} superseded by the conflict policy`);

  // 5. H-MEM: remember what was proven, what lost a conflict and what was rejected, together with the
  //    question it answered, so a similar question later recalls it and dead ends aren't repeated.
  const lostIds = new Set(outcomes.filter((o) => !o.kept).map((o) => o.claimId));
  const asked = `asked: "${question}"`;
  for (const a of accepted) {
    const status = lostIds.has(a.claim.id) ? "Superseded by a more reliable source" : "Verified";
    remember(memory, `${status}: ${a.claim.statement} (source: ${a.evidence.source}; ${asked})`);
  }
  for (const r of unproven) remember(memory, `Not proven: ${r.claim.statement} (${r.reason}; ${asked})`);
  trace.add("memory", "store", `${accepted.length - lostIds.size} verified, ${lostIds.size} superseded, ${unproven.length} not proven`);

  const points = buildPoints(accepted, outcomes);
  trace.add("answer", "done", `${points.length} point(s), ${unproven.length} not proven, in ${Date.now() - started} ms`);
  trace.save();
  return {
    question,
    subQuestions: subs,
    points,
    unproven: unproven.map((r) => ({ statement: r.claim.statement, source: r.claim.evidenceId.split("#")[0] || undefined, reason: r.reason })),
    memory: recalled,
    trace: trace.events,
    mode: { model: brain.label, data: store.name },
    ms: Date.now() - started,
  };
}

/**
 * Memories relevant to the question. H-MEM's reference retrieval is lexical, so scores are close together;
 * we keep only memories near the best match, and only when the best match is clearly relevant.
 */
function recall(memory: HMEMInstance, question: string): string[] {
  const hits = memory.query(question, { topN: 8, threshold: 0 }).memories;
  const best = hits[0]?.relevance ?? 0;
  if (best < 0.3) return [];
  return hits.filter((h) => h.relevance >= best * 0.85).slice(0, 4).map((h) => h.memory.content);
}

/** Adds a memory unless the same text is already stored. */
function remember(memory: HMEMInstance, content: string): void {
  const existing = memory.query(content, { topN: 1, threshold: 0.5 }).memories[0];
  if (existing?.memory.content === content) return;
  memory.add({ content, type: "general", source: "proofloop" });
}
