import crypto from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import { env } from "../../config/env";
import { hashPassword } from "../../common/utils/password";
import { generateAccessToken } from "../../common/utils/jwt";
import { generateRefreshToken, hashRefreshToken } from "../../common/utils/refreshToken";
import { REFRESH_TOKEN_EXPIRES_IN_DAYS } from "../../config/auth";

type Provider = "GOOGLE" | "FACEBOOK";
type Profile = { provider: Provider; providerUserId: string; email: string; firstName: string; lastName: string; emailVerified: boolean };

const googleClient = new OAuth2Client();

async function verifyGoogleCredential(credential: string): Promise<Profile> {
  if (!env.GOOGLE_CLIENT_ID) throw new AppError("Google sign-in is not configured", 503);
  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: env.GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    throw new AppError("Invalid Google credential", 401);
  }
  if (!payload?.sub || !payload.email || payload.email_verified !== true) {
    throw new AppError("Google did not provide a verified email address", 401);
  }
  const names = (payload.name ?? "").trim().split(/\s+/);
  return {
    provider: "GOOGLE",
    providerUserId: payload.sub,
    email: payload.email.toLowerCase(),
    firstName: payload.given_name ?? names[0] ?? "Customer",
    lastName: payload.family_name ?? names.slice(1).join(" ") ?? "",
    emailVerified: true,
  };
}

async function verifyFacebookCredential(accessToken: string): Promise<Profile> {
  if (!env.FACEBOOK_APP_ID || !env.FACEBOOK_APP_SECRET) {
    throw new AppError("Facebook sign-in is not configured", 503);
  }
  const appToken = `${env.FACEBOOK_APP_ID}|${env.FACEBOOK_APP_SECRET}`;
  const debugUrl = new URL("https://graph.facebook.com/v27.0/debug_token");
  debugUrl.searchParams.set("input_token", accessToken);
  debugUrl.searchParams.set("access_token", appToken);
  let debug: any;
  try {
    const response = await fetch(debugUrl, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error("Token inspection failed");
    debug = await response.json();
  } catch {
    throw new AppError("Unable to verify Facebook credential", 502);
  }
  const token = debug?.data;
  if (!token?.is_valid || token.app_id !== env.FACEBOOK_APP_ID || typeof token.user_id !== "string") {
    throw new AppError("Invalid Facebook credential", 401);
  }

  const profileUrl = new URL("https://graph.facebook.com/v27.0/me");
  profileUrl.searchParams.set("fields", "id,first_name,last_name,name,email");
  profileUrl.searchParams.set("access_token", accessToken);
  let profile: any;
  try {
    const response = await fetch(profileUrl, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error("Profile request failed");
    profile = await response.json();
  } catch {
    throw new AppError("Unable to retrieve Facebook profile", 502);
  }
  if (profile?.id !== token.user_id || typeof profile.email !== "string" || !profile.email.includes("@")) {
    throw new AppError("Facebook must provide an email address to create or access your account", 400);
  }
  const fallbackNames = String(profile.name ?? "").trim().split(/\s+/);
  return {
    provider: "FACEBOOK",
    providerUserId: profile.id,
    email: profile.email.toLowerCase(),
    firstName: profile.first_name ?? fallbackNames[0] ?? "Customer",
    lastName: profile.last_name ?? fallbackNames.slice(1).join(" "),
    // Meta's email field is returned only when the email permission is granted.
    emailVerified: true,
  };
}

async function issueCustomerSession(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { userRoles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
  });
  if (!user || !user.isActive) throw new AppError("Account is inactive or unavailable", 403);
  const roles = user.userRoles.map(({ role }) => role.name);
  if (!roles.includes("CUSTOMER")) throw new AppError("This identity is not a customer account", 403);
  const permissions = [...new Set(user.userRoles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.name)))];
  const accessToken = generateAccessToken({ sub: user.id, identityType: "CUSTOMER", sessionVersion: user.sessionVersion, roles, permissions });
  const refreshToken = generateRefreshToken();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${user.id}::text, 0))`;
    const current = await tx.user.findUnique({ where: { id: user.id }, select: { isActive: true, sessionVersion: true } });
    if (!current?.isActive || current.sessionVersion !== user.sessionVersion) throw new AppError("Account security state changed. Please try again.", 401);
    await tx.refreshToken.create({ data: { userId: user.id, familyId: crypto.randomUUID(), tokenHash: hashRefreshToken(refreshToken), expiresAt } });
  });
  return {
    accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, phone: user.phone, emailVerified: user.emailVerified, roles, permissions },
  };
}

export async function authenticateWithGoogle(credential: string) {
  return authenticateProvider(await verifyGoogleCredential(credential));
}

export async function authenticateWithFacebook(accessToken: string) {
  return authenticateProvider(await verifyFacebookCredential(accessToken));
}

async function authenticateProvider(profile: Profile) {
  const existingIdentity = await prisma.socialAccount.findUnique({
    where: { provider_providerUserId: { provider: profile.provider, providerUserId: profile.providerUserId } },
    select: { userId: true },
  });
  if (existingIdentity) return issueCustomerSession(existingIdentity.userId);

  const existingEmail = await prisma.user.findUnique({ where: { email: profile.email }, select: { id: true } });
  if (existingEmail) {
    throw new AppError("An account already exists with this email. Sign in with your password first, then connect this provider from your account security settings.", 409);
  }
  const role = await prisma.role.findUnique({ where: { name: "CUSTOMER" }, select: { id: true } });
  if (!role) throw new AppError("Customer role is not configured", 500, false);
  const randomPassword = crypto.randomBytes(48).toString("base64url");
  const passwordHash = await hashPassword(randomPassword);
  let userId: string;
  try {
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: profile.email,
          passwordHash,
          firstName: profile.firstName || "Customer",
          lastName: profile.lastName || "",
          emailVerified: profile.emailVerified,
          userRoles: { create: { roleId: role.id } },
          socialAccounts: { create: { provider: profile.provider, providerUserId: profile.providerUserId } },
        },
        select: { id: true },
      });
      return created;
    });
    userId = user.id;
  } catch (error) {
    // A concurrent first login may have created the same email or provider identity.
    const racedIdentity = await prisma.socialAccount.findUnique({
      where: { provider_providerUserId: { provider: profile.provider, providerUserId: profile.providerUserId } },
      select: { userId: true },
    });
    if (racedIdentity) return issueCustomerSession(racedIdentity.userId);
    throw error;
  }
  return issueCustomerSession(userId);
}
