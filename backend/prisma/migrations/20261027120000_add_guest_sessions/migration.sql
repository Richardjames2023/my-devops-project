
CREATE TABLE "guest_sessions" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guest_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "guest_sessions_tokenHash_key"
ON "guest_sessions"("tokenHash");

CREATE INDEX "guest_sessions_expiresAt_idx"
ON "guest_sessions"("expiresAt");

ALTER TABLE "carts"
ALTER COLUMN "sessionId" TYPE UUID
USING NULLIF("sessionId", '')::UUID;

DROP INDEX IF EXISTS "carts_sessionId_idx";

CREATE UNIQUE INDEX "carts_sessionId_key"
ON "carts"("sessionId");

ALTER TABLE "carts"
ADD CONSTRAINT "carts_sessionId_fkey"
FOREIGN KEY ("sessionId")
REFERENCES "guest_sessions"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "carts"
ADD CONSTRAINT "carts_owner_check"
CHECK (
    NOT ("userId" IS NOT NULL AND "sessionId" IS NOT NULL)
);
