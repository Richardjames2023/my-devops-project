import { afterEach, describe, expect, it, vi } from "vitest";
import { startPeriodicJob } from "../src/infrastructure/jobs/periodic-job";
import { logger } from "../src/config/logger";

describe("periodic job lifecycle", () => {
  afterEach(() => vi.useRealTimers());

  it("prevents overlapping executions", async () => {
    vi.useFakeTimers();
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    let release!: () => void;
    const task = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const stop = startPeriodicJob("test-job", 1000, task);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(3000);
    expect(task).toHaveBeenCalledOnce();
    release();
    await stop();
    expect(info).toHaveBeenCalledWith("Background job stopped", { job: "test-job" });
  });

  it("stops future runs and waits for the active execution", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const task = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const stop = startPeriodicJob("drain-job", 1000, task);
    await Promise.resolve();
    let stopped = false;
    const stopping = stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await stopping;
    await vi.advanceTimersByTimeAsync(5000);
    expect(stopped).toBe(true);
    expect(task).toHaveBeenCalledOnce();
  });

  it("logs task failures and continues on the next interval", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const task = vi.fn().mockRejectedValueOnce(new Error("failure")).mockResolvedValue(undefined);
    const stop = startPeriodicJob("retry-job", 1000, task);
    await vi.advanceTimersByTimeAsync(0);
    expect(error).toHaveBeenCalledWith("Background job execution failed", expect.any(Error), { job: "retry-job" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(2);
    await stop();
  });
});
