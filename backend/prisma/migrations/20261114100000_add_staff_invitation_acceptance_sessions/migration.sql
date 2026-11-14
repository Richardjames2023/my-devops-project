CREATE TABLE "staff_invitation_acceptance_sessions" (
    "id" UUID NOT NULL,
    "invitationId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "staff_invitation_acceptance_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "staff_invitation_acceptance_sessions_tokenHash_key"
ON "staff_invitation_acceptance_sessions"("tokenHash");

CREATE INDEX "staff_invitation_acceptance_sessions_invitationId_expiresAt_idx"
ON "staff_invitation_acceptance_sessions"("invitationId", "expiresAt");

CREATE INDEX "staff_invitation_acceptance_sessions_expiresAt_consumedAt_revokedAt_idx"
ON "staff_invitation_acceptance_sessions"("expiresAt", "consumedAt", "revokedAt");

ALTER TABLE "staff_invitation_acceptance_sessions"
ADD CONSTRAINT "staff_invitation_acceptance_sessions_invitationId_fkey"
FOREIGN KEY ("invitationId") REFERENCES "staff_invitations"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
