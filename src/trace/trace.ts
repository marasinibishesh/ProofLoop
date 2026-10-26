// Trace: records every agent step and every model receipt, so anyone can see how an answer was reached
// and which model handled each request. Saved as JSONL under .proofloop/traces/ and shown in the UI.

import fs from "node:fs";
import path from "node:path";
import { config } from "../config.ts";
import type { TraceEvent } from "../types.ts";
import type { ModelReceipt } from "../sponsors/nightshift.ts";

export class Trace {
  readonly events: TraceEvent[] = [];
  readonly runId = new Date().toISOString().replace(/[:.]/g, "-");

  add(agent: TraceEvent["agent"], action: string, detail?: string, receipt?: ModelReceipt): void {
    this.events.push({
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
    });
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
