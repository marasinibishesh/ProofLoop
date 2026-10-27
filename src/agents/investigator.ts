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

const MONTHS = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*$/;
const NON_ANSWER = /\b(not (mentioned|stated|given|specified|listed|included)|(does|do) not (mention|say|state|give|specify)|(will|to) be announced)\b/i;

/**
 * Keeps the best `limit` chunks (already ranked), at most `perSource` from one file, so a long file
 * (e.g. a letter with many matching chunks) cannot crowd out a short one that holds the answer.
 */
export function spread(ranked: Evidence[], limit: number, perSource = 2): Evidence[] {
  const count = new Map<string, number>();
  return ranked.filter((e) => {
    const n = count.get(e.source) ?? 0;
    count.set(e.source, n + 1);
    return n < perSource;
  }).slice(0, limit);
}

export async function investigate(brain: Brain, store: EvidenceStore, question: string, sub: SubQuestion, trace: Trace, hint?: string, subjects?: string[]): Promise<Investigation> {
  // The planner's search terms are the words the documents use; without them, fall back to the question's words.
  // Dates and times (e.g. from memory) are dropped: they would steer the search toward one answer. References (#508) stay.
  const terms = keywords(sub.terms?.length ? `${sub.text} ${sub.terms.join(" ")}` : `${sub.text} ${question}`)
    .filter((t) => t.startsWith("#") || !(/\d/.test(t) || MONTHS.test(t)));
  const found = spread(await store.search(terms, 20), 6);
  trace.add("investigator", hint ? "search (retry)" : "search", `${sub.id}: ${found.length} chunks from ${store.name} for [${terms.join(", ")}]`);

  // Follow references: a number like "Paper #508" or "Booking #77" in the best matches also finds documents
  // that name the same thing in other words (e.g. a programme entry that never says "talk").
  const refs = [...new Set(found.slice(0, 3).flatMap((e) => e.text.toLowerCase().match(/#\w+/g) ?? []))].slice(0, 3);
  if (refs.length) {
    const seen = new Set(found.map((e) => e.id));
    const extra = spread([...found, ...(await store.search(refs, 20)).filter((e) => !seen.has(e.id))], 10).slice(found.length);
    found.push(...extra);
    trace.add("investigator", "follow references", `${sub.id}: ${extra.length} more chunks for [${refs.join(", ")}]`);
  }

  // A sentence about what a document does NOT say ("not mentioned", "will be announced") answers nothing; drop it.
  // Hearsay ("someone said", "not confirmed") is kept: the evaluator must see it to reject it.
  const drafts = (await brain.investigate(question, sub, found, hint, subjects))
    .filter((d) => !NON_ANSWER.test(d.statement));
  const evidence = new Map(found.map((e) => [e.id, e]));
  const claims: Claim[] = [];
  for (const d of drafts) {
    // If the quote names the thing by a reference ("Paper #508") that another found document ties to the claim's
    // subject ("ICAAD talk - Paper #508"), say so in the statement, so the evaluator can see what the quote is about.
    const subjectWords = keywords(d.subject ?? "");
    for (const ref of d.quote.match(/\b[A-Za-z]+ #\w+|#\w+/g) ?? []) {
      const id = ref.slice(ref.indexOf("#")).toLowerCase();
      const linked = found.some((e) => e.text.toLowerCase().includes(id) && subjectWords.some((w) => e.text.toLowerCase().includes(w)));
      if (linked && !d.statement.toLowerCase().includes(id)) d.statement = `${d.statement.replace(/\.$/, "")} (${ref}).`;
    }
    // Use the chunk the model named; otherwise find the chunk in its source that holds the quote.
    let ev = d.evidenceId ? evidence.get(d.evidenceId) : undefined;
    if (!ev && d.source) ev = (await store.bySource(d.source)).find((e) => quoteFound(d.quote, e.text));
    if (ev) evidence.set(ev.id, ev);
    claims.push({ ...d, id: `c${++claimCounter}`, subQuestionId: sub.id, evidenceId: ev?.id ?? d.evidenceId ?? "" });
  }
  trace.add("investigator", "claims", `${sub.id}: ${claims.length} claim(s)` + (claims.length ? `: ${claims.map((c) => c.statement).join(" | ")}` : ""));
  return { claims, evidence };
}
