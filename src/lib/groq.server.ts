import { getSecret } from "@/lib/runtime-secrets.server";
import { getSupabaseAdminEnvStatus } from "@/integrations/supabase/client.server";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

export const DEFAULT_GROQ_TEXT_MODEL = "llama-3.3-70b-versatile";
export const DEFAULT_GROQ_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

type GroqMessage = {
  role: string;
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
};

async function getGroqApiKey() {
  const groqKey = await getSecret("GROQ_API_KEY");
  if (!groqKey) {
    const adminEnv = getSupabaseAdminEnvStatus();
    const vaultNote = adminEnv.ok
      ? "Add GROQ_API_KEY in the Secret Keys page or hosting environment."
      : `The runtime secret vault cannot be read because ${adminEnv.missing.join(", ")} is missing on the server. Add GROQ_API_KEY to hosting env, or add the missing Supabase admin env first so saved runtime secrets can be read.`;
    throw new Error(`AI unavailable. ${vaultNote}`);
  }
  return groqKey;
}

async function groqFetch(body: Record<string, unknown>) {
  const groqKey = await getGroqApiKey();
  return fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${groqKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function readGroqError(response: Response) {
  const text = await response.text().catch(() => "");
  return text.slice(0, 300) || `Groq request failed (${response.status})`;
}

export async function streamGroqChat(messages: GroqMessage[]) {
  const model = (await getSecret("GROQ_MODEL")) || DEFAULT_GROQ_TEXT_MODEL;
  const response = await groqFetch({ model, messages, stream: true });
  if (!response.ok || !response.body) {
    throw new Error(await readGroqError(response));
  }
  return new Response(response.body, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

export async function completeGroqChat(messages: GroqMessage[]) {
  const model = (await getSecret("GROQ_MODEL")) || DEFAULT_GROQ_TEXT_MODEL;
  const response = await groqFetch({ model, messages });
  if (!response.ok) {
    throw new Error(await readGroqError(response));
  }
  const payload = (await response.json()) as any;
  return payload?.choices?.[0]?.message?.content ?? "(no response)";
}

export async function extractGroqJson(messages: GroqMessage[]) {
  const model = (await getSecret("GROQ_VISION_MODEL")) || DEFAULT_GROQ_VISION_MODEL;
  const response = await groqFetch({
    model,
    messages,
    response_format: { type: "json_object" },
  });
  if (!response.ok) {
    throw new Error(await readGroqError(response));
  }
  const payload = (await response.json()) as any;
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Groq did not return structured JSON.");
  }
  return JSON.parse(content);
}
