# Sponsor technology in Proofloop

*Required submission section. Each sponsor does real work in the running app; this page says where, and how
to verify it. Items marked TODO are filled in as they are built.*

## Zetaris: the data layer
- **How it's integrated:** documents and notes are split into chunks and written as CSV tables
  (`evidence`: id, source, kind, chunk_no, text) into the folder Zetaris reads; they are registered with
  `CREATE LIGHTNING FILESTORE TABLE`. The investigator agent searches evidence only through Lightning SQL
  over the Zetaris REST API (`src/sponsors/zetaris.ts`).
- **Verify:** `npm run check` runs `SELECT 1`; the trace shows every SQL query an agent ran. TODO: demo query.

## Meterless Nightshift: the primary AI provider
- **How the app connects:** the `openai` client points at Nightshift's OpenAI-compatible endpoint with the
  runtime token and `meterless-app` / `meterless-scope` headers (`src/sponsors/nightshift.ts`). Every model
  call in Proofloop goes through it; there is no other AI provider.
- **Model:** pinned to `nvidia/nemotron-3.5-lightning-30b-a3b` (not `meterless/auto`, which can re-route).
- **Verify:** each response's routing receipt (`served model`, `routed_model`, `receipt_id`) is logged in the
  trace for every agent step.

## Meterless Engines
### World Model: the evidence graph and conflict resolution
- **What it does here:** every accepted claim is asserted as a fact with provenance (file + quote). When
  two sources disagree (slides say 3 December, programme says 4 December), the engine's conflict policy keeps
  the more trusted fact, marks the other as superseded, and logs why. The answer shows both sides.
- **Test:** `tests/engines.test.ts` → "detects conflicting dates from two sources and keeps the more trusted one".

### H-MEM: memory across runs
- **What it does here:** verified findings and rejected guesses are stored with their source; the planner
  recalls them so follow-up questions build on earlier work; every memory has an audit ledger.
- **Test:** `tests/engines.test.ts` → "remembers a verified finding and recalls it with provenance".

## NVIDIA Nemotron (through Nightshift)
- **Where it contributes:** the planner, investigator and evaluator agents all run on Nemotron through
  Nightshift. The trace shows which model handled each request.

## What was unique about our use of the sponsor technology
TODO: fill in after the build. Draft: the World Model's conflict policy is used as an explainable referee
between contradicting sources, and H-MEM remembers both what was proven and what was rejected, so the agent
doesn't repeat a dead end.
