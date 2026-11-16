import { logger } from "../../config/logger";

export type StopJob = () => Promise<void>;

interface PeriodicJobOptions {
  runImmediately?: boolean;
  unref?: boolean;
}

export function startPeriodicJob(
  name: string,
  intervalMs: number,
  task: () => Promise<void>,
  options: PeriodicJobOptions = {},
): StopJob {
  let activeRun: Promise<void> | undefined;
  let stopped = false;

  const run = (): Promise<void> => {
    if (stopped || activeRun) return activeRun ?? Promise.resolve();
    activeRun = (async () => {
      try {
        await task();
      } catch (error) {
        logger.error("Background job execution failed", error, { job: name });
      } finally {
        activeRun = undefined;
      }
    })();
    return activeRun;
  };

  const timer = setInterval(() => { void run(); }, intervalMs);
  if (options.unref) timer.unref();

  logger.info("Background job started", { job: name, intervalMs });
  if (options.runImmediately !== false) void run();

  return async () => {
    if (stopped) {
      await activeRun;
      return;
    }
    stopped = true;
    clearInterval(timer);
    logger.info("Background job stopping", { job: name });
    await activeRun;
    logger.info("Background job stopped", { job: name });
  };
}
