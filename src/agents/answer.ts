// Builds the final answer. Claims about the same thing (same subject + predicate) with different values
// are a conflict: the World Model's policy decides which one is kept, and both sides are shown with reasons.

import type { Answer, Cite, Label } from "../types.ts";
import type { Review } from "./evaluator.ts";

type Accepted = Extract<Review, { ok: true }>;
export type FactOutcome = { claimId: string; kept: boolean };

const pct = (n: number) => `${Math.round(n * 100)}%`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9#]+/g, "-").replace(/^-|-$/g, "");
/** "my talk (paper #508)" and "my talk" are the same subject. */
export const subjectKey = (s: string) => slug(s.replace(/\(.*?\)/g, " "));
/**
 * Gives one name to subjects that are clearly the same thing, e.g. "DBMS internal exam", "DBMS exam" and
 * "Database Management Systems - DBMS (IT 312) exam": same last word, and one name's words contain the other's or
 * both share a code (an all-capitals word like "DBMS" or a reference like "#508"). "bus to Kathmandu" and
 * "bus back to Pokhara" stay apart. Returns original subject -> shared name (the shortest).
 */
export function unifySubjects(subjects: string[]): Map<string, string> {
  const info = [...new Set(subjects)].map((s) => {
    const words = s.replace(/\(.*?\)/g, " ").toLowerCase().replace(/[^a-z0-9#]+/g, " ").trim().split(" ")
      .filter((w) => w && !["the", "my", "a", "an", "of", "for", "to"].includes(w));
    const codes = new Set((s.match(/\b[A-Z]{3,}[A-Z0-9]*\b|#\w+/g) ?? []).map((c) => c.toLowerCase()));
    return { s, words, codes, head: words[words.length - 1] };
  });
  // A one-word name ("talk") only contains another name if they are equal, so "my talk" and "keynote talk" stay apart.
  const within = (a: string[], b: string[]) => a.every((w) => b.includes(w)) && (a.length >= 2 || a.length === b.length);
  const same = (a: (typeof info)[0], b: (typeof info)[0]) => a.head === b.head && (
    within(a.words, b.words) || within(b.words, a.words) || [...a.codes].some((c) => b.codes.has(c)));
  // Group with a small union-find, then name each group after its shortest member.
  const parent = info.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (let i = 0; i < info.length; i++) for (let j = i + 1; j < info.length; j++) if (same(info[i], info[j])) parent[root(i)] = root(j);
  const name = new Map<number, string>();
  info.forEach((x, i) => { const r = root(i); if (!name.has(r) || x.s.length < name.get(r)!.length) name.set(r, x.s); });
  return new Map(info.map((x, i) => [x.s, name.get(root(i))!]));
}

/** Different words for the same property ("location" / "venue", "start time" / "time"), so disagreeing sources meet. */
export const predicateKey = (p: string) => {
  const k = slug(p);
  if (/venue|location|place|room|hall/.test(k)) return "venue";
  // Only plain "when" predicates; "check-in date", "departure date" etc. stay as they are.
  if (/^(date|day|when|schedule|scheduled|scheduled-date|start-date|date-and-time|datetime|scheduled-for)$/.test(k)) return "date";
  if (/^(start|starts|starting|start-time|starts-at|starting-time|begins|time)$/.test(k)) return "time";
  return k;
};
const key = (a: Accepted) => `${subjectKey(a.claim.subject ?? "")}|${predicateKey(a.claim.predicate ?? "")}`;
const cite = (a: Accepted, kept?: boolean): Cite => ({ source: a.evidence.source, quote: a.claim.quote, confidence: a.confidence, reason: a.reason, kept });

const words = (v: string) => ` ${v.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(at|on|the)\b/g, " ").replace(/\s+/g, " ").trim()} `;
/** Two values agree when one says the same as, or more than, the other ("4 December" and "4 December 2026 at 10:30"). */
export const sameValue = (a: string, b: string) => words(a).includes(words(b)) || words(b).includes(words(a));

export function buildPoints(accepted: Accepted[], outcomes: FactOutcome[]): Answer["points"] {
  const keptById = new Map(outcomes.map((o) => [o.claimId, o.kept]));
  const groups = new Map<string, Accepted[]>();
  for (const a of accepted) {
    const k = a.claim.subject && a.claim.predicate ? key(a) : `solo|${a.claim.id}`;
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }

  const points: Answer["points"] = [];
  for (const group of groups.values()) {
    // The World Model kept one value; sources with a different value were superseded. Each source is listed once,
    // and only a different source with a different value is a disagreement.
    const winner = group.find((a) => keptById.get(a.claim.id) !== false) ?? group[0];
    const others = group.filter((a, i) => a.evidence.id !== winner.evidence.id &&
      group.findIndex((b) => b.evidence.id === a.evidence.id) === i);
    const agree = others.filter((a) => sameValue(a.claim.value ?? "", winner.claim.value ?? ""));
    const losers = others.filter((a) => !agree.includes(a));
    if (losers.length > 0) {
      points.push({
        statement: winner.claim.statement,
        label: "conflict" as Label,
        sources: [cite(winner, true), ...agree.map((a) => cite(a, true)), ...losers.map((l) => cite(l, false))],
        // Each source's reason is shown under its quote, so the note only names the decision.
        note: `${1 + agree.length + losers.length} sources disagree. Kept ${winner.evidence.source} (${pct(winner.confidence)}) over ` +
          losers.map((l) => `${l.evidence.source} (${pct(l.confidence)})`).join(", ") + ".",
      });
    } else {
      // Same value from one or more sources: confirmed, citing every source.
      const best = [...group].sort((a, b) => b.confidence - a.confidence)[0];
      // The same chunk cited twice (e.g. found by two sub-questions) is one source.
      const unique = group.filter((a, i) => group.findIndex((b) => b.evidence.id === a.evidence.id) === i);
      points.push({ statement: best.claim.statement, label: "confirmed", sources: unique.map((a) => cite(a)) });
    }
  }
  return points;
}

/**
 * A point that rests only on files which lost a disagreement about the same thing is not proof: e.g. "starts at
 * 09:00 on 15 December" from a calendar entry whose date was wrong. Such points move to "not proven".
 */
export function dropDiscredited(accepted: Accepted[], points: Answer["points"]): { points: Answer["points"]; notProven: Answer["unproven"] } {
  const subjectOf = new Map<string, string>();
  for (const a of accepted) if (a.claim.subject) subjectOf.set(a.claim.statement, subjectKey(a.claim.subject));
  const setAside = new Map<string, Set<string>>(); // subject -> files set aside for it
  for (const p of points) {
    const subject = subjectOf.get(p.statement);
    if (p.label !== "conflict" || !subject) continue;
    for (const c of p.sources) if (c.kept === false) setAside.set(subject, new Set([...(setAside.get(subject) ?? []), c.source]));
  }
  const kept: Answer["points"] = [];
  const notProven: Answer["unproven"] = [];
  for (const p of points) {
    const aside = setAside.get(subjectOf.get(p.statement) ?? "");
    if (p.label === "confirmed" && aside && p.sources.every((c) => aside.has(c.source))) {
      notProven.push({ statement: p.statement, source: p.sources[0]?.source, reason: `Only from ${[...new Set(p.sources.map((c) => c.source))].join(", ")}, which was set aside because a more trusted file disagrees about this.` });
    } else kept.push(p);
  }
  return { points: kept, notProven };
}
