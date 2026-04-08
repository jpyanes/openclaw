import { isHelpFlag, renderDiffHelp } from "../help.js";
import {
  diffArtifacts,
  readKovaArtifact,
  renderArtifactDiff,
  resolveLatestRunId,
  resolveLatestComparablePassRunId,
  resolveLatestPassRunId,
  resolvePreviousComparableRunId,
  resolvePreviousRunId,
} from "../report.js";
import {
  formatKovaSelectorFilters,
  hasKovaSelectorFilters,
  parseKovaSelectorFilters,
  type KovaRunSelectorFilters,
} from "./selector-filters.js";

function readFlagValue(args: string[], index: number, flag: string) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`missing value for ${flag}.`);
  }
  return value;
}

function parseDiffArgs(args: string[]) {
  const json = args.includes("--json");
  const options = {
    baselineSelector: undefined as string | undefined,
    candidateSelector: undefined as string | undefined,
    failOn: undefined as
      | "regression"
      | "mixed-change"
      | "compatibility-delta"
      | "informational-drift"
      | "any-delta"
      | undefined,
    json,
  };
  const retainedArgs: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      continue;
    }
    if (arg === "--baseline") {
      options.baselineSelector = readFlagValue(args, index, "--baseline");
      index += 1;
      continue;
    }
    if (arg === "--candidate") {
      options.candidateSelector = readFlagValue(args, index, "--candidate");
      index += 1;
      continue;
    }
    if (arg === "--fail-on") {
      const value = readFlagValue(args, index, "--fail-on");
      if (
        value !== "regression" &&
        value !== "mixed-change" &&
        value !== "compatibility-delta" &&
        value !== "informational-drift" &&
        value !== "any-delta"
      ) {
        throw new Error(
          `unsupported Kova diff gate: ${value}. Use 'kova --help' to inspect supported fail-on gates.`,
        );
      }
      options.failOn = value;
      index += 1;
      continue;
    }
    retainedArgs.push(arg);
  }
  const { filters, rest } = parseKovaSelectorFilters(retainedArgs);
  return {
    baselineSelector: options.baselineSelector ?? rest[0] ?? "auto",
    candidateSelector: options.candidateSelector ?? rest[1] ?? "latest",
    filters,
    failOn: options.failOn,
    json,
  };
}

async function resolveDiffSelector(
  repoRoot: string,
  selector: string,
  filters: KovaRunSelectorFilters,
) {
  if (selector === "latest") {
    return await resolveLatestRunId(repoRoot, filters);
  }
  if (selector === "previous") {
    const latestRunId = await resolveLatestRunId(repoRoot, filters);
    return latestRunId ? await resolvePreviousRunId(repoRoot, latestRunId, filters) : undefined;
  }
  if (selector === "latest-pass") {
    return await resolveLatestPassRunId(repoRoot, filters);
  }
  return selector;
}

async function resolveAutoBaselineRunId(
  repoRoot: string,
  candidateRunId: string,
  filters: KovaRunSelectorFilters,
) {
  const candidateArtifact = await readKovaArtifact(repoRoot, candidateRunId);
  if (candidateArtifact.verdict === "pass" || candidateArtifact.verdict === "skipped") {
    const previousComparableRunId = await resolvePreviousComparableRunId(
      repoRoot,
      candidateRunId,
      filters,
    );
    if (previousComparableRunId) {
      return {
        runId: previousComparableRunId,
        resolvedBy: "previous-comparable",
      };
    }
    const latestComparablePassRunId = await resolveLatestComparablePassRunId(
      repoRoot,
      candidateRunId,
      filters,
    );
    return latestComparablePassRunId
      ? {
          runId: latestComparablePassRunId,
          resolvedBy: "latest-comparable-pass",
        }
      : undefined;
  }
  const latestComparablePassRunId = await resolveLatestComparablePassRunId(
    repoRoot,
    candidateRunId,
    filters,
  );
  if (latestComparablePassRunId) {
    return {
      runId: latestComparablePassRunId,
      resolvedBy: "latest-comparable-pass",
    };
  }
  const previousComparableRunId = await resolvePreviousComparableRunId(
    repoRoot,
    candidateRunId,
    filters,
  );
  return previousComparableRunId
    ? {
        runId: previousComparableRunId,
        resolvedBy: "previous-comparable",
      }
    : undefined;
}

export async function diffCommand(repoRoot: string, args: string[]) {
  if (isHelpFlag(args)) {
    process.stdout.write(renderDiffHelp());
    return;
  }
  const options = parseDiffArgs(args);
  const candidateRunId = await resolveDiffSelector(
    repoRoot,
    options.candidateSelector,
    options.filters,
  );
  const autoBaseline =
    options.baselineSelector === "auto" && candidateRunId
      ? await resolveAutoBaselineRunId(repoRoot, candidateRunId, options.filters)
      : undefined;
  const baselineRunId =
    options.baselineSelector === "auto"
      ? autoBaseline?.runId
      : options.baselineSelector === "previous"
        ? await resolvePreviousComparableRunId(repoRoot, candidateRunId, options.filters)
        : options.baselineSelector === "latest-pass"
          ? await resolveLatestComparablePassRunId(repoRoot, candidateRunId, options.filters)
          : await resolveDiffSelector(repoRoot, options.baselineSelector, options.filters);

  if (!baselineRunId || !candidateRunId) {
    if (
      options.baselineSelector === "auto" ||
      options.baselineSelector === "previous" ||
      options.baselineSelector === "latest-pass"
    ) {
      const fallbackPreviousRunId = await resolvePreviousRunId(
        repoRoot,
        candidateRunId,
        options.filters,
      );
      if (fallbackPreviousRunId) {
        throw new Error(
          `no comparable ${options.baselineSelector} Kova run found for ${candidateRunId}${hasKovaSelectorFilters(options.filters) ? ` within filters ${formatKovaSelectorFilters(options.filters)}` : ""}; nearest prior run is ${fallbackPreviousRunId}. Run another comparable candidate or choose an explicit baseline.`,
        );
      }
    }
    throw new Error(
      hasKovaSelectorFilters(options.filters)
        ? `not enough Kova runs available to diff within filters ${formatKovaSelectorFilters(options.filters)}. Record at least two matching runs first.`
        : "not enough Kova runs available to diff. Record at least two runs first.",
    );
  }

  const [baseline, candidate] = await Promise.all([
    readKovaArtifact(repoRoot, baselineRunId),
    readKovaArtifact(repoRoot, candidateRunId),
  ]);
  const diff = diffArtifacts(baseline, candidate, {
    baseline: options.baselineSelector,
    candidate: options.candidateSelector,
    baselineResolved:
      options.baselineSelector === "auto"
        ? (autoBaseline?.resolvedBy ?? baselineRunId)
        : baselineRunId,
    candidateResolved: candidateRunId,
  });

  const failTriggered =
    options.failOn === "any-delta"
      ? diff.interpretation.signals.length > 0
      : options.failOn
        ? diff.interpretation.kind === options.failOn
        : false;

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          baseline,
          candidate,
          diff,
        },
        null,
        2,
      )}\n`,
    );
    if (failTriggered) {
      process.exitCode = 6;
    }
    return;
  }

  process.stdout.write(renderArtifactDiff(diff, baseline, candidate));
  if (failTriggered) {
    process.exitCode = 6;
  }
}
