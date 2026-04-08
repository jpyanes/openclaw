import { listKovaBackends, listKovaTargets } from "../backends/registry.js";
import type { KovaRunTarget } from "../backends/types.js";
import { listKovaCapabilities } from "../capabilities/registry.js";
import { listKovaQaScenarios, summarizeKovaQaSurfaces } from "../catalog/qa.js";
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
  table,
} from "../console/format.js";
import {
  isHelpFlag,
  renderListBackendsHelp,
  renderListCapabilitiesHelp,
  renderListHelp,
  renderListRunsHelp,
  renderListScenariosHelp,
  renderListSurfacesHelp,
  renderListTargetsHelp,
} from "../help.js";
import { hydrateKovaRunIndex } from "../lib/run-index.js";
import { matchesKovaSelectorFilters, parseKovaSelectorFilters } from "./selector-filters.js";

const kovaListSubjects = [
  ["runs", "recorded verification runs"],
  ["targets", "registered verification targets"],
  ["backends [target]", "execution backends for a target"],
  ["scenarios [qa]", "scenario catalog entries for a target"],
  ["surfaces [qa]", "scenario coverage surfaces for a target"],
  ["capabilities", "capability registry entries"],
] as const;

function formatTargetLabel(target: string) {
  return target.toLowerCase() === "qa" ? "QA" : target;
}

function formatGroupLabel(value: string) {
  const normalized = value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return normalized
    .replace(/\bQa\b/g, "QA")
    .replace(/\bDm\b/g, "DM")
    .replace(/\bMcp\b/g, "MCP");
}

function parseListArgs(args: string[]) {
  const json = args.includes("--json");
  const all = args.includes("--all");
  const retainedArgs = args.filter((arg) => arg !== "--json" && arg !== "--all");
  const { filters, rest } = parseKovaSelectorFilters(retainedArgs);
  const [subject, maybeTarget] = rest;
  const target =
    filters.target ??
    (maybeTarget === "qa" || maybeTarget === "parallels" ? maybeTarget : undefined);
  return {
    subject,
    target,
    backend: filters.backend,
    guest: filters.guest,
    mode: filters.mode,
    provider: filters.provider,
    all,
    json,
  };
}

function filterRuns(
  runs: Awaited<ReturnType<typeof hydrateKovaRunIndex>>["runs"],
  filters: {
    target?: KovaRunTarget;
    backend?: string;
    guest?: string;
    mode?: string;
    provider?: string;
  },
) {
  return runs.filter((run) => matchesKovaSelectorFilters(run, filters));
}

function groupLines<T>(items: T[], keyOf: (item: T) => string, render: (item: T) => string) {
  const groups = new Map<string, string[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key) ?? [];
    group.push(render(item));
    groups.set(key, group);
  }
  return [...groups.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, lines]) => [key, ...lines.map((line) => `  ${line}`)]);
}

function renderTargetLines() {
  return joinBlocks([
    pageHeader("Kova Targets", "Verification targets registered in Kova"),
    block("Available Targets", bulletList(listKovaTargets())),
  ]);
}

function renderBackendLines(target?: KovaRunTarget) {
  const label = target ? `Backends (${target})` : "Backends";
  const rows = listKovaBackends(target).map((backend) => [
    backend.id,
    backend.title,
    backend.binary ?? "",
  ]);
  return joinBlocks([
    pageHeader(
      label,
      target
        ? `Execution backends available for ${target}`
        : "Execution backends available to Kova",
    ),
    block("Catalog", table(["backend", "runtime", "binary"], rows)),
  ]);
}

function renderScenarioLines(target?: KovaRunTarget) {
  const resolvedTarget: "qa" = target ?? "qa";
  const scenarios = listKovaQaScenarios();
  return joinBlocks([
    pageHeader(
      `${resolvedTarget.toUpperCase()} Scenarios`,
      `${scenarios.length} scenario${scenarios.length === 1 ? "" : "s"} loaded from the QA catalog`,
    ),
    block(
      "By Surface",
      groupLines(
        scenarios,
        (scenario) =>
          `${formatGroupLabel(scenario.surface)} ${muted(`(${scenarios.filter((entry) => entry.surface === scenario.surface).length})`)}`,
        (scenario) =>
          `${scenario.id}  ${muted(`- ${scenario.title}`)}${scenario.sourcePath ? `\n    ${muted(displayPath(scenario.sourcePath))}` : ""}`,
      ),
    ),
  ]);
}

function renderSurfaceLines(target?: KovaRunTarget) {
  const resolvedTarget: "qa" = target ?? "qa";
  const surfaces = summarizeKovaQaSurfaces();
  return joinBlocks([
    pageHeader(
      `${resolvedTarget.toUpperCase()} Surfaces`,
      `${surfaces.length} execution surface${surfaces.length === 1 ? "" : "s"} represented in the QA catalog`,
    ),
    block(
      "Coverage",
      table(
        ["surface", "scenarios"],
        surfaces.map((surface) => [surface.surface, String(surface.scenarioCount)]),
      ),
    ),
  ]);
}

function renderCapabilityLines() {
  const capabilities = listKovaCapabilities();
  return joinBlocks([
    pageHeader("Kova Capabilities", `${capabilities.length} product guarantees tracked by Kova`),
    block(
      "By Area",
      groupLines(
        capabilities,
        (capability) => formatGroupLabel(capability.area),
        (capability) =>
          `${capability.id}  ${muted(`- ${capability.title}`)}\n    ${muted(capability.description)}`,
      ),
    ),
  ]);
}

function renderListSubjects() {
  return joinBlocks([
    pageHeader("Kova List", "Browse structured Kova data by subject"),
    block("Subjects", table(["subject", "description"], [...kovaListSubjects])),
  ]);
}

function renderRunLines(
  latestRunId: string | undefined,
  runs: Awaited<ReturnType<typeof hydrateKovaRunIndex>>["runs"],
  filters: {
    target?: KovaRunTarget;
    backend?: string;
    guest?: string;
    mode?: string;
    provider?: string;
  },
  showAll = false,
) {
  const filterLabels = [
    filters.target ? `target=${filters.target}` : "",
    filters.backend ? `backend=${filters.backend}` : "",
    filters.guest ? `guest=${filters.guest}` : "",
    filters.mode ? `mode=${filters.mode}` : "",
    filters.provider ? `provider=${filters.provider}` : "",
  ].filter(Boolean);
  const visibleRuns = showAll ? runs.toReversed() : runs.toReversed().slice(0, 12);
  const verdictCounts = runs.reduce<Record<string, number>>((counts, run) => {
    counts[run.verdict] = (counts[run.verdict] ?? 0) + 1;
    return counts;
  }, {});
  return joinBlocks([
    pageHeader(
      "Run History",
      `${runs.length} recorded run${runs.length === 1 ? "" : "s"}${latestRunId ? ` | latest ${latestRunId}` : ""}`,
      filterLabels.length > 0
        ? `Filtered by ${filterLabels.join(", ")}${showAll ? "" : " | most recent 12 shown"}`
        : showAll
          ? undefined
          : "Showing the most recent 12. Use --all for full history.",
    ),
    block(
      "Summary",
      keyValueBlock([
        ["pass", verdictCounts.pass ?? 0],
        ["blocked", verdictCounts.blocked ?? 0],
        ["fail", verdictCounts.fail ?? 0],
        ["degraded", verdictCounts.degraded ?? 0],
        ["flaky", verdictCounts.flaky ?? 0],
      ]),
    ),
    block(
      "History",
      visibleRuns.length > 0
        ? table(
            ["updated", "verdict", "run", "target", "backend", "axes", "duration"],
            visibleRuns.map((run) => [
              formatIsoTimestamp(run.updatedAt),
              run.verdict.toUpperCase(),
              run.runId,
              formatTargetLabel(run.selection.target),
              run.backend.id ?? run.backend.kind,
              Object.entries(run.selection.axes ?? {})
                .map(([key, value]) => `${key}=${String(value)}`)
                .join(", ") || "none",
              formatDuration(run.timing.durationMs),
            ]),
          )
        : [muted("No runs matched the current filters.")],
    ),
  ]);
}

export async function listCommand(repoRoot: string, args: string[]) {
  if (isHelpFlag(args)) {
    const subject = args.find((arg) => arg !== "--help" && arg !== "-h");
    if (subject === "runs") {
      process.stdout.write(renderListRunsHelp());
      return;
    }
    if (subject === "targets") {
      process.stdout.write(renderListTargetsHelp());
      return;
    }
    if (subject === "backends") {
      process.stdout.write(renderListBackendsHelp());
      return;
    }
    if (subject === "scenarios") {
      process.stdout.write(renderListScenariosHelp());
      return;
    }
    if (subject === "surfaces") {
      process.stdout.write(renderListSurfacesHelp());
      return;
    }
    if (subject === "capabilities") {
      process.stdout.write(renderListCapabilitiesHelp());
      return;
    }
    process.stdout.write(renderListHelp());
    return;
  }
  const options = parseListArgs(args);

  if (!options.subject) {
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            subjects: kovaListSubjects.map(([subject, description]) => ({
              subject,
              description,
            })),
          },
          null,
          2,
        )}\n`,
      );
      return;
    }
    process.stdout.write(renderListSubjects());
    return;
  }

  if (options.subject === "runs") {
    const index = await hydrateKovaRunIndex(repoRoot);
    const filteredRuns = filterRuns(index.runs, {
      target: options.target,
      backend: options.backend,
      guest: options.guest,
      mode: options.mode,
      provider: options.provider,
    });
    const latestRunId = filteredRuns.at(-1)?.runId;
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            latestRunId: latestRunId ?? null,
            filters: {
              target: options.target ?? null,
              backend: options.backend ?? null,
              guest: options.guest ?? null,
              mode: options.mode ?? null,
              provider: options.provider ?? null,
            },
            runs: filteredRuns,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }
    process.stdout.write(
      renderRunLines(
        latestRunId,
        filteredRuns,
        {
          target: options.target,
          backend: options.backend,
          guest: options.guest,
          mode: options.mode,
          provider: options.provider,
        },
        options.all,
      ),
    );
    return;
  }

  if (options.subject === "targets") {
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ targets: listKovaTargets() }, null, 2)}\n`);
      return;
    }
    process.stdout.write(renderTargetLines());
    return;
  }

  if (options.subject === "backends") {
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            target: options.target ?? null,
            backends: listKovaBackends(options.target).map((backend) => ({
              id: backend.id,
              title: backend.title,
            })),
          },
          null,
          2,
        )}\n`,
      );
      return;
    }
    process.stdout.write(renderBackendLines(options.target));
    return;
  }

  if (options.subject === "scenarios") {
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            target: options.target ?? "qa",
            scenarios: listKovaQaScenarios(),
          },
          null,
          2,
        )}\n`,
      );
      return;
    }
    process.stdout.write(renderScenarioLines(options.target));
    return;
  }

  if (options.subject === "surfaces") {
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            target: options.target ?? "qa",
            surfaces: summarizeKovaQaSurfaces(),
          },
          null,
          2,
        )}\n`,
      );
      return;
    }
    process.stdout.write(renderSurfaceLines(options.target));
    return;
  }

  if (options.subject === "capabilities") {
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            capabilities: listKovaCapabilities(),
          },
          null,
          2,
        )}\n`,
      );
      return;
    }
    process.stdout.write(renderCapabilityLines());
    return;
  }

  throw new Error(
    `unsupported Kova list subject: ${options.subject}. Use 'kova --help' to inspect supported list subjects.`,
  );
}
