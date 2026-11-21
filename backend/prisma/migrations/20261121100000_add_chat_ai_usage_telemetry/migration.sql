CREATE TABLE "chat_ai_usage" (
  "id" UUID NOT NULL,
  "generation_id" UUID NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "provider" VARCHAR(50) NOT NULL,
  "model" VARCHAR(120) NOT NULL,
  "outcome" VARCHAR(30) NOT NULL,
  "persistence_status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "total_tokens" INTEGER,
  "input_cost_usd" DECIMAL(20,12),
  "output_cost_usd" DECIMAL(20,12),
  "total_cost_usd" DECIMAL(20,12),
  "pricing_version" VARCHAR(100),
  "duration_ms" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_ai_usage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chat_ai_usage_generation_id_fkey"
    FOREIGN KEY ("generation_id") REFERENCES "chat_ai_generations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "chat_ai_usage_outcome_check"
    CHECK ("outcome" IN ('SUCCEEDED', 'FAILED')),
  CONSTRAINT "chat_ai_usage_persistence_status_check"
    CHECK ("persistence_status" IN ('PENDING', 'PERSISTED', 'DISCARDED', 'FAILED')),
  CONSTRAINT "chat_ai_usage_tokens_nonnegative_check"
    CHECK (
      ("input_tokens" IS NULL OR "input_tokens" >= 0) AND
      ("output_tokens" IS NULL OR "output_tokens" >= 0) AND
      ("total_tokens" IS NULL OR "total_tokens" >= 0)
    ),
  CONSTRAINT "chat_ai_usage_duration_nonnegative_check"
    CHECK ("duration_ms" >= 0)
);

CREATE UNIQUE INDEX "chat_ai_usage_generation_id_attempt_number_key"
ON "chat_ai_usage"("generation_id", "attempt_number");

CREATE INDEX "chat_ai_usage_created_at_provider_model_idx"
ON "chat_ai_usage"("created_at", "provider", "model");

CREATE INDEX "chat_ai_usage_outcome_created_at_idx"
ON "chat_ai_usage"("outcome", "created_at");
