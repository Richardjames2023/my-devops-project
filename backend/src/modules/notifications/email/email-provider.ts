export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}

export interface EmailProvider {
  send(input: SendEmailInput): Promise<{ messageId: string }>;
}

export class EmailProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "EmailProviderError";
  }
}

export interface ResendProviderConfig {
  apiKey: string;
  from: string;
  timeoutMs?: number;
}

export function createResendEmailProvider(
  config: ResendProviderConfig,
  fetchImplementation: typeof fetch = fetch,
): EmailProvider {
  return {
    async send(input) {
      let response: Response;
      try {
        response = await fetchImplementation("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": input.idempotencyKey,
          },
          body: JSON.stringify({
            from: config.from,
            to: [input.to],
            subject: input.subject,
            html: input.html,
            text: input.text,
          }),
          signal: AbortSignal.timeout(config.timeoutMs ?? 10_000),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown network error";
        throw new EmailProviderError("Resend request failed: " + message, true);
      }

      const responseBody: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const body = responseBody && typeof responseBody === "object"
          ? responseBody as { message?: unknown; name?: unknown }
          : {};
        const detail = typeof body.message === "string"
          ? body.message
          : typeof body.name === "string" ? body.name : "Resend rejected the request";
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        throw new EmailProviderError(
          `Resend API error (${response.status}): ${detail}`,
          retryable,
          response.status,
        );
      }

      const data = responseBody && typeof responseBody === "object"
        ? responseBody as { id?: unknown }
        : {};
      if (typeof data.id !== "string" || !data.id.trim()) {
        throw new EmailProviderError("Resend returned a successful response without a message ID", true);
      }
      return { messageId: data.id };
    },
  };
}
