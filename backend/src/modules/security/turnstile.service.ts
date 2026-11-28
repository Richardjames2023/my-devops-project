import { AppError } from "../../common/errors/AppError";
import { env } from "../../config/env";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const EXPECTED_ACTION = "customer_registration";

type SiteverifyResponse = {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
};

type Siteverify = (
  secret: string,
  token: string,
  remoteIp?: string,
) => Promise<SiteverifyResponse>;

async function requestSiteverify(
  secret: string,
  token: string,
  remoteIp?: string,
): Promise<SiteverifyResponse> {
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  const response = await fetch(SITEVERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) throw new Error(`Turnstile Siteverify returned HTTP ${response.status}`);
  return (await response.json()) as SiteverifyResponse;
}

export function assertTurnstileResponse(
  result: SiteverifyResponse,
  expectedHostnames: string[] = [],
): void {
  if (result.success !== true) {
    throw new AppError("The security check could not be verified. Please try again.", 403);
  }

  if (expectedHostnames.length && (
    !result.hostname ||
    !expectedHostnames.map((hostname) => hostname.toLowerCase()).includes(result.hostname.toLowerCase())
  )) {
    throw new AppError("The security check could not be verified. Please try again.", 403);
  }

  if (result.action !== EXPECTED_ACTION) {
    throw new AppError("The security check could not be verified. Please try again.", 403);
  }
}

export async function verifyCustomerRegistrationTurnstile(
  token: string,
  remoteIp?: string,
): Promise<void> {
  if (!env.TURNSTILE_SECRET_KEY) {
    throw new AppError("Registration security verification is temporarily unavailable", 503);
  }

  let result: SiteverifyResponse;
  try {
    result = await requestSiteverify(env.TURNSTILE_SECRET_KEY, token, remoteIp);
  } catch {
    throw new AppError("Registration security verification is temporarily unavailable", 503);
  }

  const expectedHostnames = env.TURNSTILE_EXPECTED_HOSTNAMES
    ?.split(",")
    .map((hostname) => hostname.trim())
    .filter(Boolean) ?? [];

  assertTurnstileResponse(result, expectedHostnames);
}
