// Trace: records every agent step and every model receipt, so anyone can see how an answer was reached
// and which model handled each request. Saved as JSONL under .proofloop/traces/ and shown in the UI.

import fs from "node:fs";
import path from "node:path";
import { config } from "../config.ts";
import type { TraceEvent } from "../types.ts";
import type { ModelReceipt } from "../sponsors/nightshift.ts";

/**
 * Live view of a run, for streaming to the page: "step" is a recorded event (the same object that ends up in
 * the trace); "pending" is sent just before a model call or Zetaris query starts, so the page can show what is
 * running now. Pending signals are not recorded.
 */
export type TraceMessage =
  | { type: "step"; event: TraceEvent }
  | { type: "pending"; agent: TraceEvent["agent"]; action: string };
export type TraceListener = (message: TraceMessage) => void;

export class Trace {
  readonly events: TraceEvent[] = [];
  readonly runId = new Date().toISOString().replace(/[:.]/g, "-");

  constructor(private readonly listener?: TraceListener) {}

  add(agent: TraceEvent["agent"], action: string, detail?: string, receipt?: ModelReceipt): void {
    const event: TraceEvent = {
      at: new Date().toISOString(),
      agent,
      action,
      detail,
      model: receipt && {
        requested: receipt.requestedModel,
        served: receipt.servedModel,
        routed: receipt.routedModel,
        receiptId: receipt.receiptId,
        ms: receipt.ms,
      },
    };
    this.events.push(event);
    this.listener?.({ type: "step", event });
  }

  /** Announces a slow step that is starting (a model call or a Zetaris query). */
  pending(agent: TraceEvent["agent"], action: string): void {
    this.listener?.({ type: "pending", agent, action });
  }

  /** Writes the trace to .proofloop/traces/<run>.jsonl and returns the file path. */
  save(): string {
    const dir = path.join(config.stateDir, "traces");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${this.runId}.jsonl`);
    fs.writeFileSync(file, this.events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    return file;
  }
}
