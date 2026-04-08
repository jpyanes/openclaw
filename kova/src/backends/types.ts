import type { KovaRunArtifact } from "../contracts/run-artifact.js";

export type KovaRunTarget = "qa";
export type KovaBackendId = "host" | "multipass";

export type KovaBackendRunSelection = {
  repoRoot: string;
  runId: string;
  target: KovaRunTarget;
  backend?: KovaBackendId;
  providerMode?: "mock-openai" | "live-frontier";
  scenarioIds?: string[];
};

export type KovaBackend = {
  id: KovaBackendId;
  supportsTarget(target: string): target is KovaRunTarget;
  run(selection: KovaBackendRunSelection): Promise<KovaRunArtifact>;
};
