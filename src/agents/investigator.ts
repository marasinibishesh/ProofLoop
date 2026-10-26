// Investigator agent: for one sub-question, searches the evidence store (Zetaris in live mode) and
// drafts claims, each tied to an exact quote from one evidence chunk.

import type { EvidenceStore } from "../data/evidenceStore.ts";
import { keywords } from "../data/evidenceStore.ts";
import type { Trace } from "../trace/trace.ts";
import type { Claim, Evidence, SubQuestion } from "../types.ts";
import type { Brain } from "./brain.ts";
import { quoteFound } from "./evaluator.ts";

export type Investigation = { claims: Claim[]; evidence: Map<string, Evidence> };

let claimCounter = 0;

export async function investigate(brain: Brain, store: EvidenceStore, question: string, sub: SubQuestion, trace: Trace, hint?: string): Promise<Investigation> {
  const terms = keywords(`${sub.text} ${question}`);
  const found = await store.search(terms, 6);
  trace.add("investigator", hint ? "search (retry)" : "search", `${sub.id}: ${found.length} chunks from ${store.name} for [${terms.join(", ")}]`);

  const drafts = await brain.investigate(question, sub, found, hint);
  const evidence = new Map(found.map((e) => [e.id, e]));
  const claims: Claim[] = [];
  for (const d of drafts) {
    // Use the chunk the model named; otherwise find the chunk in its source that holds the quote.
    let ev = d.evidenceId ? evidence.get(d.evidenceId) : undefined;
    if (!ev && d.source) ev = (await store.bySource(d.source)).find((e) => quoteFound(d.quote, e.text));
    if (ev) evidence.set(ev.id, ev);
    claims.push({ ...d, id: `c${++claimCounter}`, subQuestionId: sub.id, evidenceId: ev?.id ?? d.evidenceId ?? "" });
  }
  trace.add("investigator", "claims", `${sub.id}: ${claims.length} claim(s)` + (claims.length ? `: ${claims.map((c) => c.statement).join(" | ")}` : ""));
  return { claims, evidence };
}
