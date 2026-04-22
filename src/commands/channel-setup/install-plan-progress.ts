/**
 * Install plan progress — phase-1 shared progress reporting for
 * `openclaw plugins install` and the onboard install path.
 *
 * The plugin install pipeline conceptually has six user-visible phases. We
 * emit explicit events for each so that:
 *   - interactive callers (setup wizard) can drive a single `WizardProgress`
 *     spinner with per-step labels,
 *   - non-interactive callers (CI, `--json`, future remote onboard) can
 *     consume structured events without screen-scraping log lines.
 *
 * The underlying install (`installPluginFromNpmSpec`) does all six steps
 * internally. Phase-1 wraps it and brackets it with start/end events for the
 * coarse phases we can observe from the outside (resolve + finish).
 * Finer-grained progress pings can be added in phase 2 by threading a
 * progress callback through `install.runtime.ts` without breaking this
 * event contract.
 */

import type { WizardProgress } from "../../wizard/prompts.js";

/** Ordered user-visible install phases. Order is part of the public contract. */
export const INSTALL_PLAN_STEPS = [
  "resolve",
  "download",
  "verify",
  "scan",
  "extract",
  "register",
] as const;

export type InstallPlanStep = (typeof INSTALL_PLAN_STEPS)[number];

export type InstallPlanStepState = "start" | "ok" | "skip" | "error";

export type InstallPlanEvent = {
  step: InstallPlanStep;
  state: InstallPlanStepState;
  /** 1-based index of `step` in INSTALL_PLAN_STEPS. */
  index: number;
  /** Total step count — stable (equals INSTALL_PLAN_STEPS.length). */
  total: number;
  /** Human-readable label, safe to render directly. */
  label: string;
  /** Optional detail, e.g. resolved version, npm tarball size, error message. */
  detail?: string;
};

export type InstallPlanProgressReporter = (event: InstallPlanEvent) => void;

const DEFAULT_LABELS: Record<InstallPlanStep, string> = {
  resolve: "Resolving package",
  download: "Downloading",
  verify: "Verifying integrity",
  scan: "Security scan",
  extract: "Extracting",
  register: "Registering plugin",
};

export function formatInstallPlanLabel(event: InstallPlanEvent): string {
  const counter = `[${event.index}/${event.total}]`;
  const base = `${counter} ${event.label}`;
  if (event.detail) {
    return `${base} — ${event.detail}`;
  }
  return base;
}

function makeEvent(
  step: InstallPlanStep,
  state: InstallPlanStepState,
  detail?: string,
): InstallPlanEvent {
  const index = INSTALL_PLAN_STEPS.indexOf(step) + 1;
  return {
    step,
    state,
    index,
    total: INSTALL_PLAN_STEPS.length,
    label: DEFAULT_LABELS[step],
    ...(detail ? { detail } : {}),
  };
}

/** Build a reporter that drives a {@link WizardProgress} spinner. */
export function createWizardProgressReporter(
  progress: WizardProgress,
): InstallPlanProgressReporter {
  return (event) => {
    if (event.state === "start" || event.state === "ok") {
      progress.update(formatInstallPlanLabel(event));
    } else if (event.state === "error") {
      progress.update(`${formatInstallPlanLabel(event)} (failed)`);
    }
  };
}

/** Build a reporter that writes structured JSON lines to stdout (or sink).
 * Used for `--non-interactive` and future JSON output paths. */
export function createJsonLinesProgressReporter(
  sink: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): InstallPlanProgressReporter {
  return (event) => {
    sink(JSON.stringify({ type: "install-plan", ...event }));
  };
}

export type RunInstallPlanParams<T> = {
  /** Runs the actual install and returns its native result. */
  run: () => Promise<T>;
  /** Predicate that decides whether the returned result counts as success. */
  isSuccess: (result: T) => boolean;
  /** Optional label extractor for the error/detail field. */
  errorDetail?: (result: T) => string | undefined;
  /** Extra detail emitted on the initial `resolve:start` event. */
  initialDetail?: string;
  /** Progress sink. If omitted, progress is a no-op. */
  reporter?: InstallPlanProgressReporter;
};

/**
 * Wrap an install invocation with the 6-step event stream. Phase-1 emits
 * start events eagerly for each step before awaiting `run()` so the UI
 * renders a complete checklist even though the underlying install runs
 * them as one atomic operation; success is signalled after `run()` returns.
 *
 * Phase 2 can thread a streaming callback through `install.runtime.ts` and
 * emit per-step `ok` events in real time without breaking this contract.
 */
export async function runInstallPlanWithProgress<T>(params: RunInstallPlanParams<T>): Promise<T> {
  const report = params.reporter ?? (() => {});

  // Phase 1 UX choice: eagerly announce resolve+download as "start" so the
  // user immediately sees what's coming; remaining steps are announced
  // after the atomic install settles. This avoids lying about progress
  // while still giving onboard a responsive first frame.
  report(makeEvent("resolve", "start", params.initialDetail));

  let result: T;
  try {
    result = await params.run();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    report(makeEvent("resolve", "error", detail));
    throw err;
  }

  const success = params.isSuccess(result);
  const detail = params.errorDetail?.(result);

  if (!success) {
    // Map failures to the most likely step so logs are actionable.
    report(makeEvent("resolve", "error", detail));
    return result;
  }

  // Emit success for every step in order so UIs render a full checklist.
  for (const step of INSTALL_PLAN_STEPS) {
    report(makeEvent(step, "ok"));
  }
  return result;
}
