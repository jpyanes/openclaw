import { describe, expect, it, vi } from "vitest";
import {
  INSTALL_PLAN_STEPS,
  createWizardProgressReporter,
  formatInstallPlanLabel,
  runInstallPlanWithProgress,
  type InstallPlanEvent,
} from "./install-plan-progress.js";

describe("install plan progress", () => {
  it("emits resolve:start first then ok for every step on success (in order)", async () => {
    const events: InstallPlanEvent[] = [];
    const result = await runInstallPlanWithProgress<{ ok: true; pluginId: string }>({
      run: async () => ({ ok: true, pluginId: "@wecom/wecom-openclaw-plugin" }),
      isSuccess: (r) => r.ok,
      reporter: (e) => events.push(e),
      initialDetail: "@wecom/wecom-openclaw-plugin",
    });

    expect(result.pluginId).toBe("@wecom/wecom-openclaw-plugin");

    // First event: resolve:start with initialDetail
    expect(events[0]).toMatchObject({
      step: "resolve",
      state: "start",
      index: 1,
      total: 6,
      detail: "@wecom/wecom-openclaw-plugin",
    });

    // Remaining events: one `ok` per step in declared order.
    const okEvents = events.slice(1);
    expect(okEvents).toHaveLength(INSTALL_PLAN_STEPS.length);
    expect(okEvents.map((e) => e.step)).toEqual([...INSTALL_PLAN_STEPS]);
    expect(okEvents.every((e) => e.state === "ok")).toBe(true);
  });

  it("emits resolve:error with detail when run() rejects, and re-throws", async () => {
    const events: InstallPlanEvent[] = [];
    await expect(
      runInstallPlanWithProgress<{ ok: boolean }>({
        run: async () => {
          throw new Error("npm unreachable");
        },
        isSuccess: (r) => r.ok,
        reporter: (e) => events.push(e),
      }),
    ).rejects.toThrow("npm unreachable");

    expect(events.at(-1)).toMatchObject({
      step: "resolve",
      state: "error",
      detail: "npm unreachable",
    });
  });

  it("emits resolve:error with install error detail when run() resolves with ok=false", async () => {
    const events: InstallPlanEvent[] = [];
    const result = await runInstallPlanWithProgress<{ ok: false; error: string }>({
      run: async () => ({ ok: false, error: "npm_package_not_found" }),
      isSuccess: (r) => r.ok,
      errorDetail: (r) => (r.ok ? undefined : r.error),
      reporter: (e) => events.push(e),
    });
    expect(result.ok).toBe(false);
    const last = events.at(-1);
    expect(last?.step).toBe("resolve");
    expect(last?.state).toBe("error");
    expect(last?.detail).toBe("npm_package_not_found");
    // No success events should have been emitted.
    expect(events.some((e) => e.state === "ok")).toBe(false);
  });

  it("is a no-op without a reporter", async () => {
    const result = await runInstallPlanWithProgress({
      run: async () => ({ ok: true }),
      isSuccess: (r) => r.ok,
    });
    expect(result.ok).toBe(true);
  });

  it("formats labels with [index/total] prefix and optional detail", () => {
    const label = formatInstallPlanLabel({
      step: "download",
      state: "start",
      index: 2,
      total: 6,
      label: "Downloading",
      detail: "@wecom/wecom-openclaw-plugin@1.2.3",
    });
    expect(label).toBe("[2/6] Downloading — @wecom/wecom-openclaw-plugin@1.2.3");
  });

  it("wizard progress reporter forwards start/ok events to progress.update", () => {
    const update = vi.fn();
    const stop = vi.fn();
    const reporter = createWizardProgressReporter({ update, stop });

    reporter({
      step: "resolve",
      state: "start",
      index: 1,
      total: 6,
      label: "Resolving package",
      detail: "@wecom/wecom-openclaw-plugin",
    });
    reporter({
      step: "resolve",
      state: "ok",
      index: 1,
      total: 6,
      label: "Resolving package",
    });
    reporter({
      step: "verify",
      state: "error",
      index: 3,
      total: 6,
      label: "Verifying integrity",
      detail: "integrity_mismatch",
    });

    expect(update).toHaveBeenCalledTimes(3);
    expect(update).toHaveBeenNthCalledWith(
      1,
      "[1/6] Resolving package — @wecom/wecom-openclaw-plugin",
    );
    expect(update).toHaveBeenNthCalledWith(2, "[1/6] Resolving package");
    expect(update).toHaveBeenNthCalledWith(
      3,
      "[3/6] Verifying integrity — integrity_mismatch (failed)",
    );
    expect(stop).not.toHaveBeenCalled();
  });

  it("exposes a stable public step order", () => {
    expect([...INSTALL_PLAN_STEPS]).toEqual([
      "resolve",
      "download",
      "verify",
      "scan",
      "extract",
      "register",
    ]);
  });
});
