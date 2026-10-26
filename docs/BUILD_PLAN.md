# Proofloop: build plan

**Open Agent Hackathon 2026 · Track 2: The Agent That Can Explain Why**
**Team:** Rajesh Khadka, Bishesh Marasini
**Deadline:** 27 October 2026, 23:45 UTC (28 October, 05:30 Nepal time). Aim to submit by the evening before.

---

## 1. What we are building (one paragraph)

**Proofloop answers questions about your own scattered information and proves every answer.** You ask
something like *"What do I need to do before the conference?"*. A team of agents digs through your
documents, notes and the web, connects what they find, checks every claim against its source, and returns
one clear answer where each point shows the exact quote it came from. When two sources disagree (the slides
say 3 December, the programme says 4 December), Proofloop shows both, says which one it trusts and why. If
something can't be proven, it says so instead of guessing.

Tagline: **"Proofloop doesn't answer until it can prove it."**

## 2. Who it is for and why it matters

- **Users:** students, researchers and anyone whose important information is buried across PDFs, notes,
  slides, emails and websites.
- **Problem:** the answer to "what do I need to do?" or "is this true?" is spread across many places. People
  either dig through everything by hand or ask a chatbot that answers confidently and sometimes invents things.
- **Value:** one answer you can actually check. Every claim links to its evidence, conflicts are surfaced,
  and unproven claims are labelled. That is exactly what Track 2 asks for: *investigate across multiple data
  sources, connect findings, produce evidence-backed answers.*

## 3. Demo scenario (what judges will see)

Sample data: a fictional student preparing for a conference.

| File | What's inside |
|---|---|
| `acceptance_letter.txt` | "Camera-ready paper due 20 November. Register by 15 November." |
| `programme.txt` | "Session B, 4 December, 10:30. Talk length: 15 minutes." |
| `slides_notes.txt` | "My talk is on 3 December." (conflicts with the programme) |
| `notes.md` | Personal notes: visa appointment, travel budget |
| web | the conference website (via search, optional) |

Questions that must always work:
1. *"What do I need to do before the conference, and by when?"*
2. *"When exactly is my talk?"* (conflict: 3 Dec vs 4 Dec, resolved with reasons)
3. *"How long is my talk and who said so?"*
4. One follow-up that uses memory: *"What did we already confirm?"*

## 4. How it works: the agent loop

```
question
   │
   ▼
Planner (Nemotron via Nightshift)      splits the question into sub-questions
   │
   ▼
Investigator (Nemotron via Nightshift) for each sub-question: searches the evidence
   │   ← evidence comes from Zetaris (document chunks, notes) and optionally the web
   ▼
Evaluator (Nemotron via Nightshift)    checks each claim: is the quote really in the source?
   │   weak / unproven claim ──► sent back to the Investigator (max 2 retries)
   ▼
World Model (Meterless engine)         stores claims as facts with provenance;
   │                                    detects conflicts and picks a winner by policy
   ▼
H-MEM (Meterless engine)               remembers verified findings + rejected guesses
   │
   ▼
Answer: every point with source, quote and label
        confirmed · conflict (both sources shown) · not proven
   │
   ▼
Trace: every agent step, every model call (requested model, routed model, receipt id)
```

This is a loop, not a straight pipeline: the evaluator can reject work and send it back, the planner
can add sub-questions, and memory changes what happens on the next run.

## 5. Sponsor technology: each one does real work

| Sponsor | Required? | Its job in Proofloop | Proof for judges |
|---|---|---|---|
| **Zetaris** | Yes, data layer | Documents and notes are split into chunks and written as CSV tables that Zetaris reads. Every agent searches evidence **through Zetaris Lightning SQL** (REST API). | Trace shows the SQL queries; demo shows evidence rows coming from Zetaris |
| **Meterless Nightshift** | Yes, primary AI provider | **Every** model call goes through Nightshift's OpenAI-compatible endpoint. Pinned model: `nvidia/nemotron-3.5-lightning-30b-a3b`. | Trace logs `requested_model`, `routed_model`, `receipt_id` for each call |
| **Meterless World Model** | Engine (≥1 required) | Evidence graph: claims are asserted as facts with provenance; built-in conflict policy marks superseded facts and logs why. | Conflict example in the demo + passing conformance/unit test |
| **Meterless H-MEM** | Engine | Memory across runs: verified findings and rejected hypotheses, with an audit ledger. | Second question uses memory; `audit` shows ledger history; passing test |
| **NVIDIA Nemotron** | Wherever it contributes | Planner, investigator and evaluator run on Nemotron through Nightshift. Competes for the DGX Spark prize. | Model id on every step in the trace |
| Cursor | Optional | Not required. | — |

**Rule:** no sponsor is mentioned without doing real work in the running app.

## 6. Tech stack and why

- **TypeScript on Node.js 20+.** The Meterless engines only exist as TypeScript reference code, and the
  official `agentathon-starter` is TypeScript. Using the same language avoids a fragile Python↔Node bridge.
- **Runs on Windows and macOS** (the demo is recorded on a MacBook). No platform-specific code; paths via
  `node:path`; start with `npm start` on both.
- **Local web UI** (`web/`): a single page served by our small Node server. Opens in Chrome, Safari or Edge.
- **Zetaris over REST** (`fetch`), **Nightshift over the `openai` npm client** (OpenAI-compatible).
- **Engines vendored** into `vendor/` by `npm run setup` (not committed), as the starter template does.
- **Tests:** `vitest`. CI on GitHub Actions for Windows and macOS.

## 7. Folder map

```
Proofloop/
├─ README.md                 setup, usage, dependencies, sponsor use, pre-existing components
├─ .env.example              placeholder values only (no real keys, ever)
├─ package.json / tsconfig.json
├─ docs/
│  ├─ BUILD_PLAN.md          this file
│  └─ SPONSORS.md            the required "sponsor technology explanation"
├─ scripts/
│  ├─ setup-engines.mjs      vendors H-MEM + World Model reference code into vendor/
│  └─ check-sponsors.ts      one test call to Nightshift, Zetaris and both engines (PASS/FAIL)
├─ src/
│  ├─ config.ts              reads .env; decides live mode vs sample mode
│  ├─ types.ts               shared types (Question, SubQuestion, Evidence, Claim, Verdict, TraceEvent)
│  ├─ server.ts              local web server: serves web/ and the /api/ask endpoint
│  ├─ agents/
│  │  ├─ orchestrator.ts     the loop: plan → investigate → evaluate → retry → answer
│  │  ├─ planner.ts          splits the question into sub-questions
│  │  ├─ investigator.ts     finds evidence and drafts claims with quotes
│  │  ├─ evaluator.ts        checks each claim against its source; accepts / rejects / sends back
│  │  └─ answer.ts           assembles the final answer with labels
│  ├─ sponsors/
│  │  ├─ nightshift.ts       OpenAI-compatible client + receipt logging
│  │  ├─ zetaris.ts          Lightning SQL over REST
│  │  ├─ worldModel.ts       loads the vendored World Model; evidence graph + conflicts
│  │  └─ hmem.ts             loads the vendored H-MEM; memory + audit
│  ├─ data/
│  │  ├─ ingest.ts           documents → chunks → CSV tables Zetaris can read
│  │  └─ readers/            text / markdown / PDF readers
│  └─ trace/
│     └─ trace.ts            JSONL trace: agent, step, model, receipt, timing
├─ web/                      index.html, app.js, style.css (question box, answer, evidence, trace)
├─ samples/conference/       fictional sample documents + questions.json
├─ tests/                    vitest: engines, evaluator rules, orchestrator in sample mode
└─ .github/workflows/ci.yml  tests on windows-latest and macos-latest
```

## 8. Sample mode (judges must be able to run it)

`npm start -- --sample` (or no keys present) runs the full agent loop **without** Zetaris, Nightshift or any
credentials:
- evidence comes from the bundled sample files (same chunk format as the Zetaris tables),
- model calls return recorded replies from a real live run (clearly labelled "sample mode"),
- H-MEM and World Model still run for real (they are local, no keys needed).

## 9. Who does what

| Rajesh | Bishesh |
|---|---|
| Nightshift client + receipts, pinned Nemotron | Zetaris setup, REST client, ingest → CSV tables |
| Planner, investigator, evaluator prompts + loop | World Model evidence graph + conflict rules |
| H-MEM memory + test | Sample data + sample mode |
| Trace log + trace panel in the UI | Clean-setup test on the MacBook |
| **Both:** demo video, slide deck, README, SPONSORS.md, final checks | |

## 10. Timeline (to the deadline)

| When | Done when |
|---|---|
| **Now (1–2 h)** | `npm run check` shows PASS for Nightshift, Zetaris, H-MEM, World Model on the MacBook |
| **Today** | One question answered end to end in live mode, with trace |
| **Tonight** | Evaluator retries, World Model conflicts, H-MEM memory, web UI |
| **Tomorrow morning** | Sample mode, tests green on Windows + macOS CI, clean setup on the MacBook |
| **Tomorrow afternoon** | Feature freeze. README, SPONSORS.md, slide deck |
| **Tomorrow evening** | Record demo on the MacBook; submit on HackOS with hours to spare |

## 11. Must have vs nice to have

**Must have:** live answer with evidence + labels; planner/investigator/evaluator loop with retries;
Zetaris as the evidence source; Nightshift + Nemotron for all model calls with receipts in the trace;
World Model conflicts; H-MEM memory; sample mode; tests; README; demo; slides.

**Nice to have (only if time):** web search as an extra evidence source; PDF reading; image reading with
`nvidia/nemotron-3.5-super-vl-120b-a12b`; "create tasks" action with approval.

**Future work slide:** Word/PowerPoint/Excel, photos, file actions (from SlothBoss and LazyFold), Scout Intent.

## 12. Risks and fallbacks

| Risk | Fallback |
|---|---|
| Nightshift Mac build hides NVIDIA models (known issue #4) | Use Nemotron through OpenRouter lanes inside Nightshift; still Nightshift as provider |
| Zetaris install is slow or can't read our files | Put CSVs under the documented shared path; if still blocked, query Zetaris sample tables to prove the connection and keep our chunks in sample mode, and say so honestly |
| `meterless/auto` silently routes to another model | Always pin a concrete `nvidia/...` model id; log routed model |
| Running out of time | Cut in this order: web search, UI polish, second engine. Never cut: required sponsors, sample mode, submission files |

## 13. Rules we must follow

- Keys only in environment variables / `.env` (gitignored). `.env.example` has placeholders only.
  The NVIDIA key lives in Nightshift's Providers tab, never in this repo.
- Declare pre-existing components in the README and the submission form: the Meterless engine reference
  implementations and the `agentathon-starter` patterns (Apache-2.0). Proofloop's own code is new.
- Every sponsor must do real work in the running app; mentions don't count.
- Submit on HackOS before 27 October, 23:45 UTC: demo video (1–4 min), slide deck, public GitHub repo,
  sponsor technology explanation.
