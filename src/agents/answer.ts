// Builds the final answer. Claims about the same thing (same subject + predicate) with different values
// are a conflict: the World Model's policy decides which one is kept, and both sides are shown with reasons.

import type { Answer, Cite, Label } from "../types.ts";
import type { Review } from "./evaluator.ts";

type Accepted = Extract<Review, { ok: true }>;
export type FactOutcome = { claimId: string; kept: boolean };

const pct = (n: number) => `${Math.round(n * 100)}%`;
const key = (a: Accepted) => `${(a.claim.subject ?? "").toLowerCase().trim()}|${(a.claim.predicate ?? "").toLowerCase().trim()}`;
const cite = (a: Accepted, kept?: boolean): Cite => ({ source: a.evidence.source, quote: a.claim.quote, confidence: a.confidence, reason: a.reason, kept });

export function buildPoints(accepted: Accepted[], outcomes: FactOutcome[]): Answer["points"] {
  const keptById = new Map(outcomes.map((o) => [o.claimId, o.kept]));
  const groups = new Map<string, Accepted[]>();
  for (const a of accepted) {
    const k = a.claim.subject && a.claim.predicate ? key(a) : `solo|${a.claim.id}`;
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }

  const points: Answer["points"] = [];
  for (const group of groups.values()) {
    const values = new Set(group.map((a) => (a.claim.value ?? "").toLowerCase().trim()));
    if (group.length > 1 && values.size > 1) {
      // Conflict: the World Model kept one value; the others were superseded.
      const winner = group.find((a) => keptById.get(a.claim.id) !== false) ?? group[0];
      const losers = group.filter((a) => a !== winner);
      points.push({
        statement: winner.claim.statement,
        label: "conflict" as Label,
        sources: [cite(winner, true), ...losers.map((l) => cite(l, false))],
        // Each source's reason is shown under its quote, so the note only names the decision.
        note: `${group.length} sources disagree. Kept ${winner.evidence.source} (${pct(winner.confidence)}) over ` +
          losers.map((l) => `${l.evidence.source} (${pct(l.confidence)})`).join(", ") + ".",
      });
    } else {
      // Same value from one or more sources: confirmed, citing every source.
      const best = [...group].sort((a, b) => b.confidence - a.confidence)[0];
      points.push({ statement: best.claim.statement, label: "confirmed", sources: group.map((a) => cite(a)) });
    }
  }
  return points;
}
