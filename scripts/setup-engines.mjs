// Vendors the Meterless engine reference implementations into vendor/ (gitignored),
// the same way the official agentathon-starter does. Works on Windows and macOS.
//
//   npm run setup              download any engine that is missing
//   npm run setup -- --refresh download again, replacing what is there

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const refresh = process.argv.includes("--refresh");

const ENGINES = [
  { name: "H-MEM", source: "meterless/meterless/engines/hmem/reference", dir: "vendor/hmem" },
  { name: "World Model", source: "meterless/meterless/engines/world-model/reference", dir: "vendor/world-model" },
];

function run(cmd, args, cwd) {
  // One command string through the shell: Windows needs a shell for npx/npm (.cmd), and our
  // arguments are fixed constants, so there is nothing to escape.
  const r = spawnSync(`${cmd} ${args.join(" ")}`, { cwd, stdio: "inherit", shell: true });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.status})`);
}

for (const e of ENGINES) {
  const target = path.join(root, e.dir);
  if (fs.existsSync(path.join(target, "src", "index.ts")) && !refresh) {
    console.log(`${e.name}: already in ${e.dir} (use --refresh to download again)`);
    continue;
  }
  console.log(`${e.name}: downloading ${e.source} -> ${e.dir}`);
  run("npx", ["--yes", "degit", "--force", e.source, e.dir], root);
  run("npm", ["install", "--no-audit", "--no-fund"], target);
}
console.log("Engines ready. Next: npm run check");
