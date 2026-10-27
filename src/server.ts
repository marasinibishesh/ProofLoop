// Local web server (Node's built-in http, no framework): serves the page in web/ and a small JSON API.
//   npm start        live mode for every sponsor configured in .env
//   npm run sample   sample mode, no credentials needed
// Then open the printed URL (works in Chrome, Safari and Edge).

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { config, live, useFolder } from "./config.ts";
import { ask } from "./agents/orchestrator.ts";
import { FOLDER_RULES, isSupported, loadLibrary } from "./data/ingest.ts";
import { ingestFolder } from "./data/zetarisIngest.ts";
import { readText } from "./data/readers/text.ts";
import { openMemory } from "./sponsors/hmem.ts";
import { STT_MODEL, transcribe } from "./voice/elevenlabs.ts";

const WEB = path.join(config.root, "web");
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ttf": "font/ttf", ".txt": "text/plain" };
// A folder chosen on the page lives in .proofloop/folders/<id>/files, with its own memory next to it, so
// findings from one folder never show up as "already checked" for another.
const FOLDERS = path.join(config.stateDir, "folders");
const memoryFor = (dir: string) => path.basename(dir) === "files" && path.dirname(path.dirname(dir)) === FOLDERS
  ? openMemory(path.join(path.dirname(dir), "memory")) : openMemory();
let memory = await memoryFor(config.docsDir);

// Uploads in progress: id -> files and bytes so far (limits match what the folder reader accepts).
const uploads = new Map<string, { files: number; bytes: number }>();
const UPLOAD = { files: 500, fileBytes: 25_000_000, totalBytes: 200_000_000 };

/** Folder changes only come from this page: a custom header (forces a CORS preflight) and, if sent, our own origin. */
function fromPage(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  return req.headers["x-proofloop"] === "1" && (!origin || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
}

function send(res: http.ServerResponse, status: number, body: unknown, type = "application/json") {
  res.writeHead(status, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : (body as string | Buffer));
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 10_000) throw new Error("request too large");
  }
  return data;
}

async function readBytes(req: http.IncomingMessage, limit = 8_000_000): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error(limit === 8_000_000 ? "recording too long" : "file too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/api/info") {
      const questionsFile = path.join(config.docsDir, "questions.json");
      return send(res, 200, {
        live,
        voice: !!config.elevenlabs,
        folder: config.docsName,
        folderRules: FOLDER_RULES,
        questions: fs.existsSync(questionsFile) ? JSON.parse(fs.readFileSync(questionsFile, "utf8")) : [],
        files: (await loadLibrary(config.docsDir)).files,
      });
    }

    if (url.pathname === "/api/doc") {
      // Only files Proofloop found in the documents folder; the name is looked up, never used as a path.
      const name = url.searchParams.get("name") ?? "";
      const library = await loadLibrary(config.docsDir);
      const found = library.files.find((f) => f.source === name);
      if (!found) return send(res, 404, { error: "not found" });
      // Text and Markdown are shown as written; PDFs, spreadsheets and calendars as Proofloop read them.
      const text = found.kind === "file" || found.kind === "note"
        ? readText(path.join(config.docsDir, ...name.split("/")))
        : library.evidence.filter((e) => e.source === name).map((e) => e.text).join("\n\n");
      return send(res, 200, { name, kind: found.kind, newerVersion: found.newerVersion, text });
    }

    if (url.pathname === "/api/voice" && req.method === "POST") {
      // Optional: a spoken question -> text (ElevenLabs Speech-to-Text). The audio is not saved.
      if (!config.elevenlabs) return send(res, 404, { error: "Voice is off. Set ELEVENLABS_API_KEY in .env to turn it on." });
      const audio = await readBytes(req);
      if (audio.length < 1000) return send(res, 400, { error: "Didn't catch that. Click the mic, speak, then click it again." });
      return send(res, 200, { ...(await transcribe(audio, req.headers["content-type"] ?? "audio/webm")), model: STT_MODEL });
    }

    if (url.pathname.startsWith("/api/folder/") && req.method === "POST") {
      if (!fromPage(req)) return send(res, 403, { error: "Folder changes are only accepted from the Proofloop page." });

      // 1. Start: a new private folder for this upload.
      if (url.pathname === "/api/folder/start") {
        const id = crypto.randomBytes(8).toString("hex");
        fs.mkdirSync(path.join(FOLDERS, id, "files"), { recursive: true });
        uploads.set(id, { files: 0, bytes: 0 });
        return send(res, 200, { id });
      }

      const id = url.searchParams.get("id") ?? "";
      const upload = uploads.get(id);
      if (!/^[0-9a-f]{16}$/.test(id) || !upload) return send(res, 404, { error: "Unknown upload. Choose the folder again." });
      const root = path.join(FOLDERS, id, "files");

      // 2. One file: its path inside the chosen folder, body = the file's bytes.
      if (url.pathname === "/api/folder/file") {
        const rel = (url.searchParams.get("path") ?? "").split("/").filter(Boolean);
        const dirs = rel.slice(0, -1);
        if (!rel.length || rel.some((p) => p === ".." || p === "." || p.startsWith(".")) || !isSupported(rel[rel.length - 1])
          || dirs.length > FOLDER_RULES.depth || dirs.some((d) => FOLDER_RULES.skipDirs.includes(d.toLowerCase()))) {
          return send(res, 400, { error: "Unsupported file." });
        }
        const data = await readBytes(req, UPLOAD.fileBytes);
        if (upload.files + 1 > UPLOAD.files || upload.bytes + data.length > UPLOAD.totalBytes) return send(res, 413, { error: "The folder is too large." });
        const file = path.join(root, ...rel);
        if (!file.startsWith(root + path.sep)) return send(res, 400, { error: "Unsupported file." });
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, data);
        upload.files++;
        upload.bytes += data.length;
        return send(res, 200, { ok: true });
      }

      // 3. Use it: load into Zetaris, then switch every agent (and memory) to this folder.
      if (url.pathname === "/api/folder/use") {
        if (!upload.files) return send(res, 400, { error: "No supported files in that folder (txt, md, pdf, csv, ics)." });
        const name = (url.searchParams.get("name") ?? "My folder").replace(/[^\p{L}\p{N} ._()-]/gu, "").slice(0, 80) || "My folder";
        const result = await ingestFolder(root, (line) => console.log(`  [folder ${name}] ${line}`));
        useFolder(root, name);
        memory = await memoryFor(root);
        uploads.delete(id);
        return send(res, 200, { name, files: result.files, chunks: result.chunks, rows: result.rows, zetaris: !!config.zetaris });
      }
      return send(res, 404, { error: "not found" });
    }

    if (url.pathname === "/api/ask" && req.method === "POST") {
      const { question, voiceMs } = JSON.parse(await readBody(req)) as { question?: string; voiceMs?: number };
      if (!question?.trim()) return send(res, 400, { error: "Ask a question first." });
      const voice = config.elevenlabs && Number.isFinite(voiceMs) ? { model: STT_MODEL, ms: Math.round(voiceMs!) } : undefined;
      // With "Accept: application/x-ndjson" the steps are streamed as they happen (one JSON object per line:
      // {type:"pending"|"step"} while running, then {type:"answer"} or {type:"error"}). Otherwise: one JSON answer.
      if (!(req.headers.accept ?? "").includes("application/x-ndjson")) return send(res, 200, await ask(question.trim().slice(0, 500), { memory, voice }));
      res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
      const line = (o: unknown) => res.write(JSON.stringify(o) + "\n");
      try {
        line({ type: "answer", answer: await ask(question.trim().slice(0, 500), { memory, voice, onTrace: line }) });
      } catch (e) {
        console.error(e);
        line({ type: "error", error: (e as Error).message });
      }
      return res.end();
    }

    const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = path.join(WEB, path.normalize(rel));
    if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, "Not found", "text/plain");
    return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] ?? "application/octet-stream");
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: (e as Error).message });
  }
});

server.listen(config.port, "127.0.0.1", () => {
  console.log(`Proofloop is running: http://localhost:${config.port}`);
  console.log(`  model: ${live.model ? `${config.nightshift!.model} via Meterless Nightshift` : "sample mode (pre-written agent replies)"}`);
  console.log(`  voice: ${config.elevenlabs ? `on (ElevenLabs ${STT_MODEL}, speech-to-text only)` : "off (optional: set ELEVENLABS_API_KEY)"}`);
  console.log(`  data:  ${live.data ? `Zetaris (${config.zetaris!.evidenceTable})` : `local files (sample mode)`}`);
  console.log(`  folder: ${config.docsName} (${config.docsDir}); choose another one on the page`);
});
