// Reads a calendar export (.ics from Google Calendar, Outlook or Apple Calendar). Every event becomes one
// chunk in plain words, e.g. "Calendar event: ICAAD talk. Starts: 3 December 2026 11:00. Location: ...".

import { readText } from "./text.ts";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** 20261204 -> "4 December 2026"; 20261204T103000 -> "4 December 2026 10:30" (" UTC" when it ends in Z). */
export function icsDate(value: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{0,2}(Z?))?$/.exec(value.trim());
  if (!m) return value.trim();
  const [, y, mo, d, h, mi, z] = m;
  const date = `${Number(d)} ${MONTHS[Number(mo) - 1] ?? mo} ${y}`;
  return h ? `${date} ${h}:${mi}${z ? " UTC" : ""}` : date;
}

const unescape = (v: string) => v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").replace(/\s+/g, " ").trim();

export function icsEvents(text: string): string[] {
  // Long lines are folded: a line starting with a space or tab continues the previous one.
  const lines = text.replace(/\n[ \t]/g, "").split("\n");
  const events: string[] = [];
  let ev: Record<string, string> | undefined;
  for (const line of lines) {
    if (line.trim() === "BEGIN:VEVENT") ev = {};
    else if (line.trim() === "END:VEVENT" && ev) {
      const parts = [
        `Calendar event: ${ev.SUMMARY || "(no title)"}`,
        ev.DTSTART && `Starts: ${icsDate(ev.DTSTART)}`,
        ev.DTEND && `Ends: ${icsDate(ev.DTEND)}`,
        ev.LOCATION && `Location: ${ev.LOCATION}`,
        ev.DESCRIPTION && `Notes: ${ev.DESCRIPTION}`,
      ].filter(Boolean);
      events.push(parts.map((p) => String(p).replace(/[.\s]+$/, "")).join(". ") + ".");
      ev = undefined;
    } else if (ev) {
      const colon = line.indexOf(":");
      if (colon > 0) ev[line.slice(0, colon).split(";")[0].toUpperCase()] = unescape(line.slice(colon + 1));
    }
  }
  return events;
}

export function readIcs(file: string): string[] {
  return icsEvents(readText(file));
}
