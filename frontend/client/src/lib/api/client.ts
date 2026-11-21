const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5000/api/v1"
).replace(/\/+$/, "");

type ApiErrorPayload = {
  message?: string;
  errors?: unknown;
};

export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

// Access tokens deliberately remain in memory. Do not persist bearer or refresh
// tokens in localStorage/sessionStorage. A server-side session/BFF is the next
// auth integration step for securely retaining refresh tokens across reloads.
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

type ApiRequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  authenticated?: boolean;
};

export async function apiRequest<T>(
  path: `/${string}`,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { body, authenticated = false, headers: suppliedHeaders, ...requestOptions } = options;
  const headers = new Headers(suppliedHeaders);

  if (body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (authenticated) {
    if (!accessToken) {
      throw new ApiError("Your session has expired. Please sign in again.", 401);
    }
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...requestOptions,
    headers,
    credentials: "include",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const payload: unknown = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const errorPayload =
      typeof payload === "object" && payload !== null
        ? (payload as ApiErrorPayload)
        : undefined;
    const message =
      errorPayload?.message ??
      (typeof payload === "string" && payload.length > 0
        ? payload
        : "The request could not be completed.");

    throw new ApiError(message, response.status, errorPayload?.errors);
  }

  return payload as T;
}
