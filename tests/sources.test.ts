// Reading the user's files: spreadsheets, calendars, PDFs, folder scanning, versions and copies.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadLibrary } from "../src/data/ingest.ts";
import { csvRows } from "../src/data/readers/csv.ts";
import { icsEvents } from "../src/data/readers/ics.ts";
import { readPdf } from "../src/data/readers/pdf.ts";
import { detectVersions, familyKey } from "../src/data/versions.ts";

const SAMPLES = path.join(import.meta.dirname, "..", "samples", "conference");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "proofloop-sources-"));

/** The smallest valid one-page PDF with a line of text (Helvetica), built by hand. */
function tinyPdf(text: string): Buffer {
  const content = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

describe("readers", () => {
  it("turns spreadsheet rows into readable chunks, including quoted cells with commas", () => {
    const rows = csvRows('item,provider,details\nHotel,"Guest House, Thamel","3 nights, ""quiet"" room"\n');
    expect(rows).toEqual(['item: Hotel; provider: Guest House, Thamel; details: 3 nights, "quiet" room']);
  });

  it("turns calendar events into plain sentences with readable dates", () => {
    const ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Talk\r\nDTSTART:20261204T103000\r\nDTEND;VALUE=DATE:20261204\r\nLOCATION:Hall B\, Kathmandu\r\nDESCRIPTION:A long\r\n  folded line\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    expect(icsEvents(ics.replace(/\r\n/g, "\n"))).toEqual([
      "Calendar event: Talk. Starts: 4 December 2026 10:30. Ends: 4 December 2026. Location: Hall B, Kathmandu. Notes: A long folded line.",
    ]);
  });

  it("reads the text of a PDF", async () => {
    const file = path.join(tmp(), "letter.pdf");
    fs.writeFileSync(file, tinyPdf("Talk on 4 December 2026"));
    expect((await readPdf(file)).join(" ")).toContain("Talk on 4 December 2026");
  });
});

describe("versions and copies", () => {
  it("groups versions of one document by name", () => {
    expect(familyKey("programme_draft.txt")).toBe(familyKey("programme.txt"));
    expect(familyKey("Programme v2 FINAL.pdf")).toBe(familyKey("programme.pdf"));
    expect(familyKey("report_2026-10-01.pdf")).toBe(familyKey("report.pdf"));
    expect(familyKey("a/notes.md")).not.toBe(familyKey("b/notes.md"));
  });

  it("marks older versions and identical copies", () => {
    const v = detectVersions([
      { rel: "programme_draft.txt", modified: 0, hash: "a" },
      { rel: "programme.txt", modified: 0, hash: "b" },
      { rel: "programme_v2.pdf", modified: 0, hash: "c" },
      { rel: "letter.txt", modified: 0, hash: "d" },
      { rel: "Downloads/letter (1).txt", modified: 9e12, hash: "d" },
      { rel: "slides.txt", modified: 0, hash: "e" },
      { rel: "slides_copy.txt", modified: 0, hash: "f" }, // different text, same age: can't tell, so both stay
    ]);
    expect(Object.fromEntries(v.newerVersion)).toEqual({ "programme_draft.txt": "programme_v2.pdf", "programme.txt": "programme_v2.pdf" });
    expect(Object.fromEntries(v.duplicateOf)).toEqual({ "Downloads/letter (1).txt": "letter.txt" });
  });

  it("scans the sample folder, subfolders included", async () => {
    const lib = await loadLibrary(SAMPLES);
    const byName = Object.fromEntries(lib.files.map((f) => [f.source, f]));
    expect(byName["Downloads/acceptance_letter (1).txt"]?.duplicateOf).toBe("acceptance_letter.txt");
    expect(byName["programme_draft.txt"]?.newerVersion).toBe("programme.txt");
    expect(byName["travel_bookings.csv"]?.kind).toBe("table");
    expect(byName["calendar.ics"]?.kind).toBe("calendar");
    expect(lib.evidence.some((e) => e.source.startsWith("Downloads/"))).toBe(false);
  });
});
