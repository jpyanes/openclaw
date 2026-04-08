import { resolveKovaBackend } from "../backends/registry.js";
import type { KovaBackendId, KovaRunTarget } from "../backends/types.js";
import { createKovaRunId } from "../lib/run-id.js";
import { renderArtifactSummary } from "../report.js";

function parseRunOptions(args: string[]) {
  const options: {
    target?: KovaRunTarget;
    backend?: KovaBackendId;
    providerMode?: "mock-openai" | "live-frontier";
    scenarioIds: string[];
  } = {
    scenarioIds: [],
  };

  const rest = [...args];
  const rawTarget = rest.shift();
  if (rawTarget === "qa") {
    options.target = rawTarget;
  }
  while (rest.length > 0) {
    const arg = rest.shift();
    if (arg === "--provider-mode") {
      const value = rest.shift();
      if (value === "mock-openai" || value === "live-frontier") {
        options.providerMode = value;
      }
      continue;
    }
    if (arg === "--backend") {
      const value = rest.shift();
      if (value === "host" || value === "multipass") {
        options.backend = value;
      }
      continue;
    }
    if (arg === "--scenario") {
      const value = rest.shift();
      if (value?.trim()) {
        options.scenarioIds.push(value.trim());
      }
    }
  }
  return options;
}

export async function runCommand(repoRoot: string, args: string[]) {
  const options = parseRunOptions(args);
  if (options.target !== "qa") {
    throw new Error(`unsupported kova run target: ${String(options.target ?? "")}`);
  }

  const backend = resolveKovaBackend(options.target, options.backend);
  const artifact = await backend.run({
    repoRoot,
    runId: createKovaRunId(),
    target: options.target,
    backend: options.backend,
    providerMode: options.providerMode,
    scenarioIds: options.scenarioIds.length > 0 ? options.scenarioIds : undefined,
  });
  process.stdout.write(renderArtifactSummary(artifact));
}
