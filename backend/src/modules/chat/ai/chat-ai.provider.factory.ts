
import { env } from "../../../config/env";
import { GeminiChatAiProvider } from "./gemini-chat-ai.provider";
import type { ChatAiProvider } from "./chat-ai.types";

export function createChatAiProvider(): ChatAiProvider | null {
  if (!env.CHAT_AI_ENABLED) {
    return null;
  }

  if (env.CHAT_AI_PROVIDER === "gemini") {
    if (!env.GEMINI_API_KEY) {
      throw new Error(
        "Gemini API key is required when chat AI is enabled",
      );
    }

    return new GeminiChatAiProvider(
        env.GEMINI_API_KEY,
        env.GEMINI_MODEL,
        env.CHAT_AI_MAX_OUTPUT_TOKENS,
        env.CHAT_AI_TIMEOUT_MS,
        env.CHAT_AI_MAX_HISTORY_MESSAGES,
    );
  }

  return null;
}
