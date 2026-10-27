// Proofloop page: sends the question to /api/ask, shows each agent step live as the server streams it,
// then the answer with its evidence. All text from documents and models is inserted with textContent.

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const LABELS = { confirmed: "Confirmed", conflict: "Files disagree", "not-proven": "Not proven" };
const AGENTS = { planner: "Planner", investigator: "Investigator", evaluator: "Evaluator", "world-model": "World Model", memory: "Memory", zetaris: "Zetaris", answer: "Answer", voice: "Voice" };
// The evaluator's reason ends with "(source type: official)"; shown as a plain label instead.
const SOURCE_TYPES = { official: "Official document", booking: "Booking record", calendar: "Your calendar", note: "Your note" };
const pct = (n) => `${Math.round(n * 100)}%`;
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

let info = { live: { model: false, data: false }, questions: [], files: [] };

async function init() {
  info = await (await fetch("/api/info")).json();
  const live = info.live.model && info.live.data;
  $("status").append(
    el("span", "sq" + (live ? "" : " sample")),
    el("span", "mode", live ? "LIVE" : "SAMPLE"),
    el("span", "", info.live.model ? "Nemotron via Meterless Nightshift" : "Pre-written agent replies"),
    el("span", "sep", "·"),
    el("span", "", info.live.data ? "Data in Zetaris" : "Local sample files"),
  );
  showFolder();
  if (info.voice) {
    $("status").append(el("span", "sep", "·"), el("span", "", "Voice by ElevenLabs"));
    $("micBtn").hidden = false;
  }
}

// ---------------------------------------------------------------- folder

const KINDS = { file: "Text", note: "Note", pdf: "PDF", table: "Spreadsheet", calendar: "Calendar" };


// ---------------------------------------------------------------- folder


/** The folder the agents search right now, with what was found in it. */
function showFolder() {
  const read = info.files.filter((f) => !f.duplicateOf && !f.error);
  const older = info.files.filter((f) => f.newerVersion).length;
  const copies = info.files.filter((f) => f.duplicateOf).length;
  $("folderName").textContent = info.folder || "No folder yet";
  $("folderMeta").textContent = [plural(read.length, "file"), older && plural(older, "older version"), copies && `${plural(copies, "copy", "copies")} skipped`]
    .filter(Boolean).join(" · ");
}

function folderSay(text, cls = "", busy = false) {
  const p = $("folderStatus");
  p.hidden = !text;
  p.className = `folder-status ${cls}`;
  p.replaceChildren();
  if (busy) p.append(el("span", "spin"));
  p.append(text || "");
}

// "Choose folder": the browser's folder picker gives the folder's files (not its path), so they are copied to a
// private folder on this computer, loaded into Zetaris, and every agent switches to them.
$("folderBtn").addEventListener("click", () => $("folderInput").click());
$("folderInput").addEventListener("change", async () => {
  const all = [...$("folderInput").files];
  $("folderInput").value = "";
  if (!all.length) return;
  const name = (all[0].webkitRelativePath || "").split("/")[0] || "My folder";
  // Copy only what the reader would read (rules from the server): readable types, not hidden, not in skipped
  // folders like node_modules, not too deep, not too big, and not too many.
  const rules = info.folderRules;
  const inside = (f) => (f.webkitRelativePath || f.name).split("/").slice(1).join("/") || f.name;
  const readable = (f) => {
    const parts = inside(f).split("/");
    const dirs = parts.slice(0, -1);
    return !parts.some((p) => p.startsWith(".") || p.startsWith("~$")) && dirs.length <= rules.depth
      && !dirs.some((d) => rules.skipDirs.includes(d.toLowerCase()))
      && rules.types.some((x) => f.name.toLowerCase().endsWith(x)) && f.size > 0 && f.size <= rules.bytes;
  };
  const files = all.filter(readable).slice(0, rules.files);
  const skipped = all.length - files.length;
  if (!files.length) return folderSay(`No readable files in “${name}”. Proofloop reads ${rules.types.join(", ")} files.`, "bad");

  $("folderBtn").disabled = $("askBtn").disabled = true;
  const post = async (url, body) => {
    const res = await fetch(url, { method: "POST", headers: { "X-Proofloop": "1" }, body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  };
  try {
    const { id } = await post("/api/folder/start");
    for (let i = 0; i < files.length; i++) {
      folderSay(`Copying “${name}”: file ${i + 1} of ${files.length}…`, "", true);
      await post(`/api/folder/file?id=${id}&path=${encodeURIComponent(inside(files[i]))}`, files[i]);
    }
    folderSay(info.live.data ? `Loading ${plural(files.length, "file")} into Zetaris…` : `Reading ${plural(files.length, "file")}…`, "", true);
    const r = await post(`/api/folder/use?id=${id}&name=${encodeURIComponent(name)}`);
    info = await (await fetch("/api/info")).json();
    showFolder();
    $("run").hidden = true;
    folderSay(`Ready: the agents now search “${r.name}”${r.zetaris ? ` (${plural(r.rows ?? r.chunks, "passage")} in Zetaris)` : ""}.`
      + (skipped ? ` ${plural(skipped, "other file")} not copied (other types, hidden, or in folders like node_modules).` : ""), "ok");
    $("question").focus();
  } catch (e) {
    folderSay(`Could not use that folder: ${e.message}`, "bad");
  } finally {
    $("folderBtn").disabled = $("askBtn").disabled = false;
  }
});

// ---------------------------------------------------------------- live steps

/** A trace event in plain words: what the agent did, and whether it went well. */
function describe(e) {
  const d = e.detail || "";
  const num = (re) => Number((re.exec(d) || [])[1] || 0);
  if (e.model) {
    const asked = { plan: "Asked Nemotron to plan", investigate: "Asked Nemotron to draft claims", "investigate (retry)": "Asked Nemotron to try again",
      judge: "Asked Nemotron to check a claim", "classify source": "Asked Nemotron what kind of file a source is" }[e.action] || `Asked Nemotron: ${e.action}`;
    const served = e.model.served.replace(/^nvidia\//, "");
    return { text: asked, mark: "ok", meta: `${served} via Nightshift · ${e.model.ms} ms${e.model.receiptId ? ` · ${e.model.receiptId}` : ""}` };
  }
  switch (`${e.agent}/${e.action}`) {
    case "voice/transcribe": return { text: "Turned the spoken question into text", mark: "ok", meta: d };
    case "planner/start": return { text: `Question received: ${(/question: (.*?) \|/.exec(d) || [])[1] || ""}`, mark: "ok" };
    case "memory/recall": return d.startsWith("nothing") ? { text: "Nothing relevant in memory yet", mark: "info" }
      : { text: `Recalled ${plural(d.split(" | ").length, "earlier finding")}`, mark: "ok" };
    case "planner/plan": return { text: `Split into ${plural((d.match(/\bs\d+:/g) || []).length || 1, "sub-question")}`, mark: "ok", meta: d.replace(/\bs\d+: /g, "").split(" | ").join(" · ") };
    case "zetaris/query": {
      const m = /-> (\d+) rows in (\d+) ms/.exec(d);
      return { text: m ? `Searched Zetaris: ${plural(Number(m[1]), "row")}, ${m[2]} ms` : "Searched Zetaris", mark: "ok", meta: d.replace(/ -> \d+ rows in \d+ ms$/, "") };
    }
    case "investigator/search": return { text: `Found ${plural(num(/: (\d+) chunks/), "passage")} to read`, mark: "ok" };
    case "investigator/search (retry)": return { text: `Searched again after feedback: ${plural(num(/: (\d+) chunks/), "passage")}`, mark: "ok" };
    case "investigator/follow references": return { text: `Followed ${(/\[(.*)\]/.exec(d) || [])[1] || "a reference"}: ${plural(num(/: (\d+) more/), "more passage")}`, mark: "ok" };
    case "investigator/claims": return { text: `Drafted ${plural(num(/: (\d+) claim/), "claim")}`, mark: "ok" };
    case "investigator/gave up": return { text: "Gave up: no better evidence found", mark: "info" };
    case "evaluator/accept": {
      const conf = /\(confidence ([\d.]+)\)/.exec(d);
      return { text: `Accepted: ${d.split(" → ")[0].replace(/ \(confidence [\d.]+\)$/, "")}`, mark: "ok", meta: conf ? `${pct(Number(conf[1]))} trust` : "" };
    }
    case "evaluator/reject (code check)": return { text: "Rejected: quote not found in the file", mark: "bad", bad: true, meta: d.split(" → ")[0] };
    case "evaluator/reject": {
      const [claim, why] = d.split(" → ");
      return { text: `Rejected: ${why || "not supported"}`, mark: "bad", bad: true, meta: claim };
    }
    case "evaluator/send back": return { text: `Sent back to Investigator: ${plural(num(/: (\d+) claim/), "claim")}`, mark: "warn", warn: true };
    case "world-model/facts": {
      const facts = num(/(\d+) fact/), lost = num(/; (\d+) superseded/);
      return { text: `Recorded ${plural(facts, "fact")}${lost ? ` · ${lost} superseded` : ""}`, mark: lost ? "warn" : "ok" };
    }
    case "memory/store": return { text: `Remembered: ${d}`, mark: "ok" };
    case "answer/done": return { text: `Answer ready: ${d.replace(/,? in \d+ ms$/, "")}`, mark: "ok" };
    default: return { text: `${e.action}${d ? `: ${d}` : ""}`, mark: "info" };
  }
}

const MARKS = { ok: "✓", bad: "✗", warn: "!", info: "·" };
const PENDING = { planner: "Asking Nemotron to plan…", investigator: "Asking Nemotron…", evaluator: "Asking Nemotron to check…", zetaris: "Querying Zetaris…" };

function stepRow(who, text, mark, meta, cls, sql = false) {
  const li = el("li", "step" + (mark === "run" ? " current" : ""));
  const m = el("span", `mark ${mark}`);
  if (mark === "run") m.append(el("span", "spin"));
  else m.textContent = MARKS[mark];
  const body = el("div");
  body.append(el("div", "who", who.toUpperCase()), el("p", `what${cls ? ` ${cls}` : ""}`, text));
  if (meta) {
    const m2 = el("p", sql ? "meta sql" : "meta", meta);
    if (sql) m2.title = meta;
    body.append(m2);
  }
  li.append(m, body);
  return li;
}

/** Running totals for the line above the timeline. */
const counts = () => ({ subs: 0, claims: 0, accepted: 0, rejected: 0, back: 0, queries: 0, calls: 0 });
let tally = counts();

function count(e) {
  const d = e.detail || "";
  if (e.model) tally.calls++;
  if (e.agent === "planner" && e.action === "plan" && !e.model) tally.subs += (d.match(/\bs\d+:/g) || []).length || 1;
  if (e.agent === "investigator" && e.action === "claims") tally.claims += Number((/: (\d+) claim/.exec(d) || [])[1] || 0);
  if (e.action === "accept") tally.accepted++;
  if (e.action.startsWith("reject")) tally.rejected++;
  if (e.action === "send back") tally.back++;
  if (e.agent === "zetaris") tally.queries++;
  const t = tally;
  $("counts").textContent = [
    plural(t.subs, "sub-question"), plural(t.claims, "claim"), `${t.accepted} accepted`,
    t.rejected && `${t.rejected} rejected`, `${t.back} sent back`,
    info.live.data && plural(t.queries, "Zetaris query", "Zetaris queries"), info.live.model && plural(t.calls, "model call"),
  ].filter(Boolean).join(" · ");
}

// Messages from the server are played through a queue: at once when live, ~300 ms apart in sample mode
// (where every step is ready almost instantly), so each step can be followed. Skip plays the rest at once.
let queue = [];
let timer = null;
let pendingRow = null;
let replayRow = null;

function play(message) {
  const list = $("timeline");
  if (message.type === "pending") {
    $("workingText").textContent = `Now: ${AGENTS[message.agent] || message.agent}. ${PENDING[message.agent] || "Working…"}`;
    pendingRow?.remove();
    pendingRow = stepRow(AGENTS[message.agent] || message.agent, PENDING[message.agent] || "Working…", "run");
    list.append(pendingRow);
  } else if (message.type === "step") {
    pendingRow?.remove();
    pendingRow = null;
    replayRow?.classList.remove("current");
    const e = message.event;
    const w = describe(e);
    if (e.agent === "planner" && e.action === "plan" && !e.model && e.detail) {
      $("workingPlan").replaceChildren(...e.detail.split(" | ").map((s) => el("li", "", s.replace(/^s\d+: /, ""))));
    }
    $("workingText").textContent = `Last step: ${AGENTS[e.agent] || e.agent}. ${w.text}`;
    const row = stepRow(AGENTS[e.agent] || e.agent, w.text, w.mark, w.meta, w.bad ? "bad" : w.warn ? "warn" : "", e.agent === "zetaris");
    list.append(row);
    if (!info.live.model && queue.length) { replayRow = row; row.classList.add("current"); }
    count(e);
  } else if (message.type === "answer") {
    replayRow?.classList.remove("current");
    render(message.answer);
  } else if (message.type === "error") {
    pendingRow?.remove();
    list.append(stepRow("Error", message.error, "bad", "", "bad"));
    showError(message.error);
  }
  list.scrollTop = list.scrollHeight;
}

function drain(all = false) {
  clearTimeout(timer);
  timer = null;
  const paced = !info.live.model && !all;
  while (queue.length) {
    play(queue.shift());
    if (paced && queue.length) { timer = setTimeout(drain, 300); break; }
  }
  $("skipBtn").hidden = !timer;
}

function enqueue(message) {
  queue.push(message);
  if (!timer) drain();
}

$("skipBtn").addEventListener("click", () => drain(true));

// ---------------------------------------------------------------- ask

let voiceMs; // set when the current question came from the mic

function resetRun() {
  queue = [];
  clearTimeout(timer);
  timer = null;
  pendingRow = replayRow = null;
  tally = counts();
  $("timeline").replaceChildren();
  $("counts").textContent = "Waiting for the first step…";
  $("points").replaceChildren();
  $("unproven").replaceChildren();
  $("summary").textContent = "";
  $("waiting").hidden = false;
  $("workingText").textContent = "The agents are working on your question.";
  $("workingPlan").replaceChildren();
  $("conclusion").hidden = true;
  $("across").hidden = true;
  $("activity").hidden = true;
  $("extras").hidden = true;
  $("skipBtn").hidden = true;
  $("run").classList.add("running");
  $("run").hidden = false;
}

async function submit(event) {
  event?.preventDefault();
  if (event) voiceMs = undefined; // typed and sent by hand
  const question = $("question").value.trim();
  if (!question) return;
  $("askBtn").disabled = true;
  resetRun();
  window.scrollTo({ top: $("run").getBoundingClientRect().top + window.scrollY - 8, behavior: "auto" });
  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
      body: JSON.stringify({ question, voiceMs }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    // One JSON object per line; a line may arrive split across chunks.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const l of lines) if (l.trim()) enqueue(JSON.parse(l));
      if (done) break;
    }
    if (buffer.trim()) enqueue(JSON.parse(buffer));
  } catch (e) {
    enqueue({ type: "error", error: e.message });
  } finally {
    $("askBtn").disabled = false;
    voiceMs = undefined;
  }
}

// Optional voice input: click the mic, speak, click again. ElevenLabs only turns the audio into text.
let recorder;

function voiceSay(text) {
  $("voiceStatus").hidden = !text;
  $("voiceStatus").textContent = text || "";
}

async function toggleMic() {
  if (recorder?.state === "recording") return recorder.stop();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return voiceSay("Microphone blocked. Allow it in the browser and try again.");
  }
  const type = ["audio/webm", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
  recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    $("micBtn").classList.remove("live");
    voiceSay("Transcribing…");
    try {
      const res = await fetch("/api/voice", { method: "POST", headers: { "Content-Type": recorder.mimeType || "audio/webm" }, body: new Blob(chunks) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      if (!data.text) return voiceSay("Didn't catch that. Try again.");
      voiceSay(`Heard: “${data.text}”`);
      $("question").value = data.text.slice(0, 500);
      voiceMs = data.ms;
      submit();
    } catch (e) {
      voiceSay(`Voice failed: ${e.message}`);
    }
  };
  recorder.start();
  $("micBtn").classList.add("live");
  voiceSay("Listening… click the mic again when you're done.");
}

$("micBtn").addEventListener("click", toggleMic);

// ---------------------------------------------------------------- answer

function splitReason(reason) {
  const m = /\s*\(source type: (\w+)\)\s*/.exec(reason || "");
  return { why: (reason || "").replace(/\s*\(source type: \w+\)\s*/, " ").trim(), type: m ? SOURCE_TYPES[m[1]] : undefined };
}

function citeBlock(c, inConflict) {
  const verdict = c.kept === false ? "set-aside" : inConflict ? "kept" : "";
  const box = el("div", "cite" + (verdict ? ` ${verdict}` : ""));
  const { why, type } = splitReason(c.reason);
  const top = el("div", "cite-top");
  const open = el("button", "link cite-file", c.source);
  open.type = "button";
  open.title = "Open the file at this line";
  open.onclick = () => showDoc(c.source, c.quote);
  const tags = el("span", "cite-tags");
  if (type) tags.append(el("span", "", type));
  const bar = el("span", "bar");
  const track = el("span", "bar-track");
  const fill = el("span", "bar-fill");
  fill.style.width = pct(c.confidence);
  track.append(fill);
  bar.append(track, el("span", "", `${pct(c.confidence)} trust`));
  tags.append(bar);
  if (verdict) tags.append(el("span", `verdict ${verdict}`, verdict === "kept" ? "TRUSTED" : "SET ASIDE"));
  top.append(open, tags);
  box.append(top, el("p", "quote", `“${c.quote}”`));
  if (why) box.append(el("p", "why", why));
  return box;
}

/** "Trusted exam_routine.txt (official document) over calendar.ics (your calendar)." */
function decision(p) {
  const kept = p.sources.filter((s) => s.kept !== false);
  const aside = p.sources.filter((s) => s.kept === false);
  if (!kept.length || !aside.length) return p.note || "";
  const name = (s) => { const t = splitReason(s.reason).type; return t ? `${s.source} (${t.toLowerCase()})` : s.source; };
  return `Trusted ${name(kept[0])} over ${aside.map(name).join(", ")}.`;
}

function render(a) {
  $("run").classList.remove("running");
  $("waiting").hidden = true;
  const points = $("points");
  points.replaceChildren();
  const ordered = [...a.points.filter((p) => p.label === "conflict"), ...a.points.filter((p) => p.label !== "conflict")];
  if (!ordered.length && !a.unproven.length) points.append(el("p", "empty", "Nothing in your files answers this, so Proofloop won't guess. Try the words your files use."));
  for (const p of ordered) {
    const card = el("article", `point ${p.label}`);
    card.append(el("span", `tag ${p.label}`, LABELS[p.label].toUpperCase()), el("p", "statement", p.statement));
    if (p.label === "conflict") card.append(el("p", "decision", decision(p)));
    const sources = el("div", "sources");
    for (const c of p.sources) sources.append(citeBlock(c, p.label === "conflict"));
    card.append(sources);
    points.append(card);
  }
  const unproven = $("unproven");
  unproven.replaceChildren();
  if (a.unproven.length && ordered.length) unproven.append(el("h3", "group-head", "NOT PROVEN"));
  for (const u of a.unproven) {
    const card = el("article", "point not-proven");
    card.append(el("span", "tag not-proven", "NOT PROVEN"), el("p", "statement", u.statement), el("p", "why", u.reason));
    unproven.append(card);
  }
  const n = (label) => a.points.filter((p) => p.label === label).length;
  $("summary").textContent = [
    n("confirmed") && `${n("confirmed")} confirmed`, n("conflict") && `${n("conflict")} where files disagree`,
    a.unproven.length && `${a.unproven.length} not proven`, `${(a.ms / 1000).toFixed(1)} s`,
  ].filter(Boolean).join(" · ");
  $("plan").replaceChildren(...a.subQuestions.map((s) => el("li", "", s.text)));
  const memo = (m) => m.replace(/;\s*asked: ".*?"\)$/, ")");
  $("memory").replaceChildren(...(a.memory.length ? a.memory.map((m) => el("li", "", memo(m))) : [el("li", "empty-line", "Nothing yet. Answers are remembered here.")]));
  $("extras").hidden = false;
  showConclusion(a, ordered);
  showAcross(a);
  showActivity(a);
}

/** The answer in a few lines: what is true, which file won when files disagreed, and what stays unproven. */
function showConclusion(a, ordered) {
  const items = [];
  for (const p of ordered) {
    const li = el("li", p.label);
    const text = el("div", "", p.statement);
    if (p.label === "conflict") text.append(el("span", "aside", decision(p)));
    li.append(text);
    items.push(li);
  }
  const line = (cls, text) => { const li = el("li", cls); li.append(el("div", "", text)); return li; };
  for (const u of a.unproven) items.push(line("not-proven", `Not proven: ${u.statement}`));
  if (!items.length) items.push(line("not-proven", "Nothing in your files answers this, so there is no conclusion."));
  $("conclusionList").replaceChildren(...items);
  $("conclusion").hidden = false;
}

/** Track 1: every file in the folder, and what the agents did with it for this question. */
function showAcross(a) {
  // source -> how often it was trusted in a disagreement, used as proof, set aside, or only unsupported
  const uses = new Map();
  const use = (source, k) => { const u = uses.get(source) ?? { trusted: 0, proof: 0, aside: 0, weak: 0 }; u[k]++; uses.set(source, u); };
  for (const p of a.points) for (const c of p.sources) use(c.source, c.kept === false ? "aside" : p.label === "conflict" ? "trusted" : "proof");
  for (const u of a.unproven) if (u.source) use(u.source, "weak");
  const role = new Map(); // source -> [rank, text, class]
  for (const [source, u] of uses) {
    const parts = [u.trusted && "Trusted when files disagreed", u.proof && `Used as proof (${plural(u.proof, "point")})`,
      u.aside && "Set aside: disagrees with a more trusted file", u.weak && "Not enough: only a rumour or unsupported"].filter(Boolean);
    const rank = u.trusted ? 4 : u.proof ? 3 : u.aside ? 2 : 1;
    role.set(source, [rank, parts.join(" · "), u.trusted || u.proof ? (u.aside ? "flag" : "ok") : u.aside ? "flag" : "grey"]);
  }
  const rows = info.files.map((f) => {
    const r = f.duplicateOf ? [0, `Identical copy of ${f.duplicateOf}, skipped`, "muted"]
      : role.get(f.source) ?? [0, f.newerVersion ? "Read: older version, not needed here" : "Read: not needed for this question", "muted"];
    const tr = el("tr");
    tr.append(el("td", "", f.source), el("td", "muted", KINDS[f.kind] || f.kind), el("td", r[2], r[1]));
    return { tr, rank: r[0] };
  }).sort((x, y) => y.rank - x.rank);
  $("acrossRows").replaceChildren(...rows.map((r) => r.tr));
  const read = info.files.filter((f) => !f.duplicateOf && !f.error).length;
  const used = [...role.values()].filter((r) => r[0] >= 2).length;
  const kinds = [...new Set(info.files.filter((f) => (role.get(f.source)?.[0] ?? 0) >= 2).map((f) => (KINDS[f.kind] || f.kind).toLowerCase()))];
  $("acrossLede").textContent = `The answer draws on ${used} of the ${read} files in your folder${kinds.length ? ` (${kinds.join(", ")})` : ""}.`;
  $("across").hidden = false;
}

/** Every step with its time and full details (SQL, model receipts), for anyone checking the work. */
function showActivity(a) {
  const start = a.trace.length ? Date.parse(a.trace[0].at) : 0;
  $("activityRows").replaceChildren(...a.trace.map((e) => {
    const w = describe(e);
    const tr = el("tr");
    const details = [e.detail, e.model && `${e.model.served} via Meterless Nightshift · ${e.model.ms} ms${e.model.receiptId ? ` · receipt ${e.model.receiptId}` : ""}`].filter(Boolean).join("\n");
    const detail = el("td", "detail", details);
    detail.style.whiteSpace = "pre-wrap";
    tr.append(el("td", "num", `${((Date.parse(e.at) - start) / 1000).toFixed(1)} s`), el("td", "agent", (AGENTS[e.agent] || e.agent).toUpperCase()),
      el("td", w.bad ? "bad" : w.warn ? "warn" : "", w.text), detail);
    return tr;
  }));
  const calls = a.trace.filter((e) => e.model).length;
  const queries = a.trace.filter((e) => e.agent === "zetaris").length;
  $("activityMeta").textContent = `${plural(a.trace.length, "step")} · ${plural(calls, "model call")} · ${plural(queries, "Zetaris query", "Zetaris queries")} · ${(a.ms / 1000).toFixed(1)} s`;
  $("activity").hidden = false;
}

function showError(message) {
  $("run").classList.remove("running");
  $("waiting").hidden = true;
  const box = el("div", "error-box");
  const text = el("p");
  text.append(el("strong", "", "The question could not be answered. "), message);
  const retry = el("button", "btn btn-secondary", "Try again");
  retry.type = "button";
  retry.onclick = () => submit();
  box.append(text, retry);
  $("points").replaceChildren(box);
}

async function showDoc(name, quote) {
  const data = await (await fetch(`/api/doc?name=${encodeURIComponent(name)}`)).json();
  $("docTitle").textContent = name;
  const pre = $("docText");
  pre.replaceChildren();
  // Highlight the quoted words (whitespace-insensitive) so it's easy to check the claim.
  const words = quote.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const match = words.length ? new RegExp(words.join("\\s+"), "i").exec(data.text || "") : null;
  if (match) {
    pre.append(data.text.slice(0, match.index), el("mark", "", match[0]), data.text.slice(match.index + match[0].length));
  } else pre.textContent = data.text || "";
  $("docDialog").showModal();
  pre.querySelector("mark")?.scrollIntoView({ block: "center" });
}

$("askForm").addEventListener("submit", submit);
// "/" jumps to the question box (except while typing or reading a file).
document.addEventListener("keydown", (e) => {
  if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") || $("docDialog").open) return;
  e.preventDefault();
  $("question").focus();
  $("question").select();
});
init().then(() => {
  // ?q=... asks a question straight away (handy for demos and links).
  const q = new URLSearchParams(location.search).get("q");
  if (q) { $("question").value = q; submit(); }
});
