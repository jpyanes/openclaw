import { isHelpFlag, renderReportHelp } from "../help.js";
import { readKovaArtifact, renderArtifactSummary, resolveLatestRunId } from "../report.js";
import { parseKovaSelectorFilters } from "./selector-filters.js";

function parseReportArgs(args: string[]) {
  const json = args.includes("--json");
  const retainedArgs = args.filter((arg) => arg !== "--json");
  const { filters, rest } = parseKovaSelectorFilters(retainedArgs);
  return {
    json,
    selector: rest[0] ?? "latest",
    filters,
  };
}

export async function reportCommand(repoRoot: string, args: string[]) {
  if (isHelpFlag(args)) {
    process.stdout.write(renderReportHelp());
    return;
  }
  const options = parseReportArgs(args);
  const runId =
    options.selector === "latest"
      ? await resolveLatestRunId(repoRoot, options.filters)
      : options.selector;
  if (!runId) {
    throw new Error(
      "no Kova runs found for the requested report selection. Record a matching run first.",
    );
  }
  const artifact = await readKovaArtifact(repoRoot, runId);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
    return;
  }
  process.stdout.write(renderArtifactSummary(artifact));
}
