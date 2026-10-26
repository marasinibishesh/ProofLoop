// Reads the text layer of a PDF (letters, programmes, emails or slides saved as PDF).
// Scanned PDFs without a text layer give no text; they are reported, not guessed.

import fs from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";
import { chunkText } from "./text.ts";

export async function readPdf(file: string): Promise<string[]> {
  const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(file)));
  const { text } = await extractText(pdf, { mergePages: false });
  return text.flatMap((page) => chunkText(page.replace(/\r\n?/g, "\n")));
}
