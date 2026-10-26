// Planner agent: splits the user's question into sub-questions, using what H-MEM already verified
// so it doesn't re-ask settled things.

import type { Trace } from "../trace/trace.ts";
import type { SubQuestion } from "../types.ts";
import type { Brain } from "./brain.ts";

export async function plan(brain: Brain, question: string, memory: string[], trace: Trace): Promise<SubQuestion[]> {
  const subs = await brain.plan(question, memory);
  trace.add("planner", "plan", subs.map((s) => `${s.id}: ${s.text}`).join(" | "));
  return subs.length ? subs : [{ id: "s1", text: question }];
}
