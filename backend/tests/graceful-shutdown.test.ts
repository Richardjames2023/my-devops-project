import { afterEach, describe, expect, it, vi } from "vitest";
import { runGracefulShutdown, type GracefulShutdownLogger } from "../src/infrastructure/shutdown/graceful-shutdown";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createLogger(): GracefulShutdownLogger {
  return {
    info: vi.fn(),
    error: vi.fn(),
  };
}

describe("graceful server shutdown", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stops realtime sockets before draining HTTP requests and jobs", async () => {
    const order: string[] = [];
    const stopRealtimeServer = vi.fn(() => { order.push("realtime"); });
    const closeServer = vi.fn(async () => { order.push("http"); });
    const stopJob = vi.fn(async () => { order.push("jobs"); });
    const disconnectDatabase = vi.fn(async () => { order.push("database"); });

    await runGracefulShutdown({
      stopRealtimeServer,
      closeServer,
      stopJobs: [stopJob],
      disconnectDatabase,
      timeoutMs: 10_000,
      logger: createLogger(),
      exit: vi.fn(),
    });

    expect(order).toEqual(["realtime", "http", "jobs", "database"]);
    expect(stopRealtimeServer).toHaveBeenCalledOnce();
  });

  it("waits for active HTTP requests and jobs before disconnecting the database", async () => {
    const httpDrain = deferred();
    const jobDrain = deferred();
    const logger = createLogger();
    const closeServer = vi.fn(() => httpDrain.promise);
    const stopJob = vi.fn(() => jobDrain.promise);
    const disconnectDatabase = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();

    const shutdown = runGracefulShutdown({
      closeServer,
      stopJobs: [stopJob],
      disconnectDatabase,
      timeoutMs: 10_000,
      logger,
      exit,
    });

    expect(closeServer).toHaveBeenCalledOnce();
    expect(stopJob).toHaveBeenCalledOnce();
    expect(disconnectDatabase).not.toHaveBeenCalled();

    httpDrain.resolve();
    await Promise.resolve();
    expect(disconnectDatabase).not.toHaveBeenCalled();

    jobDrain.resolve();
    await shutdown;

    expect(disconnectDatabase).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
    expect(logger.info).toHaveBeenCalledWith("Server shutdown complete");
  });

  it("forces shutdown at the deadline without disconnecting while work is still active", async () => {
    vi.useFakeTimers();
    const httpDrain = deferred();
    const closeAllConnections = vi.fn();
    const disconnectDatabase = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const logger = createLogger();

    const shutdown = runGracefulShutdown({
      closeServer: () => httpDrain.promise,
      closeAllConnections,
      stopJobs: [vi.fn().mockResolvedValue(undefined)],
      disconnectDatabase,
      timeoutMs: 250,
      logger,
      exit,
    });

    await vi.advanceTimersByTimeAsync(250);
    await shutdown;

    expect(closeAllConnections).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(1);
    expect(disconnectDatabase).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "Graceful shutdown deadline exceeded; forcing process exit",
      undefined,
      { timeoutMs: 250 },
    );

    // If the outstanding request eventually settles, it must not trigger a
    // late database disconnect or a second process exit.
    httpDrain.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(disconnectDatabase).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledOnce();
  });

  it("disconnects the database after drains settle but exits with an error if a drain failed", async () => {
    const logger = createLogger();
    const exit = vi.fn();
    const disconnectDatabase = vi.fn().mockResolvedValue(undefined);

    await runGracefulShutdown({
      closeServer: () => Promise.reject(new Error("HTTP close failed")),
      stopJobs: [vi.fn().mockResolvedValue(undefined)],
      disconnectDatabase,
      timeoutMs: 10_000,
      logger,
      exit,
    });

    expect(disconnectDatabase).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(
      "Server or background job did not stop cleanly",
      expect.any(Error),
    );
    expect(logger.error).toHaveBeenCalledWith(
      "Server shutdown failed",
      expect.any(Error),
    );
  });

  it("exits with an error when the database disconnect fails", async () => {
    const logger = createLogger();
    const exit = vi.fn();

    await runGracefulShutdown({
      closeServer: vi.fn().mockResolvedValue(undefined),
      stopJobs: [],
      disconnectDatabase: vi.fn().mockRejectedValue(new Error("Database disconnect failed")),
      timeoutMs: 10_000,
      logger,
      exit,
    });

    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(
      "Server shutdown failed",
      expect.any(Error),
    );
  });
});
