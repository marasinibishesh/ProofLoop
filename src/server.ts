// Local web server (Node's built-in http, no framework): serves the page in web/ and a small JSON API.
//   npm start        live mode for every sponsor configured in .env
//   npm run sample   sample mode, no credentials needed
// Then open the printed URL (works in Chrome, Safari and Edge).

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { config, live } from "./config.ts";
import { ask } from "./agents/orchestrator.ts";
import { openMemory } from "./sponsors/hmem.ts";

const WEB = path.join(config.root, "web");
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const memory = await openMemory();

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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/api/info") {
      const questionsFile = path.join(config.docsDir, "questions.json");
      return send(res, 200, {
        live,
        questions: fs.existsSync(questionsFile) ? JSON.parse(fs.readFileSync(questionsFile, "utf8")) : [],
        docs: fs.readdirSync(config.docsDir).filter((f) => /\.(txt|md)$/i.test(f)),
      });
    }

    if (url.pathname === "/api/doc") {
      // Only plain file names inside the documents folder: no paths, no "..".
      const name = path.basename(url.searchParams.get("name") ?? "");
      const file = path.join(config.docsDir, name);
      if (!/\.(txt|md)$/i.test(name) || !fs.existsSync(file)) return send(res, 404, { error: "not found" });
      return send(res, 200, { name, text: fs.readFileSync(file, "utf8") });
    }

    if (url.pathname === "/api/ask" && req.method === "POST") {
      const { question } = JSON.parse(await readBody(req)) as { question?: string };
      if (!question?.trim()) return send(res, 400, { error: "Ask a question first." });
      return send(res, 200, await ask(question.trim().slice(0, 500), { memory }));
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
  console.log(`  data:  ${live.data ? `Zetaris (${config.zetaris!.evidenceTable})` : `local files in ${config.docsDir} (sample mode)`}`);
});
