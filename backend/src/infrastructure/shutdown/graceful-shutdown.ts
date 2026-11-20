export type StopJob = () => Promise<void>;

export interface GracefulShutdownLogger {
  info(message: string, context?: Record<string, unknown>): void;
  error(
    message: string,
    error?: unknown,
    context?: Record<string, unknown>,
  ): void;
}

export interface GracefulShutdownOptions {
  /** Stop accepting realtime connections and disconnect existing sockets. */
  stopRealtimeServer?: () => void;
  closeServer: () => Promise<void>;
  closeAllConnections?: () => void;
  stopJobs: StopJob[];
  disconnectDatabase: () => Promise<void>;
  timeoutMs: number;
  logger: GracefulShutdownLogger;
  exit: (code: number) => void;
}

/**
 * Stops realtime connections first, then drains active HTTP/job work, and
 * only then disconnects Prisma. The deadline prevents a stuck server or
 * worker from hanging shutdown.
 */
export async function runGracefulShutdown({
  stopRealtimeServer,
  closeServer,
  closeAllConnections,
  stopJobs,
  disconnectDatabase,
  timeoutMs,
  logger,
  exit,
}: GracefulShutdownOptions): Promise<void> {
  let timedOut = false;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<void>((resolve) => {
    deadlineTimer = setTimeout(() => {
      timedOut = true;
      logger.error("Graceful shutdown deadline exceeded; forcing process exit", undefined, {
        timeoutMs,
      });
      closeAllConnections?.();
      exit(1);
      resolve();
    }, timeoutMs);
  });

  const drain = (async () => {
    try {
      let realtimeError: unknown;
      try {
        // Prevent new socket work before the HTTP server begins draining.
        stopRealtimeServer?.();
      } catch (error) {
        realtimeError = error;
        logger.error("Realtime server did not stop cleanly", error);
      }

      // Stop future job ticks and drain HTTP requests / active jobs concurrently.
      const results = await Promise.allSettled([
        closeServer(),
        ...stopJobs.map((stop) => stop()),
      ]);

      if (timedOut) return;

      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (realtimeError !== undefined) errors.unshift(realtimeError);
      for (const error of errors) {
        logger.error("Server or background job did not stop cleanly", error);
      }

      // Never disconnect Prisma while HTTP requests or jobs are still running.
      await disconnectDatabase();
      if (timedOut) return;

      if (errors.length > 0) {
        throw new Error("One or more server shutdown tasks failed");
      }

      logger.info("Server shutdown complete");
      exit(0);
    } catch (error) {
      if (!timedOut) {
        logger.error("Server shutdown failed", error);
        exit(1);
      }
    }
  })();

  try {
    await Promise.race([drain, deadline]);
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }
}
