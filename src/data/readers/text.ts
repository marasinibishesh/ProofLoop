// Reads plain-text and Markdown files, and splits any text into evidence-sized chunks.

import fs from "node:fs";

export function readText(file: string): string {
  return fs.readFileSync(file, "utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

const MAX_CHUNK = 1200;

/**
 * Paragraph blocks (split on blank lines). A block longer than MAX_CHUNK (common in PDFs, which rarely
 * have blank lines) is split on line breaks into pieces of about that size.
 */
export function chunkText(text: string): string[] {
  const out: string[] = [];
  for (const block of text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)) {
    if (block.length <= MAX_CHUNK) {
      out.push(block);
      continue;
    }
    let piece = "";
    for (const line of block.split("\n")) {
      if (piece && piece.length + line.length > MAX_CHUNK) {
        out.push(piece.trim());
        piece = "";
      }
      piece += line + "\n";
    }
    if (piece.trim()) out.push(piece.trim());
  }
  return out;
}
