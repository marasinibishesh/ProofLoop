// Optional voice input: ElevenLabs Speech-to-Text turns a spoken question into text.
// It only transcribes; all reasoning still runs on Nemotron through Meterless Nightshift.
// Audio is sent only when the user presses the mic button, and nothing is stored.

import { config } from "../config.ts";

export const STT_MODEL = "scribe_v2";

export async function transcribe(audio: Buffer, contentType: string): Promise<{ text: string; ms: number }> {
  if (!config.elevenlabs) throw new Error("Voice is not configured (set ELEVENLABS_API_KEY in .env)");
  const started = Date.now();
  const ext = contentType.includes("mp4") ? "m4a" : contentType.includes("ogg") ? "ogg" : contentType.includes("wav") ? "wav" : "webm";
  const form = new FormData();
  form.append("model_id", STT_MODEL);
  form.append("file", new Blob([new Uint8Array(audio)], { type: contentType || "audio/webm" }), `question.${ext}`);
  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": config.elevenlabs.apiKey },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(res.status === 401 ? "ElevenLabs rejected the API key." : `ElevenLabs ${res.status}: ${detail}`);
  }
  const body = (await res.json()) as { text?: string };
  return { text: (body.text ?? "").trim(), ms: Date.now() - started };
}
