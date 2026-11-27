import { z } from "zod";

export const googleCredentialSchema = z.object({
  credential: z.string().min(20).max(10_000),
});

export const facebookAccessTokenSchema = z.object({
  accessToken: z.string().min(20).max(10_000),
});
