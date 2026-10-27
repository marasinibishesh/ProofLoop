// Zetaris: the data layer. Proofloop writes its document chunks as CSV tables that Zetaris reads,
// and every agent searches evidence through Zetaris Lightning SQL over the REST API.
// Request shape (bearer API key + org id + request id) follows the Zetaris KB and the official
// getting-started repo; verify against your own install.

import { randomUUID } from "node:crypto";
import { config } from "../config.ts";

export type SqlResult = { columns: string[]; rows: unknown[][]; queryId: string; ms: number };

/** Runs one Lightning SQL statement. */
export async function sql(statement: string, limit = 100): Promise<SqlResult> {
  if (!config.zetaris) throw new Error("Zetaris is not configured (set ZETARIS_REST_URL, ZETARIS_ORG_ID, ZETARIS_API_KEY)");
  const queryId = randomUUID();
  const started = Date.now();
  const res = await fetch(`${config.zetaris.restUrl}/sql-editor/sqls/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.zetaris.apiKey}`,
      "X-Org-ID": config.zetaris.orgId,
      "X-Request-ID": queryId,
    },
    body: JSON.stringify({ queryId, sql: statement, source: "SqlEditor", limit }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Zetaris ${res.status}: ${(await res.text()).slice(0, 300)}`);
  // The local platform returns headers as plain column names; older docs show { name } objects.
  const body = (await res.json()) as { headers?: (string | { name: string })[]; data?: unknown[][] };
  const columns = (body.headers ?? []).map((h) => (typeof h === "string" ? h : h.name));
  return { columns, rows: body.data ?? [], queryId, ms: Date.now() - started };
}

/** Escapes a value for use inside a single-quoted SQL string literal. */
export const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
