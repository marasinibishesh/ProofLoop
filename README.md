# Proofloop

**Agents that investigate your scattered information and prove every answer.**
Open Agent Hackathon 2026 · Track 2: *The Agent That Can Explain Why* · Team: Rajesh Khadka, Bishesh Marasini

Ask *"What do I need to do before the conference?"* and a team of agents (planner, investigator, evaluator)
searches your documents, notes and the web through **Zetaris**, reasons with **NVIDIA Nemotron via Meterless
Nightshift**, checks every claim against its source, resolves conflicting sources with the **Meterless World
Model**, and remembers what it verified with **Meterless H-MEM**. Every point in the answer shows its quote,
its source and a label: *confirmed*, *conflict*, or *not proven*.

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
| `ZETARIS_SHARED_PATH` | Folder Zetaris reads files from; Proofloop writes its evidence CSVs there |
| `ELEVENLABS_API_KEY` | Optional. Turns on the 🎙 button: ask by voice (ElevenLabs Speech-to-Text). Leave empty to hide it |

## Dependencies

- Optional service: ElevenLabs Speech-to-Text (not a hackathon sponsor; input only, off by default)
- Runtime: [`openai`](https://www.npmjs.com/package/openai) (Nightshift client), [`dotenv`](https://www.npmjs.com/package/dotenv)
- Dev: `tsx`, `typescript`, `vitest`, `@types/node`
- Engines (downloaded by `npm run setup`): Meterless H-MEM and World Model reference implementations (Apache-2.0)

## Sponsor technology

See [docs/SPONSORS.md](docs/SPONSORS.md) for how Zetaris, Meterless Nightshift, the Meterless Engines and
NVIDIA Nemotron are used, and the tests proving they work.

## Pre-existing components (declared)

- **Meterless H-MEM and World Model reference implementations** (Apache-2.0), vendored unmodified into
  `vendor/` by `npm run setup`. Proofloop calls them; it does not change them.
- **Loader pattern** for the engines follows the official Meterless `agentathon-starter` template (Apache-2.0).
- Everything else in this repository was written during the build window (22–27 October 2026).
  The idea builds on lessons from the team's earlier projects (SlothBoss, LazyFold); no code was copied from them.

## License

MIT. See [LICENSE](LICENSE).
