// Configuration from environment variables / .env. Missing sponsor settings mean sample mode,
// so judges can run Proofloop without any credentials.

import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = (name: string) => {
  const v = process.env[name]?.trim();
  return v && !v.startsWith("replace-with") ? v : undefined;
};

const nightshiftToken = env("METERLESS_RUNTIME_TOKEN");
const elevenlabsKey = env("ELEVENLABS_API_KEY");
const zetarisKey = env("ZETARIS_API_KEY");
const zetarisOrg = env("ZETARIS_ORG_ID");

const userDocs = path.resolve(root, (env("PROOFLOOP_DOCS") ?? path.join("samples", "conference")).replace(/^~(?=$|[\\/])/, os.homedir()));

/**
 * Sample mode replays pre-written agent replies (sample-replies.json). If the chosen folder has none, it uses the
 * bundled conference sample, which does, so `npm run sample` always shows the full loop.
 */
function docsFolder(): string {
  if (!process.argv.includes("--sample")) return chosenFolder()?.dir ?? userDocs;
  if (fs.existsSync(path.join(userDocs, "sample-replies.json"))) return userDocs;
  return path.join(root, "samples", "conference");
}

/** The folder picked with "Choose folder" on the page, remembered across restarts (only if it still exists). */
const CHOSEN = path.join(root, ".proofloop", "active-folder.json");
function chosenFolder(): { dir: string; name: string } | undefined {
  try {
    const c = JSON.parse(fs.readFileSync(CHOSEN, "utf8")) as { dir: string; name: string };
    return fs.existsSync(c.dir) ? c : undefined;
  } catch {
    return undefined;
  }
}

/** Switches every agent to another folder now, and remembers it for the next start. */
export function useFolder(dir: string, name: string): void {
  config.docsDir = dir;
  config.docsName = name;
  fs.mkdirSync(path.dirname(CHOSEN), { recursive: true });
  fs.writeFileSync(CHOSEN, JSON.stringify({ dir, name }));
}

export const config = {
  root,
  stateDir: path.join(root, ".proofloop"),
  sampleFlag: process.argv.includes("--sample"),
  /** Folder with the user's documents and notes (defaults to the bundled sample). */
  /** "~" means the home folder, so PROOFLOOP_DOCS=~/Documents/ICAAD works on macOS and Windows. */
  docsDir: docsFolder(),
  /** What the page calls the folder: the name the user picked, else the folder's own name. */
  docsName: (!process.argv.includes("--sample") && chosenFolder()?.name) || path.basename(docsFolder()),
  port: Number(env("PROOFLOOP_PORT") ?? 4317),
  nightshift: nightshiftToken
    ? {
        baseUrl: env("METERLESS_BASE_URL") ?? "http://127.0.0.1:8088/v1",
        token: nightshiftToken,
        model: env("METERLESS_MODEL") ?? "nvidia/nemotron-3.5-lightning-30b-a3b",
        app: env("METERLESS_APP") ?? "proofloop",
        /** Which agents let Nemotron reason before answering: "off" (default, fastest), "evaluator" or "on" (all, very slow). */
        thinking: (env("METERLESS_THINKING") ?? "off") as "on" | "off" | "evaluator",
      }
    : undefined,
  /** Optional voice input (speech-to-text only). */
  elevenlabs: elevenlabsKey ? { apiKey: elevenlabsKey } : undefined,
  zetaris:
    zetarisKey && zetarisOrg
      ? {
          restUrl: env("ZETARIS_REST_URL") ?? "http://localhost:8888/api/v1.0",
          orgId: zetarisOrg,
          apiKey: zetarisKey,
          sharedPath: env("ZETARIS_SHARED_PATH") ?? "/home/zetaris/customer-data/shared",
          evidenceTable: env("ZETARIS_EVIDENCE_TABLE") ?? "PROOFLOOP.evidence",
        }
      : undefined,
};

/** Which parts run live. Each sponsor is used as soon as it's configured; --sample forces sample mode. */
export const live = {
  model: !config.sampleFlag && !!config.nightshift,
  data: !config.sampleFlag && !!config.zetaris,
};
