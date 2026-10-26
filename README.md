# Proofloop

**Point it at your messy files, get one answer you can prove.**
Open Agent Hackathon 2026 · Track 1: *Fragmented Intelligence* · Team: Rajesh Khadka, Bishesh Marasini

Point Proofloop at a folder (PDFs, notes, spreadsheets, calendar exports, subfolders, duplicate downloads,
old drafts) and ask *"When do I travel, where do I stay, and when is my talk?"*. A team of agents (planner,
investigator, evaluator) searches all of it through **Zetaris**, reasons with **NVIDIA Nemotron via Meterless
Nightshift**, checks every claim against its source, resolves conflicting sources with the **Meterless World
Model**, and remembers what it verified with **Meterless H-MEM**. Every point in the answer shows its quote,
its source and a label: *confirmed*, *conflict*, or *not proven*.

**What it reads:** `.txt`, `.md`, `.pdf` (text layer), `.csv` spreadsheets (one row per piece of evidence)
and `.ics` calendar exports, in the folder and its subfolders. Identical copies are read once; when a file is
an older version of another (`programme_draft.txt` vs `programme.txt`, `report_v1.pdf` vs `report_v2.pdf`),
its evidence counts half, so the newest version wins a conflict. Word and PowerPoint files: export them as PDF.

> **Status:** the full agent loop runs in sample mode (`npm run sample`); live Nightshift + Zetaris
> integration is being connected. See [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md).

## Requirements

- Windows 10/11 or macOS 12+ (Apple Silicon or Intel)
- [Node.js](https://nodejs.org) 20 or newer, and Git
- For live mode: Meterless Nightshift running locally with NVIDIA added as a provider, and a Zetaris instance.
  Without them, Proofloop runs in **sample mode** (no credentials needed).

## Setup (same commands on Windows and macOS)

```bash
git clone <this-repo-url> proofloop
cd proofloop
npm install
npm run setup        # downloads the Meterless H-MEM and World Model reference engines into vendor/
npm test             # engine tests (no credentials needed)
```

Live mode only: copy `.env.example` to `.env` and fill in your own values. Never commit `.env`.
The NVIDIA API key does **not** go in `.env`; add it in Nightshift → Setup → Providers → NVIDIA.

```bash
npm run check        # one real call to Nightshift, Zetaris, H-MEM and World Model: PASS / FAIL / SKIP
npm run ingest       # splits your documents into evidence chunks and registers them in Zetaris
```

`npm run ingest` writes `data-out/evidence.csv`. Zetaris must be able to read it at `ZETARIS_SHARED_PATH`;
set `ZETARIS_IMPORT_DIR` to the same folder as seen from your computer (for example the Docker volume) and
the script copies it there for you.

## Usage

```bash
npm start            # live mode (uses your .env)
npm run sample       # sample mode: bundled fictional documents, no credentials
```

Then open the URL it prints. Sample questions are in `samples/conference/questions.json`.

**Use your own files:** set `PROOFLOOP_DOCS` in `.env` to a folder, e.g. `PROOFLOOP_DOCS=~/Documents/ICAAD`
(macOS) or `PROOFLOOP_DOCS=C:\Users\you\Documents\ICAAD` (Windows), then run `npm run ingest` and `npm start`.
Your files stay on your computer; only the evidence chunks go to your own Zetaris instance and the model.

**Optional voice:** with `ELEVENLABS_API_KEY` set, click 🎙, ask your question out loud, click again.
ElevenLabs only turns speech into text (shown in the trace as a `voice` step); every answer is still
planned, checked and proven by the same agents on Nemotron via Nightshift. Audio is not saved.

## Environment variables

| Variable | Purpose |
|---|---|
| `METERLESS_BASE_URL` | Nightshift OpenAI-compatible endpoint, e.g. `http://127.0.0.1:8088/v1` |
| `METERLESS_RUNTIME_TOKEN` | Runtime token from Nightshift → Console |
| `METERLESS_MODEL` | Pinned model, default `nvidia/nemotron-3.5-lightning-30b-a3b` |
| `METERLESS_APP` | App name sent in the `meterless-app` header |
| `ZETARIS_REST_URL` | Zetaris REST base, e.g. `http://localhost:8888/api/v1.0` |
| `ZETARIS_ORG_ID`, `ZETARIS_API_KEY` | From the Zetaris Console |
| `ZETARIS_SHARED_PATH` | Folder Zetaris reads files from, as Zetaris sees it |
| `ZETARIS_IMPORT_DIR` | The same folder as seen from your computer; `npm run ingest` copies `evidence.csv` there |
| `PROOFLOOP_DOCS` | The folder of files to read (default: the bundled sample). `~` means your home folder |
| `ELEVENLABS_API_KEY` | Optional. Turns on the 🎙 button: ask by voice (ElevenLabs Speech-to-Text). Leave empty to hide it |

## Dependencies

- Optional service: ElevenLabs Speech-to-Text (not a hackathon sponsor; input only, off by default)
- Runtime: [`openai`](https://www.npmjs.com/package/openai) (Nightshift client), [`dotenv`](https://www.npmjs.com/package/dotenv),
  [`unpdf`](https://www.npmjs.com/package/unpdf) (PDF text)
- Dev: `tsx`, `typescript`, `vitest`, `@types/node`
- Engines (downloaded by `npm run setup`): Meterless H-MEM and World Model reference implementations (Apache-2.0)

## Sponsor technology

See [docs/SPONSORS.md](docs/SPONSORS.md) for how Zetaris, Meterless Nightshift, the Meterless Engines and
NVIDIA Nemotron are used, and the tests proving they work.

## Pre-existing components (declared)

- **Meterless H-MEM and World Model reference implementations** (Apache-2.0), vendored unmodified into
  `vendor/` by `npm run setup`. Proofloop calls them; it does not change them.
- **Sample documents** in `samples/conference/` are fictional (people, bookings and reference numbers are made up).
- **Loader pattern** for the engines follows the official Meterless `agentathon-starter` template (Apache-2.0).
- Everything else in this repository was written during the build window (22–27 October 2026).
  Some ideas come from the team's earlier projects and were rebuilt from scratch here (no code copied): folder
  scanning from LazyFold, and PDF reading plus "which copy is the newest version" from SlothBoss.

## License

MIT. See [LICENSE](LICENSE).
