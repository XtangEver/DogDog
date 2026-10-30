import type { ModelProtocol } from "./types";

export const protocolLabels: Record<ModelProtocol, string> = {
  "openai-responses": "OpenAI Responses",
  anthropic: "Claude / Anthropic Messages",
  "openai-chat": "OpenAI Chat Completions（兼容旧配置）",
};

// Only infer the protocol for settings saved before a protocol field existed.
// The endpoint itself is never rewritten.
export function inferLegacyProtocol(endpoint: string): ModelProtocol {
  try {
    const path = new URL(endpoint).pathname.replace(/\/+$/, "");
    if (path.endsWith("/messages")) return "anthropic";
    if (path.endsWith("/chat/completions")) return "openai-chat";
  } catch {
    // Empty settings use Responses by default; URL validation happens on save.
  }
  return "openai-responses";
}
