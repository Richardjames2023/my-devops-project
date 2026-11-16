import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogContext = Record<string, unknown>;

interface RequestLogContext {
  requestId: string;
}

const requestContext = new AsyncLocalStorage<RequestLogContext>();
const sensitiveKey = /password|passphrase|token|secret|authorization|cookie|api[-_]?key|credential|private[-_]?key|signature|session/i;
const sensitiveQueryKey = /^(?:token|access_token|refresh_token|id_token|code|secret|password|signature|sig|key|api_key|session)$/i;
const MAX_LOG_DEPTH = 8;

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value).toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

function redactString(value: string): string {
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, "$1[REDACTED]")
    .replace(/([?&#])([^=&#\s]+)=([^&#\s]*)/g, (match, separator: string, key: string) =>
      sensitiveQueryKey.test(decodeURIComponentSafe(key))
        ? separator + key + "=[REDACTED]"
        : match,
    )
    .replace(/(#(?:token)=)[^\s]*/gi, "$1[REDACTED]");
}

function sanitize(
  value: unknown,
  key = "",
  seen = new WeakSet<object>(),
  depth = 0,
): unknown {
  if (sensitiveKey.test(key)) return "[REDACTED]";
  if (depth > MAX_LOG_DEPTH) return "[MaxDepth]";
  if (typeof value === "string") return redactString(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return "[Function]";
  if (typeof value === "symbol") return String(value);
  if (value instanceof Error) {
    const code = "code" in value && typeof value.code === "string" && /^[A-Z0-9_.-]{1,64}$/i.test(value.code)
      ? value.code
      : undefined;
    return {
      name: redactString(value.name || "Error"),
      ...(code ? { code } : {}),
      ...(value.cause !== undefined ? { cause: sanitize(value.cause, "cause", seen, depth + 1) } : {}),
    };
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "[InvalidDate]" : value.toISOString();
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return "[Buffer]";
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return value.map((item) => sanitize(item, "", seen, depth + 1));
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    try {
      return Object.fromEntries(
        Object.entries(value).map(([childKey, childValue]) => [
          childKey,
          sanitize(childValue, childKey, seen, depth + 1),
        ]),
      );
    } catch {
      return "[Unserializable]";
    }
  }
  return value;
}

function safeWrite(output: NodeJS.WriteStream, line: string): void {
  try {
    output.write(line + "\n");
  } catch {
    // Logging must never break the request or background operation being logged.
  }
}

function write(level: LogLevel, message: string, context: LogContext = {}): void {
  const output = level === "error" ? process.stderr : process.stdout;
  try {
    const requestId = requestContext.getStore()?.requestId;
    const entry = sanitize({
      ...context,
      timestamp: new Date().toISOString(),
      level,
      service: "my-devops-project-api",
      environment: process.env.NODE_ENV ?? "development",
      // Always overwrite caller-supplied request IDs. Undefined is omitted by JSON.stringify.
      requestId: requestId ?? undefined,
      message,
    }) as Record<string, unknown>;
    safeWrite(output, JSON.stringify(entry));
  } catch {
    safeWrite(output, JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: "my-devops-project-api",
      environment: process.env.NODE_ENV ?? "development",
      message: "Log entry could not be serialized",
    }));
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) => write("debug", message, context),
  info: (message: string, context?: LogContext) => write("info", message, context),
  warn: (message: string, context?: LogContext) => write("warn", message, context),
  error: (message: string, error?: unknown, context: LogContext = {}) =>
    write("error", message, { ...context, ...(error === undefined ? {} : { error }) }),
};

export function runWithRequestContext<T>(requestId: string, callback: () => T): T {
  return requestContext.run({ requestId }, callback);
}

export function createOperationId(): string {
  return randomUUID();
}
