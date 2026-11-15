import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogContext = Record<string, unknown>;

interface RequestLogContext {
  requestId: string;
}

const requestContext = new AsyncLocalStorage<RequestLogContext>();
const levels: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const colors: Record<LogLevel, string> = {
  debug: "\u001b[90m",
  info: "\u001b[36m",
  warn: "\u001b[33m",
  error: "\u001b[31m",
};
const reset = "\u001b[0m";
const sensitiveKey = /password|token|secret|authorization|cookie|api[-_]?key|credential|private[-_]?key/i;

function redactString(value: string): string {
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, "$1[REDACTED]")
    .replace(/([?&#](?:token|access_token|refresh_token|code|secret)=)[^&#\s]*/gi, "$1[REDACTED]")
    .replace(/(#(?:token)=)[^\s]*/gi, "$1[REDACTED]");
}

function sanitize(value: unknown, key = "", seen = new WeakSet<object>()): unknown {
  if (sensitiveKey.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactString(value);
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
    };
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item, "", seen));
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitize(childValue, childKey, seen),
      ]),
    );
  }
  return value;
}

function write(level: LogLevel, message: string, context: LogContext = {}): void {
  const timestamp = new Date().toISOString();
  const requestId = requestContext.getStore()?.requestId;
  const entry = sanitize({
    timestamp,
    level,
    service: "my-devops-project-api",
    environment: process.env.NODE_ENV ?? "development",
    ...(requestId ? { requestId } : {}),
    message,
    ...context,
  }) as Record<string, unknown>;

  if (process.env.NODE_ENV !== "production" && process.stdout.isTTY) {
    const { timestamp: time, level: severity, message: text, ...details } = entry;
    const line = [
      `${colors[level]}${String(severity).toUpperCase().padEnd(5)}${reset}`,
      `\u001b[90m${time}${reset}`,
      String(text),
      Object.keys(details).length ? JSON.stringify(details) : "",
    ].filter(Boolean).join(" ");
    const output = level === "error" ? process.stderr : process.stdout;
    output.write(line + "\n");
    return;
  }

  const line = JSON.stringify(entry);
  const output = level === "error" ? process.stderr : process.stdout;
  output.write(line + "\n");
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
