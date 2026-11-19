export type ChatAiHistoryRole = "CUSTOMER" | "BOT";

export interface ChatAiHistoryMessage {
  role: ChatAiHistoryRole;
  content: string;
}

export interface ChatAiGenerateInput {
  message: string;
  history: ChatAiHistoryMessage[];
  knowledgeContext: string;
}

export interface ChatAiHandoffRecommendation {
  recommended: boolean;
  reason: string | null;
}

export interface ChatAiGenerateResult {
  reply: string;
  handoff: ChatAiHandoffRecommendation;
}

export interface ChatAiProvider {
  readonly name: string;

  generateReply(
    input: ChatAiGenerateInput,
  ): Promise<ChatAiGenerateResult>;
}