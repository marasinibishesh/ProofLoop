// Proofloop page: sends the question to /api/ask and shows the answer, its evidence and the agents' trace.
// All text from documents is inserted with textContent, never as HTML.

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const LABELS = { confirmed: "Confirmed", conflict: "Conflict", "not-proven": "Not proven" };

async function init() {
  const info = await (await fetch("/api/info")).json();
  const status = $("status");
  status.append(
    el("span", "pill" + (info.live.model ? "" : " sample"), info.live.model ? "Model: Nemotron via Nightshift" : "Model: sample mode"),
    el("span", "pill" + (info.live.data ? "" : " sample"), info.live.data ? "Data: Zetaris" : "Data: local sample files"),
    el("span", "pill", "Memory: H-MEM · Graph: World Model"),
  );
  for (const q of info.questions) {
    const chip = el("button", "chip", q.question);
    chip.type = "button";
    chip.onclick = () => { $("question").value = q.question; submit(); };
    $("examples").append(chip);
  }
  if (info.voice) {
    status.append(el("span", "pill", "Voice: ElevenLabs"));
    $("micBtn").hidden = false;
  }
  $("docs").textContent = info.docs.length ? `Searching ${info.docs.length} documents: ${info.docs.join(", ")}` : "";
}

// Set when the current question came from the mic, so the trace can show the transcription step.
let voiceMs;

async function submit(event) {
  event?.preventDefault();
  if (event) voiceMs = undefined; // typed and sent by hand
  const question = $("question").value.trim();
  if (!question) return;
  $("askBtn").disabled = true;
  $("working").hidden = false;
  $("result").hidden = true;
  try {
    const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, voiceMs }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    render(data);
  } catch (e) {
    $("points").replaceChildren(el("p", "note", `Something went wrong: ${e.message}`));
    $("result").hidden = false;
  } finally {
    $("askBtn").disabled = false;
    $("working").hidden = true;
    voiceMs = undefined;
  }
}

// Optional voice input: click the mic, speak, click again. ElevenLabs only turns the audio into text;
// the question then goes through the same agents as a typed one.
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

function citeBlock(c) {
  const box = el("div", "cite" + (c.kept === false ? " superseded" : ""));
  box.append(el("div", "quote", `“${c.quote}”`));
  const meta = el("div", "meta");
  const open = el("button", "", c.source);
  open.type = "button";
  open.onclick = () => showDoc(c.source, c.quote);
  const bar = el("span", "bar");
  const fill = el("span");
  fill.style.width = `${Math.round(c.confidence * 100)}%`;
  bar.append(fill);
  meta.append(open, bar, el("span", "", `${Math.round(c.confidence * 100)}% · ${c.reason}`));
  if (c.kept === false) meta.append(el("span", "reject", "superseded"));
  box.append(meta);
  return box;
}

function render(a) {
  const points = $("points");
  points.replaceChildren();
  if (a.points.length === 0 && a.unproven.length === 0) points.append(el("p", "empty", "Nothing in your documents answers this, so Proofloop won't guess."));
  for (const p of a.points) {
    const card = el("div", `point ${p.label}`);
    const head = el("div", "head");
    head.append(el("span", `label ${p.label}`, LABELS[p.label]), el("span", "statement", p.statement));
    card.append(head);
    if (p.note) card.append(el("p", "note", p.note));
    for (const c of p.sources) card.append(citeBlock(c));
    points.append(card);
  }

  const unproven = $("unproven");
  unproven.replaceChildren();
  for (const u of a.unproven) {
    const card = el("div", "point not-proven");
    const head = el("div", "head");
    head.append(el("span", "label not-proven", LABELS["not-proven"]), el("span", "statement", u.statement));
    card.append(head, el("p", "note", u.reason));
    unproven.append(card);
  }

  $("plan").replaceChildren(...a.subQuestions.map((s) => el("li", "", s.text)));
  $("memory").replaceChildren(...(a.memory.length ? a.memory.map((m) => el("li", "", m)) : [el("li", "empty", "Nothing yet. Ask again later and it remembers.")]));

  $("trace").replaceChildren(...a.trace.map((t) => {
    const li = el("li");
    const body = el("div");
    body.append(el("div", t.action.startsWith("reject") || t.action === "send back" ? "reject" : "", t.action + (t.detail ? `: ${t.detail}` : "")));
    if (t.model) body.append(el("span", "model", `${t.model.served}${t.model.routed && t.model.routed !== t.model.served ? ` → ${t.model.routed}` : ""} · ${t.model.ms} ms${t.model.receiptId ? ` · receipt ${t.model.receiptId}` : ""}`));
    li.append(el("span", `agent ${t.agent}`, t.agent.replace("-", " ")), body);
    return li;
  }));
  $("traceCount").textContent = `(${a.trace.length} steps · ${a.mode.model} · ${a.mode.data} · ${a.ms} ms)`;
  $("result").hidden = false;
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
    pre.append(data.text.slice(0, match.index));
    pre.append(el("mark", "", match[0]));
    pre.append(data.text.slice(match.index + match[0].length));
  } else pre.textContent = data.text || "";
  $("docDialog").showModal();
  pre.querySelector("mark")?.scrollIntoView({ block: "center" });
}

$("askForm").addEventListener("submit", submit);
init().then(() => {
  // ?q=... asks a question straight away (handy for demos and links).
  const q = new URLSearchParams(location.search).get("q");
  if (q) { $("question").value = q; submit(); }
});
