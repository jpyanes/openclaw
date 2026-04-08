import fs from "node:fs/promises";
import path from "node:path";
import type { KovaRunSelectorFilters } from "./commands/selector-filters.js";
import { matchesKovaSelectorFilters } from "./commands/selector-filters.js";
import {
  block,
  bulletList,
  displayPath,
  formatDuration,
  formatIsoTimestamp,
  joinBlocks,
  keyValueBlock,
  muted,
  pageHeader,
  verdictBadge,
} from "./console/format.js";
import { kovaRunArtifactSchema, type KovaRunArtifact } from "./contracts/run-artifact.js";
import { readJsonFile, resolveKovaRunDir, resolveKovaRunsDir } from "./lib/fs.js";
import { hydrateKovaRunIndex } from "./lib/run-index.js";

export type KovaArtifactComparisonKind =
  | "comparable"
  | "cross-target"
  | "cross-backend"
  | "cross-provider"
  | "cross-selection";

export type KovaArtifactInterpretationKind =
  | "regression"
  | "improvement"
  | "compatibility-delta"
  | "mixed-change"
  | "informational-drift";

export type KovaArtifactDiff = {
  baselineRunId: string;
  candidateRunId: string;
  selectors: {
    baseline: string;
    candidate: string;
    baselineResolved: string;
    candidateResolved: string;
  };
  baselineVerdict: KovaRunArtifact["verdict"];
  candidateVerdict: KovaRunArtifact["verdict"];
  comparison: {
    kind: KovaArtifactComparisonKind;
    comparable: boolean;
    baselineIdentity: string;
    candidateIdentity: string;
  };
  interpretation: {
    kind: KovaArtifactInterpretationKind;
    summary: string;
    signals: string[];
  };
  environmentChanged: boolean;
  environment: {
    baseline: Pick<
      KovaRunArtifact["environment"],
      "gitCommit" | "gitDirty" | "os" | "arch" | "nodeVersion"
    >;
    candidate: Pick<
      KovaRunArtifact["environment"],
      "gitCommit" | "gitDirty" | "os" | "arch" | "nodeVersion"
    >;
  };
  selectionChanged: boolean;
  backendChanged: boolean;
  verdictChanged: boolean;
  statusChanged: boolean;
  classificationChanged: boolean;
  durationDeltaMs: number;
  countsDelta: {
    total: number;
    passed: number;
    failed: number;
  };
  executionChanged: boolean;
  execution: {
    baseline: KovaRunArtifact["execution"];
    candidate: KovaRunArtifact["execution"];
  };
  coverage: {
    capabilityAreasAdded: string[];
    capabilityAreasRemoved: string[];
    capabilitiesAdded: string[];
    capabilitiesRemoved: string[];
    surfacesAdded: string[];
    surfacesRemoved: string[];
    scenarioIdsAdded: string[];
    scenarioIdsRemoved: string[];
  };
  scenarioResultChanges: Array<{
    id: string;
    baselineVerdict?: KovaRunArtifact["scenarioResults"][number]["verdict"];
    candidateVerdict?: KovaRunArtifact["scenarioResults"][number]["verdict"];
  }>;
};

function diffStringSets(baseline: string[], candidate: string[]) {
  const baselineSet = new Set(baseline);
  const candidateSet = new Set(candidate);
  return {
    added: candidate.filter((value) => !baselineSet.has(value)),
    removed: baseline.filter((value) => !candidateSet.has(value)),
  };
}

function normalizeExecutionForDiff(execution: KovaRunArtifact["execution"]) {
  return {
    state: execution.state,
    availability: execution.availability,
    binaryPath: execution.binaryPath,
    cleanup: execution.cleanup,
    resources: execution.resources,
  };
}

function normalizeScenarioIds(scenarioIds: string[] | undefined) {
  return [...(scenarioIds ?? [])].toSorted();
}

function splitKeyValueNotes(notes: string[]) {
  const keyed: Array<[string, string]> = [];
  const plain: string[] = [];
  for (const note of notes) {
    const separatorIndex = note.indexOf("=");
    if (separatorIndex > 0) {
      keyed.push([note.slice(0, separatorIndex), note.slice(separatorIndex + 1)]);
    } else {
      plain.push(note);
    }
  }
  return { keyed, plain };
}

function titleCase(value: string) {
  if (value.toLowerCase() === "qa") {
    return "QA";
  }
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function humanizeLabel(value: string) {
  const normalized = titleCase(value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[._]/g, " "));
  return normalized
    .replace(/\bQa\b/g, "QA")
    .replace(/\bVm\b/g, "VM")
    .replace(/\bUrl\b/g, "URL");
}

export function createArtifactIdentity(artifact: KovaRunArtifact) {
  const backendId = artifact.backend.id ?? artifact.backend.kind;
  const providerMode = artifact.backend.mode ?? "default";
  const suite = artifact.selection.suite ?? "";
  const scenarioMode = artifact.selection.scenarioMode ?? "all";
  const scenarioIds = normalizeScenarioIds(artifact.selection.scenarioIds).join(",");
  const axes = Object.entries(artifact.selection.axes ?? {})
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
  return [
    `target=${artifact.selection.target}`,
    `backend=${backendId}`,
    `provider=${providerMode}`,
    `suite=${suite}`,
    `selectionMode=${scenarioMode}`,
    `axes=${axes}`,
    `scenarios=${scenarioIds}`,
  ].join("|");
}

function describeScenarioSelection(artifact: KovaRunArtifact) {
  const scenarioIds = artifact.selection.scenarioIds ?? [];
  switch (artifact.selection.scenarioMode) {
    case "backend-default":
      return `backend default (${scenarioIds.length}): ${scenarioIds.join(", ")}`;
    case "explicit":
      return scenarioIds.join(", ");
    default:
      return "all";
  }
}

export function classifyArtifactComparison(
  baseline: KovaRunArtifact,
  candidate: KovaRunArtifact,
): KovaArtifactDiff["comparison"] {
  const baselineBackend = baseline.backend.id ?? baseline.backend.kind;
  const candidateBackend = candidate.backend.id ?? candidate.backend.kind;
  const baselineProvider = baseline.backend.mode ?? "default";
  const candidateProvider = candidate.backend.mode ?? "default";
  const baselineScenarioIds = normalizeScenarioIds(baseline.selection.scenarioIds);
  const candidateScenarioIds = normalizeScenarioIds(candidate.selection.scenarioIds);
  const baselineAxes = Object.entries(baseline.selection.axes ?? {}).toSorted(([left], [right]) =>
    left.localeCompare(right),
  );
  const candidateAxes = Object.entries(candidate.selection.axes ?? {}).toSorted(([left], [right]) =>
    left.localeCompare(right),
  );

  let kind: KovaArtifactComparisonKind = "comparable";
  if (baseline.selection.target !== candidate.selection.target) {
    kind = "cross-target";
  } else if (baselineBackend !== candidateBackend) {
    kind = "cross-backend";
  } else if (baselineProvider !== candidateProvider) {
    kind = "cross-provider";
  } else if (
    baseline.selection.suite !== candidate.selection.suite ||
    JSON.stringify(baselineScenarioIds) !== JSON.stringify(candidateScenarioIds) ||
    JSON.stringify(baselineAxes) !== JSON.stringify(candidateAxes)
  ) {
    kind = "cross-selection";
  }

  return {
    kind,
    comparable: kind === "comparable",
    baselineIdentity: createArtifactIdentity(baseline),
    candidateIdentity: createArtifactIdentity(candidate),
  };
}

export async function resolveLatestRunId(repoRoot: string, filters?: KovaRunSelectorFilters) {
  const index = await hydrateKovaRunIndex(repoRoot).catch(() => null);
  if (index) {
    const filteredRuns = index.runs.filter((entry) => matchesKovaSelectorFilters(entry, filters));
    return filteredRuns.at(-1)?.runId;
  }
  if (!filters && index?.latestRunId) {
    return index.latestRunId;
  }
  const runsDir = resolveKovaRunsDir(repoRoot);
  const entries = await fs.readdir(runsDir).catch(() => []);
  const completedRunIds: string[] = [];
  for (const runId of entries.toSorted((left, right) => left.localeCompare(right))) {
    const runPath = path.join(resolveKovaRunDir(repoRoot, runId), "run.json");
    const exists = await fs
      .access(runPath)
      .then(() => true)
      .catch(() => false);
    if (exists) {
      completedRunIds.push(runId);
    }
  }
  const runIds = completedRunIds;
  return runIds.at(-1);
}

export async function resolvePreviousRunId(
  repoRoot: string,
  runId?: string,
  filters?: KovaRunSelectorFilters,
) {
  const index = await hydrateKovaRunIndex(repoRoot).catch(() => null);
  if (!index || index.runs.length === 0) {
    return undefined;
  }
  const filteredRuns = index.runs.filter((entry) => matchesKovaSelectorFilters(entry, filters));
  const targetRunId = runId ?? filteredRuns.at(-1)?.runId ?? index.latestRunId;
  if (!targetRunId) {
    return undefined;
  }
  const position = filteredRuns.findIndex((entry) => entry.runId === targetRunId);
  if (position <= 0) {
    return undefined;
  }
  return filteredRuns[position - 1]?.runId;
}

export async function resolveLatestPassRunId(repoRoot: string, filters?: KovaRunSelectorFilters) {
  const index = await hydrateKovaRunIndex(repoRoot).catch(() => null);
  if (!index || index.runs.length === 0) {
    return undefined;
  }
  const filteredRuns = index.runs.filter((entry) => matchesKovaSelectorFilters(entry, filters));
  for (let position = filteredRuns.length - 1; position >= 0; position -= 1) {
    const indexedRun = filteredRuns[position];
    if (indexedRun?.verdict === "pass") {
      return indexedRun.runId;
    }
  }
  return undefined;
}

export async function resolvePreviousComparableRunId(
  repoRoot: string,
  runId?: string,
  filters?: KovaRunSelectorFilters,
) {
  const index = await hydrateKovaRunIndex(repoRoot).catch(() => null);
  if (!index || index.runs.length === 0) {
    return undefined;
  }
  const filteredRuns = index.runs.filter((entry) => matchesKovaSelectorFilters(entry, filters));
  const candidateRunId = runId ?? filteredRuns.at(-1)?.runId ?? index.latestRunId;
  if (!candidateRunId) {
    return undefined;
  }
  const candidatePosition = filteredRuns.findIndex((entry) => entry.runId === candidateRunId);
  if (candidatePosition <= 0) {
    return undefined;
  }
  const candidateArtifact = await readKovaArtifact(repoRoot, candidateRunId).catch(() => null);
  if (!candidateArtifact) {
    return undefined;
  }
  for (let position = candidatePosition - 1; position >= 0; position -= 1) {
    const candidate = filteredRuns[position];
    if (!candidate) {
      continue;
    }
    const baselineArtifact = await readKovaArtifact(repoRoot, candidate.runId).catch(() => null);
    if (!baselineArtifact) {
      continue;
    }
    if (classifyArtifactComparison(baselineArtifact, candidateArtifact).comparable) {
      return baselineArtifact.runId;
    }
  }
  return undefined;
}

export async function resolveLatestComparablePassRunId(
  repoRoot: string,
  runId?: string,
  filters?: KovaRunSelectorFilters,
) {
  const index = await hydrateKovaRunIndex(repoRoot).catch(() => null);
  if (!index || index.runs.length === 0) {
    return undefined;
  }
  const filteredRuns = index.runs.filter((entry) => matchesKovaSelectorFilters(entry, filters));
  const candidateRunId = runId ?? filteredRuns.at(-1)?.runId ?? index.latestRunId;
  if (!candidateRunId) {
    return undefined;
  }
  const candidatePosition = filteredRuns.findIndex((entry) => entry.runId === candidateRunId);
  if (candidatePosition < 0) {
    return undefined;
  }
  const candidateArtifact = await readKovaArtifact(repoRoot, candidateRunId).catch(() => null);
  if (!candidateArtifact) {
    return undefined;
  }
  for (let position = candidatePosition - 1; position >= 0; position -= 1) {
    const indexedRun = filteredRuns[position];
    if (!indexedRun || indexedRun.verdict !== "pass") {
      continue;
    }
    const baselineArtifact = await readKovaArtifact(repoRoot, indexedRun.runId).catch(() => null);
    if (!baselineArtifact) {
      continue;
    }
    if (classifyArtifactComparison(baselineArtifact, candidateArtifact).comparable) {
      return baselineArtifact.runId;
    }
  }
  return undefined;
}

export async function readKovaArtifact(repoRoot: string, runId: string) {
  return kovaRunArtifactSchema.parse(
    await readJsonFile<KovaRunArtifact>(path.join(resolveKovaRunDir(repoRoot, runId), "run.json")),
  );
}

export function diffArtifacts(
  baseline: KovaRunArtifact,
  candidate: KovaRunArtifact,
  selectors?: {
    baseline?: string;
    candidate?: string;
    baselineResolved?: string;
    candidateResolved?: string;
  },
): KovaArtifactDiff {
  const capabilities = diffStringSets(
    baseline.coverage.capabilities,
    candidate.coverage.capabilities,
  );
  const capabilityAreas = diffStringSets(
    baseline.coverage.capabilityAreas,
    candidate.coverage.capabilityAreas,
  );
  const surfaces = diffStringSets(baseline.coverage.surfaces, candidate.coverage.surfaces);
  const scenarioIds = diffStringSets(baseline.coverage.scenarioIds, candidate.coverage.scenarioIds);
  const baselineScenarioResults = new Map(
    baseline.scenarioResults.map((scenario) => [scenario.id, scenario]),
  );
  const candidateScenarioResults = new Map(
    candidate.scenarioResults.map((scenario) => [scenario.id, scenario]),
  );
  const scenarioResultIds = [
    ...new Set([...baselineScenarioResults.keys(), ...candidateScenarioResults.keys()]),
  ].toSorted();

  const comparison = classifyArtifactComparison(baseline, candidate);
  const diff = {
    baselineRunId: baseline.runId,
    candidateRunId: candidate.runId,
    selectors: {
      baseline: selectors?.baseline ?? baseline.runId,
      candidate: selectors?.candidate ?? candidate.runId,
      baselineResolved: selectors?.baselineResolved ?? baseline.runId,
      candidateResolved: selectors?.candidateResolved ?? candidate.runId,
    },
    baselineVerdict: baseline.verdict,
    candidateVerdict: candidate.verdict,
    comparison,
    environmentChanged:
      JSON.stringify(baseline.environment) !== JSON.stringify(candidate.environment),
    environment: {
      baseline: {
        gitCommit: baseline.environment.gitCommit,
        gitDirty: baseline.environment.gitDirty,
        os: baseline.environment.os,
        arch: baseline.environment.arch,
        nodeVersion: baseline.environment.nodeVersion,
      },
      candidate: {
        gitCommit: candidate.environment.gitCommit,
        gitDirty: candidate.environment.gitDirty,
        os: candidate.environment.os,
        arch: candidate.environment.arch,
        nodeVersion: candidate.environment.nodeVersion,
      },
    },
    selectionChanged: JSON.stringify(baseline.selection) !== JSON.stringify(candidate.selection),
    backendChanged: JSON.stringify(baseline.backend) !== JSON.stringify(candidate.backend),
    verdictChanged: baseline.verdict !== candidate.verdict,
    statusChanged: baseline.status !== candidate.status,
    classificationChanged:
      baseline.classification.domain !== candidate.classification.domain ||
      baseline.classification.reason !== candidate.classification.reason,
    durationDeltaMs: candidate.timing.durationMs - baseline.timing.durationMs,
    countsDelta: {
      total: candidate.counts.total - baseline.counts.total,
      passed: candidate.counts.passed - baseline.counts.passed,
      failed: candidate.counts.failed - baseline.counts.failed,
    },
    executionChanged:
      JSON.stringify(normalizeExecutionForDiff(baseline.execution)) !==
      JSON.stringify(normalizeExecutionForDiff(candidate.execution)),
    execution: {
      baseline: baseline.execution,
      candidate: candidate.execution,
    },
    coverage: {
      capabilityAreasAdded: capabilityAreas.added,
      capabilityAreasRemoved: capabilityAreas.removed,
      capabilitiesAdded: capabilities.added,
      capabilitiesRemoved: capabilities.removed,
      surfacesAdded: surfaces.added,
      surfacesRemoved: surfaces.removed,
      scenarioIdsAdded: scenarioIds.added,
      scenarioIdsRemoved: scenarioIds.removed,
    },
    scenarioResultChanges: scenarioResultIds
      .map((id) => ({
        id,
        baselineVerdict: baselineScenarioResults.get(id)?.verdict,
        candidateVerdict: candidateScenarioResults.get(id)?.verdict,
      }))
      .filter((change) => change.baselineVerdict !== change.candidateVerdict),
  } satisfies Omit<KovaArtifactDiff, "interpretation">;
  return {
    ...diff,
    interpretation: interpretArtifactDiff(diff),
  };
}

function compareVerdictSeverity(verdict: KovaRunArtifact["verdict"]) {
  const severityOrder: Record<KovaRunArtifact["verdict"], number> = {
    pass: 0,
    skipped: 0,
    degraded: 1,
    flaky: 2,
    blocked: 3,
    fail: 4,
  };
  return severityOrder[verdict];
}

export function interpretArtifactDiff(
  diff: Omit<KovaArtifactDiff, "interpretation">,
): KovaArtifactDiff["interpretation"] {
  const worseningSignals: string[] = [];
  const improvingSignals: string[] = [];
  const infoSignals: string[] = [];

  if (
    compareVerdictSeverity(diff.candidateVerdict) > compareVerdictSeverity(diff.baselineVerdict)
  ) {
    worseningSignals.push(`verdict ${diff.baselineVerdict} -> ${diff.candidateVerdict}`);
  } else if (
    compareVerdictSeverity(diff.candidateVerdict) < compareVerdictSeverity(diff.baselineVerdict)
  ) {
    improvingSignals.push(`verdict ${diff.baselineVerdict} -> ${diff.candidateVerdict}`);
  }

  if (diff.statusChanged) {
    infoSignals.push("status changed");
  }
  if (diff.classificationChanged) {
    infoSignals.push("classification changed");
  }
  if (diff.executionChanged) {
    if (
      diff.execution.baseline.state !== "blocked" &&
      diff.execution.candidate.state === "blocked"
    ) {
      worseningSignals.push("execution became blocked");
    } else if (
      diff.execution.baseline.state === "blocked" &&
      diff.execution.candidate.state !== "blocked"
    ) {
      improvingSignals.push("execution recovered from blocked");
    } else {
      infoSignals.push("execution state changed");
    }
  }
  if (diff.countsDelta.failed > 0) {
    worseningSignals.push(`failed count +${diff.countsDelta.failed}`);
  } else if (diff.countsDelta.failed < 0) {
    improvingSignals.push(`failed count ${diff.countsDelta.failed}`);
  }

  for (const change of diff.scenarioResultChanges) {
    if (change.baselineVerdict === "pass" && change.candidateVerdict !== "pass") {
      worseningSignals.push(`${change.id} pass -> ${change.candidateVerdict ?? "missing"}`);
    } else if (change.baselineVerdict !== "pass" && change.candidateVerdict === "pass") {
      improvingSignals.push(`${change.id} ${change.baselineVerdict ?? "missing"} -> pass`);
    } else {
      infoSignals.push(`${change.id} verdict changed`);
    }
  }

  if (
    diff.coverage.capabilitiesRemoved.length > 0 ||
    diff.coverage.capabilityAreasRemoved.length > 0
  ) {
    worseningSignals.push("coverage removed");
  }
  if (diff.coverage.capabilitiesAdded.length > 0 || diff.coverage.capabilityAreasAdded.length > 0) {
    improvingSignals.push("coverage added");
  }
  if (diff.environmentChanged) {
    infoSignals.push("environment changed");
  }
  if (diff.selectionChanged) {
    infoSignals.push("selection changed");
  }
  if (diff.backendChanged) {
    infoSignals.push("backend changed");
  }

  if (!diff.comparison.comparable) {
    const signals = [...worseningSignals, ...improvingSignals, ...infoSignals];
    return {
      kind: signals.length > 0 ? "compatibility-delta" : "informational-drift",
      summary:
        signals.length > 0
          ? `non-comparable run shape with ${signals.length} meaningful delta(s)`
          : "non-comparable run shape with no meaningful outcome deltas",
      signals,
    };
  }

  if (worseningSignals.length > 0 && improvingSignals.length > 0) {
    return {
      kind: "mixed-change",
      summary: "comparable run with both improvements and regressions",
      signals: [...worseningSignals, ...improvingSignals, ...infoSignals],
    };
  }
  if (worseningSignals.length > 0) {
    return {
      kind: "regression",
      summary: "comparable run regressed",
      signals: [...worseningSignals, ...infoSignals],
    };
  }
  if (improvingSignals.length > 0) {
    return {
      kind: "improvement",
      summary: "comparable run improved",
      signals: [...improvingSignals, ...infoSignals],
    };
  }
  return {
    kind: "informational-drift",
    summary:
      infoSignals.length > 0
        ? "comparable run changed without regression"
        : "no meaningful changes detected",
    signals: infoSignals,
  };
}

export function renderArtifactDiff(
  diff: KovaArtifactDiff,
  baseline: KovaRunArtifact,
  candidate: KovaRunArtifact,
) {
  const coverageLines = [
    diff.coverage.scenarioIdsAdded.length > 0
      ? `scenario ids added: ${diff.coverage.scenarioIdsAdded.join(", ")}`
      : "",
    diff.coverage.scenarioIdsRemoved.length > 0
      ? `scenario ids removed: ${diff.coverage.scenarioIdsRemoved.join(", ")}`
      : "",
    diff.coverage.capabilityAreasAdded.length > 0
      ? `capability areas added: ${diff.coverage.capabilityAreasAdded.join(", ")}`
      : "",
    diff.coverage.capabilityAreasRemoved.length > 0
      ? `capability areas removed: ${diff.coverage.capabilityAreasRemoved.join(", ")}`
      : "",
    diff.coverage.capabilitiesAdded.length > 0
      ? `capabilities added: ${diff.coverage.capabilitiesAdded.join(", ")}`
      : "",
    diff.coverage.capabilitiesRemoved.length > 0
      ? `capabilities removed: ${diff.coverage.capabilitiesRemoved.join(", ")}`
      : "",
    diff.coverage.surfacesAdded.length > 0
      ? `surfaces added: ${diff.coverage.surfacesAdded.join(", ")}`
      : "",
    diff.coverage.surfacesRemoved.length > 0
      ? `surfaces removed: ${diff.coverage.surfacesRemoved.join(", ")}`
      : "",
  ].filter(Boolean);
  const outcomeLines = [
    diff.verdictChanged ? `verdict ${diff.baselineVerdict} -> ${diff.candidateVerdict}` : "",
    diff.statusChanged ? `status ${baseline.status} -> ${candidate.status}` : "",
    diff.classificationChanged
      ? baseline.classification.domain !== candidate.classification.domain
        ? `classification ${baseline.classification.domain} -> ${candidate.classification.domain}`
        : "classification reason updated"
      : "",
    diff.executionChanged
      ? `execution ${baseline.execution.state}/${baseline.execution.availability} -> ${candidate.execution.state}/${candidate.execution.availability}`
      : "",
    diff.durationDeltaMs !== 0
      ? `duration ${diff.durationDeltaMs >= 0 ? "+" : ""}${formatDuration(Math.abs(diff.durationDeltaMs))}`
      : "",
    diff.countsDelta.failed !== 0
      ? `failed count ${diff.countsDelta.failed >= 0 ? "+" : ""}${diff.countsDelta.failed}`
      : "",
    diff.countsDelta.passed !== 0
      ? `passed count ${diff.countsDelta.passed >= 0 ? "+" : ""}${diff.countsDelta.passed}`
      : "",
  ].filter(Boolean);
  const environmentLines = diff.environmentChanged
    ? [
        `baseline  ${diff.environment.baseline.gitCommit ?? "unknown"} | ${diff.environment.baseline.os}/${diff.environment.baseline.arch} | ${diff.environment.baseline.nodeVersion} | dirty=${diff.environment.baseline.gitDirty}`,
        `candidate ${diff.environment.candidate.gitCommit ?? "unknown"} | ${diff.environment.candidate.os}/${diff.environment.candidate.arch} | ${diff.environment.candidate.nodeVersion} | dirty=${diff.environment.candidate.gitDirty}`,
      ]
    : [];

  return joinBlocks([
    pageHeader(
      `Diff ${candidate.runId}`,
      `${titleCase(diff.comparison.kind)} | ${titleCase(diff.interpretation.kind)}`,
      `${diff.interpretation.summary} | baseline ${baseline.runId}`,
    ),
    block(
      "Resolution",
      keyValueBlock([
        ["baseline", `${diff.selectors.baseline} -> ${diff.selectors.baselineResolved}`],
        ["candidate", `${diff.selectors.candidate} -> ${diff.selectors.candidateResolved}`],
        ["comparison", diff.comparison.kind],
      ]),
    ),
    block(
      "Outcome",
      outcomeLines.length > 0 ? bulletList(outcomeLines) : [muted("No outcome deltas.")],
    ),
    block(
      "Signals",
      diff.interpretation.signals.length > 0
        ? bulletList(diff.interpretation.signals)
        : [muted("No meaningful signals.")],
    ),
    block("Runs", [
      `${verdictBadge(baseline.verdict)} ${diff.baselineRunId}  ${muted(`${titleCase(baseline.selection.target)} on ${baseline.backend.id ?? baseline.backend.kind}`)}`,
      `${verdictBadge(candidate.verdict)} ${diff.candidateRunId}  ${muted(`${titleCase(candidate.selection.target)} on ${candidate.backend.id ?? candidate.backend.kind}`)}`,
    ]),
    ...(environmentLines.length > 0 ? [block("Environment", environmentLines)] : []),
    ...(!diff.comparison.comparable
      ? [
          block(
            "Identities",
            keyValueBlock([
              ["baseline", diff.comparison.baselineIdentity],
              ["candidate", diff.comparison.candidateIdentity],
            ]),
          ),
        ]
      : []),
    ...(coverageLines.length > 0 ? [block("Coverage", bulletList(coverageLines))] : []),
    ...(diff.scenarioResultChanges.length > 0
      ? [
          block(
            "Scenario Changes",
            bulletList(
              diff.scenarioResultChanges.map(
                (change) =>
                  `${change.id}: ${change.baselineVerdict ?? "missing"} -> ${change.candidateVerdict ?? "missing"}`,
              ),
            ),
          ),
        ]
      : []),
  ]);
}

export function renderArtifactSummary(artifact: KovaRunArtifact) {
  const backendLabel = artifact.backend.id ?? artifact.backend.kind;
  const backendTitle = artifact.backend.title ?? backendLabel;
  const notes = splitKeyValueNotes(artifact.notes);
  const resourceContext = [
    artifact.execution.resources.profile
      ? (["Resource Profile", artifact.execution.resources.profile] as const)
      : null,
    artifact.execution.resources.image
      ? (["VM Image", artifact.execution.resources.image] as const)
      : null,
    artifact.execution.resources.cpus
      ? (["vCPUs", String(artifact.execution.resources.cpus)] as const)
      : null,
    artifact.execution.resources.memory
      ? (["Memory", artifact.execution.resources.memory] as const)
      : null,
    artifact.execution.resources.disk
      ? (["Disk", artifact.execution.resources.disk] as const)
      : null,
  ].filter(Boolean) as Array<readonly [string, string]>;
  const selectionContext = Object.entries(artifact.selection.axes ?? {})
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [humanizeLabel(key), value] as const);
  const keyedContext = [
    ...selectionContext,
    ...resourceContext,
    ...notes.keyed.map(([key, value]) => [humanizeLabel(key), value] as const),
  ];
  const selectionLabel = describeScenarioSelection(artifact);
  const artifactLines = [
    artifact.evidence.reportPath ? `report   ${displayPath(artifact.evidence.reportPath)}` : "",
    artifact.evidence.summaryPath ? `summary  ${displayPath(artifact.evidence.summaryPath)}` : "",
    artifact.execution.paths.planPath
      ? `plan     ${displayPath(artifact.execution.paths.planPath)}`
      : "",
    artifact.execution.paths.logPath
      ? `log      ${displayPath(artifact.execution.paths.logPath)}`
      : "",
    artifact.execution.paths.bootstrapLogPath
      ? `bootstrap ${displayPath(artifact.execution.paths.bootstrapLogPath)}`
      : "",
  ].filter(Boolean);
  return joinBlocks([
    pageHeader(
      `Run ${artifact.runId}`,
      `${verdictBadge(artifact.verdict)} ${titleCase(artifact.selection.target)} on ${backendTitle}${artifact.backend.mode ? ` | ${artifact.backend.mode}` : ""}`,
      `${artifact.execution.state} / ${artifact.execution.availability} | ${formatDuration(artifact.timing.durationMs)}`,
    ),
    block(
      "Result",
      keyValueBlock([
        ["classification", titleCase(artifact.classification.domain)],
        ["reason", artifact.classification.reason],
        [
          "counts",
          `${artifact.counts.passed}/${artifact.counts.total} passed, ${artifact.counts.failed} failed`,
        ],
        ["updated", formatIsoTimestamp(artifact.timing.finishedAt)],
        ["instance", artifact.execution.instanceId ?? ""],
        [
          "cleanup",
          artifact.execution.cleanup.details
            ? `${artifact.execution.cleanup.status} | ${artifact.execution.cleanup.details}`
            : artifact.execution.cleanup.status,
        ],
      ]),
    ),
    block(
      "Coverage",
      keyValueBlock([
        ["selection mode", humanizeLabel(artifact.selection.scenarioMode)],
        ["selection", selectionLabel],
        ["scenarios", artifact.coverage.scenarioIds.length],
        ["surfaces", artifact.coverage.surfaces.join(", ") || "none"],
        ["capabilities", artifact.coverage.capabilities.length],
        [
          "areas",
          artifact.coverage.capabilityAreas.length > 0
            ? artifact.coverage.capabilityAreas.join(", ")
            : "none",
        ],
      ]),
    ),
    ...(artifact.scenarioResults.length > 0
      ? [
          block(
            "Scenario Results",
            artifact.scenarioResults.map((scenario) => {
              const counts = `${scenario.stepCounts.passed}/${scenario.stepCounts.total} steps`;
              const details = scenario.details ? ` | ${scenario.details}` : "";
              return `${verdictBadge(scenario.verdict)} ${scenario.id} ${muted(`(${counts}${details})`)}`;
            }),
          ),
        ]
      : []),
    block(
      "Artifacts",
      artifactLines.length > 0
        ? [
            ...artifactLines,
            artifact.evidence.sourceArtifactPaths.length > 0
              ? muted(`${artifact.evidence.sourceArtifactPaths.length} additional captured path(s)`)
              : "",
          ].filter(Boolean)
        : [muted("No artifact paths recorded.")],
    ),
    ...(notes.keyed.length > 0 ? [block("Context", keyValueBlock(keyedContext))] : []),
    ...(notes.plain.length > 0 ? [block("Notes", bulletList(notes.plain))] : []),
  ]);
}
