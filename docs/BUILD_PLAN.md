# Proofloop: build plan

**Open Agent Hackathon 2026 · Track 1: Fragmented Intelligence** (moved from Track 2 on 26 Oct; also
competing for the NVIDIA Nemotron award)
**Team:** Rajesh Khadka, Bishesh Marasini
**Deadline:** 27 October 2026, 23:45 UTC (28 October, 05:30 Nepal time). Aim to submit by the evening before.

---

## 1. What we are building (one paragraph)

**Point Proofloop at your messy files and get one answer you can prove.** It reads a whole folder (PDFs,
text and notes, spreadsheets, calendar exports, subfolders too), skips identical copies, and knows which
file is an older version of another. You ask something like *"When do I travel, where do I stay, and when is
my talk?"*. A team of agents searches all of it through Zetaris, connects what they find, checks every claim
against its source, and returns one answer where each point shows the exact quote it came from. When sources
disagree (your notes and calendar say 3 December because they were copied from an old draft; the final
programme says 4 December), Proofloop shows every side, says which it trusts and why. If something can't be
proven, it says so instead of guessing.

Tagline: **"Point it at your messy files, get one answer you can prove."**

Why Track 1: the problem is information scattered across file types, folders, copies and versions. Zetaris
is the one data layer that all of it flows through, and the agents turn it into one trusted answer.

Built on lessons from our earlier projects (ideas rebuilt from scratch, no code copied): folder scanning
from LazyFold, and PDF reading plus "which copy is the newest version" from SlothBoss.

## 2. Who it is for and why it matters

- **Users:** students, researchers and anyone whose important information is buried across PDFs, notes,
  slides, emails and websites.
- **Problem:** the answer to "what do I need to do?" or "is this true?" is spread across many places. People
  either dig through everything by hand or ask a chatbot that answers confidently and sometimes invents things.
- **Value:** one answer you can actually check. Every claim links to its evidence, conflicts are surfaced,
  older versions count less, and unproven claims are labelled.

## 3. Demo scenario (what judges will see)

Sample data (in the repo, fictional): a student preparing for a conference. The recorded demo uses the
same kind of real files from a real event, kept private and blurred where personal.

| File | What's inside |
|---|---|
| `acceptance_letter.txt` | "Camera-ready paper due 20 November. Register by 15 November." |
| `Downloads/acceptance_letter (1).txt` | Identical copy: read once |
| `programme.txt` | Final programme: "Day 2 - 4 December, 10:30, Session B, paper #508" |
| `programme_draft.txt` | Older draft: paper #508 on Day 1, 3 December (older version: counts half) |
| `slides_notes.txt` | "My talk is on 3 December." (copied from the draft) |
| `calendar.ics` | Calendar export: talk on 3 December 11:00 (also from the draft) |
| `travel_bookings.csv` | Spreadsheet: bus 2 Dec, hotel 2–5 Dec, bus back 5 Dec |
| `notes.md` | Personal notes: visa appointment, dinner hearsay |

Questions that must always work:
1. *"When do I travel, where do I stay, and when is my talk?"* (spreadsheet + calendar + documents in one
   answer; 4-way date conflict resolved, older draft counts half)
2. *"What do I need to do before the conference, and by when?"*
3. *"When exactly is my talk?"*
4. *"When is the conference dinner?"* (not proven: hearsay, sent back, still not proven)

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
│  │  ├─ ingest.ts           folder scan → chunks → CSV table Zetaris reads
│  │  ├─ versions.ts         older versions and identical copies
│  │  └─ readers/            text + markdown, PDF, CSV spreadsheet, .ics calendar
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

**Done beyond must-have:** PDF, spreadsheet and calendar reading; folder scan; version and copy detection;
optional voice questions (ElevenLabs speech-to-text, input only).

**Nice to have (only if time):** "prove it" follow-up challenge; web search as an extra evidence source;
image reading with `nvidia/nemotron-3.5-super-vl-120b-a12b`.

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
