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

export interface ChatAiTokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export class ChatAiProviderResponseError extends Error {
  constructor(
    message: string,
    readonly usage: ChatAiTokenUsage,
  ) {
    super(message);
    this.name = "ChatAiProviderResponseError";
  }
}

export interface ChatAiGenerateResult {
  reply: string;
  handoff: ChatAiHandoffRecommendation;
  usage: ChatAiTokenUsage;
}

export interface ChatAiProvider {
  readonly name: string;
  readonly model: string;

  generateReply(
    input: ChatAiGenerateInput,
  ): Promise<ChatAiGenerateResult>;
}