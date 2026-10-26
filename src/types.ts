// Shared types for the agent loop.

/** A piece of evidence found in a source (a document chunk, a note, a web page). */
export type Evidence = {
  id: string;            // e.g. "programme.txt#3"
  source: string;        // path inside the documents folder, e.g. "conference/programme.pdf"
  kind: "file" | "note" | "pdf" | "table" | "calendar" | "web";
  text: string;          // the chunk text
  newerVersion?: string; // set when this file is an older version of another file
};

/** A sub-question the planner wants answered. */
export type SubQuestion = { id: string; text: string };

/** A claim drafted by the investigator, always tied to a quote from one piece of evidence. */
export type Claim = {
  id: string;
  subQuestionId: string;
  statement: string;     // "The talk is on 4 December"
  quote: string;         // exact words from the evidence
  evidenceId: string;
  subject?: string;      // what the claim is about, for the World Model (e.g. "talk")
  predicate?: string;    // which property (e.g. "date")
  value?: string;        // the value (e.g. "4 December")
};

export type Label = "confirmed" | "conflict" | "not-proven";

/** The evaluator's decision about one claim. */
export type Verdict = {
  claimId: string;
  label: Label;
  reason: string;        // why it was accepted, rejected, or sent back
  retry?: string;        // instruction for the investigator when sent back
};

/** One line of the trace: what an agent did, and which model answered. */
export type TraceEvent = {
  at: string;
  agent: "planner" | "investigator" | "evaluator" | "world-model" | "memory" | "zetaris" | "answer" | "voice";
  action: string;
  detail?: string;
  model?: { requested: string; served: string; routed?: string; receiptId?: string; ms: number };
};

/** One cited source behind a point. `kept: false` = superseded in a conflict. */
export type Cite = { source: string; quote: string; confidence: number; reason: string; kept?: boolean };

/** What the user gets back. */
export type Answer = {
  question: string;
  subQuestions: SubQuestion[];
  points: { statement: string; label: Label; sources: Cite[]; note?: string }[];
  unproven: { statement: string; source?: string; reason: string }[];
  memory: string[];        // what H-MEM already knew before this run
  trace: TraceEvent[];
  mode: { model: string; data: string };
  ms: number;
};
