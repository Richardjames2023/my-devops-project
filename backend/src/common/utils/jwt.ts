import jwt from "jsonwebtoken";
import {
  JWT_ACCESS_SECRET,
  ACCESS_TOKEN_EXPIRES_IN,
} from "../../config/auth";

export interface AccessTokenPayload {
  sub: string;
  roles: string[];
  permissions: string[];
}

export function generateAccessToken(
  payload: AccessTokenPayload,
): string {
  return jwt.sign(payload, JWT_ACCESS_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
  });
}