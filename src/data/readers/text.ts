// Reads plain-text and Markdown files. (PDF reading is a nice-to-have for later.)

import fs from "node:fs";
import path from "node:path";

export const SUPPORTED = [".txt", ".md"];

export function readText(file: string): string {
  return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

export function isSupported(file: string): boolean {
  return SUPPORTED.includes(path.extname(file).toLowerCase());
}
