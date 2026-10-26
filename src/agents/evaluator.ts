// Evaluator agent: checks every claim before it can reach the user.
//   1. In code: is the quote really in the evidence chunk? (No model can talk its way past this.)
//   2. With the model: does the quote really support the claim, and how reliable is the source?
//   3. In code again: evidence from an older version of a file counts half, so the newest version wins.
// A failed check sends the claim back to the investigator with a reason.

import type { Trace } from "../trace/trace.ts";
import type { Claim, Evidence } from "../types.ts";
import type { Brain } from "./brain.ts";

const norm = (s: string) =>
  s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().replace(/^["'`]+|["'`.]+$/g, "");

/** True when the quote appears in the text (case, curly quotes and whitespace ignored). */
export function quoteFound(quote: string, text: string): boolean {
  const q = norm(quote);
  return q.length >= 8 && norm(text).includes(q);
}

/** Confidence multiplier for evidence from a file that has a newer version. */
export const OLDER_VERSION_FACTOR = 0.5;

export type Review =
  | { ok: true; claim: Claim; evidence: Evidence; confidence: number; reason: string }
  | { ok: false; claim: Claim; reason: string; retryHint: string };

export async function review(brain: Brain, claim: Claim, evidence: Evidence | undefined, trace: Trace): Promise<Review> {
  if (!evidence || !quoteFound(claim.quote, evidence.text)) {
    const reason = evidence ? `quote not found in ${evidence.source}` : "the cited evidence does not exist";
    trace.add("evaluator", "reject (code check)", `${claim.statement} → ${reason}`);
    return { ok: false, claim, reason, retryHint: `Your quote "${claim.quote}" was not found word for word in the evidence. Copy the exact words, or return no claim.` };
  }
  const j = await brain.judge(claim, evidence);
  if (!j.supported) {
    trace.add("evaluator", "reject", `${claim.statement} → ${j.reason}`);
    return { ok: false, claim, reason: j.reason, retryHint: `"${claim.statement}" is not supported well enough: ${j.reason} Find stronger evidence, or return no claim.` };
  }
  let { confidence, reason } = j;
  if (evidence.newerVersion) {
    confidence = Math.round(confidence * OLDER_VERSION_FACTOR * 100) / 100;
    reason = `${reason} Older version of the file: ${evidence.newerVersion} is newer, so confidence was halved.`;
  }
  trace.add("evaluator", "accept", `${claim.statement} (confidence ${confidence.toFixed(2)}) → ${reason}`);
  return { ok: true, claim, evidence, confidence, reason };
}
