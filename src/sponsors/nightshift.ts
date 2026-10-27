// Meterless Nightshift: the primary AI provider. Every model call in Proofloop goes through here.
// Nightshift exposes an OpenAI-compatible endpoint; NVIDIA keys live in its Providers tab, not in this app.
// Each response carries a routing receipt (`meterless` object) that we log, so the trace shows which
// model really answered.

import OpenAI from "openai";
import { config } from "../config.ts";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ModelReceipt = {
  requestedModel: string;
  servedModel: string;
  routedModel?: string;
  provider?: string;
  receiptId?: string;
  ms: number;
};

let client: OpenAI | undefined;

function getClient(): OpenAI {
  if (!config.nightshift) throw new Error("Nightshift is not configured (set METERLESS_BASE_URL and METERLESS_RUNTIME_TOKEN)");
  client ??= new OpenAI({
    baseURL: config.nightshift.baseUrl,
    apiKey: config.nightshift.token,
    defaultHeaders: { "meterless-app": config.nightshift.app, "meterless-scope": "user" },
    timeout: 180_000,
  });
  return client;
}

/** Lists the model ids Nightshift currently serves (GET /v1/models). */
export async function listModels(): Promise<string[]> {
  const page = await getClient().models.list();
  return page.data.map((m) => m.id);
}

/** One chat call through Nightshift. Returns the text and the routing receipt for the trace. */
export async function chat(messages: ChatMessage[], opts: { model?: string; json?: boolean; thinking?: boolean } = {}): Promise<{ text: string; receipt: ModelReceipt }> {
  const requestedModel = opts.model ?? config.nightshift!.model;
  const started = Date.now();
  const resp = await getClient().chat.completions.create({
    model: requestedModel,
    messages,
    ...(opts.json ? { response_format: { type: "json_object" as const } } : {}),
    // Same input, same answer: Proofloop proves things, so it should not vary from run to run.
    temperature: 0,
    // Nemotron reasons before answering unless told not to; Nightshift passes this through to the model.
    ...((opts.thinking ?? true) ? {} : { chat_template_kwargs: { enable_thinking: false } }),
  } as OpenAI.ChatCompletionCreateParamsNonStreaming);
  const meterless = ((resp as unknown as Record<string, unknown>).meterless ?? {}) as Record<string, any>;
  return {
    text: resp.choices[0]?.message?.content ?? "",
    receipt: {
      requestedModel,
      servedModel: resp.model,
      routedModel: meterless.routed_model,
      provider: meterless.winning_route?.provider,
      receiptId: meterless.receipt_id,
      ms: Date.now() - started,
    },
  };
}
