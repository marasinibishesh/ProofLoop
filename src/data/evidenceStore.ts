// Where agents look for evidence. Live mode: Zetaris (Lightning SQL over the evidence table).
// Sample mode: the same chunks held in memory. Both answer the same two questions:
// "which chunks match these words?" and "give me this source's chunks".

import type { Evidence } from "../types.ts";
import { quote, sql } from "../sponsors/zetaris.ts";
import type { Trace } from "../trace/trace.ts";

export interface EvidenceStore {
  readonly name: string;
  search(terms: string[], limit?: number): Promise<Evidence[]>;
  bySource(source: string): Promise<Evidence[]>;
}

// Includes generic words (date, time, schedule...) that appear in nearly every document and would crowd out the answer.
const STOP = new Set(("a an and are at be by did do does for from how i in is it its me my of on or the this to was what when where which who why will with you your before after need exactly " +
  "date dates time times schedule scheduled day").split(" "));

/** Lower-case content words of a question, for searching. */
export function keywords(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[a-z0-9#]+/g) ?? [])].filter((w) => w.length > 2 && !STOP.has(w));
}

export class LocalEvidenceStore implements EvidenceStore {
  readonly name = "local (sample mode)";
  constructor(private readonly evidence: Evidence[]) {}

  async search(terms: string[], limit = 5): Promise<Evidence[]> {
    return this.evidence
      .map((e) => ({ e, score: terms.filter((t) => e.text.toLowerCase().includes(t)).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.e);
  }

  async bySource(source: string): Promise<Evidence[]> {
    return this.evidence.filter((e) => e.source === source);
  }
}

/** Evidence searched through Zetaris. `table` is the registered evidence table, e.g. PROOFLOOP.evidence. */
export class ZetarisEvidenceStore implements EvidenceStore {
  readonly name = "Zetaris";
  constructor(private readonly table: string, private readonly trace?: Trace) {}

  private async run(statement: string, limit: number): Promise<Evidence[]> {
    this.trace?.pending("zetaris", "query");
    const r = await sql(statement, limit);
    this.trace?.add("zetaris", "query", `${statement} -> ${r.rows.length} rows in ${r.ms} ms`);
    const col = (name: string) => r.columns.findIndex((c) => c.toLowerCase() === name);
    const [id, source, kind, text, newer] = ["id", "source", "kind", "text", "newer_version"].map(col);
    return r.rows.map((row) => ({
      id: String(row[id]),
      source: String(row[source]),
      kind: String(row[kind]) as Evidence["kind"],
      text: String(row[text]),
      ...(newer >= 0 && row[newer] ? { newerVersion: String(row[newer]) } : {}),
    }));
  }

  async search(terms: string[], limit = 5): Promise<Evidence[]> {
    if (terms.length === 0) return [];
    const where = terms.map((t) => `lower(text) LIKE ${quote(`%${t}%`)}`).join(" OR ");
    const score = terms.map((t) => `CASE WHEN lower(text) LIKE ${quote(`%${t}%`)} THEN 1 ELSE 0 END`).join(" + ");
    return this.run(`SELECT id, source, kind, newer_version, text, (${score}) AS score FROM ${this.table} WHERE ${where} ORDER BY score DESC LIMIT ${limit}`, limit);
  }

  async bySource(source: string): Promise<Evidence[]> {
    return this.run(`SELECT id, source, kind, newer_version, text FROM ${this.table} WHERE source = ${quote(source)}`, 200);
  }
}
