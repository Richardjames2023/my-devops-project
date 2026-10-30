
import crypto from "node:crypto";
import prisma from "../../infrastructure/prisma/client";

const GUEST_SESSION_TTL_DAYS = 30;

export function generateGuestSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashGuestSessionToken(token: string): string {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

export async function createGuestSession() {
  const token = generateGuestSessionToken();
  const tokenHash = hashGuestSessionToken(token);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + GUEST_SESSION_TTL_DAYS);

  const session = await prisma.guestSession.create({
    data: {
      tokenHash,
      expiresAt,
    },
    select: {
      id: true,
      expiresAt: true,
    },
  });

  return {
    session,
    token,
  };
}

export async function getValidGuestSession(token: string) {
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return null;
  }

  const tokenHash = hashGuestSessionToken(token);

  return prisma.guestSession.findFirst({
    where: {
      tokenHash,
      revokedAt: null,
      expiresAt: {
        gt: new Date(),
      },
    },
    select: {
      id: true,
      expiresAt: true,
    },
  });
}

export async function revokeGuestSession(token: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return;
  }

  const tokenHash = hashGuestSessionToken(token);

  await prisma.guestSession.updateMany({
    where: {
      tokenHash,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });
}
