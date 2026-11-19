import { z } from "zod";

export const chatAiResponseSchema = z.object({
  reply: z.string().trim().min(1).max(4_000),
  handoff: z.object({
    recommended: z.boolean(),
    reason: z.string().trim().max(500).nullable(),
  }).strict(),
}).strict();

export type ValidatedChatAiResponse = z.infer<
  typeof chatAiResponseSchema
>;

export function parseChatAiResponse(
  response: string | undefined,
): ValidatedChatAiResponse {
  if (!response) {
    throw new Error("AI provider returned an empty response");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(response);
  } catch {
    throw new Error("AI provider returned invalid JSON");
  }

  return chatAiResponseSchema.parse(parsed);
}