import { env } from "./env";

export const JWT_ACCESS_SECRET = env.JWT_ACCESS_SECRET;

export const ACCESS_TOKEN_EXPIRES_IN = "15m";

export const REFRESH_TOKEN_EXPIRES_IN_DAYS = 30;