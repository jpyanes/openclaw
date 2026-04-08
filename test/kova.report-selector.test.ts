import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  formatKovaSelectorFilters,
  hasKovaSelectorFilters,
  parseKovaSelectorFilters,
} from "../kova/src/commands/selector-filters.ts";
import { kovaRunArtifactSchema } from "../kova/src/contracts/run-artifact.ts";
import { renderArtifactSummary, resolveLatestRunId } from "../kova/src/report.ts";

describe("kova report and selector regressions", () => {
  let tempRoot = "";
  let repoRoot = "";

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kova-report-selector-"));
    repoRoot = path.join(tempRoot, "repo");
  });

  beforeEach(async () => {
    await fs.rm(repoRoot, { recursive: true, force: true });
    await fs.mkdir(path.join(repoRoot, ".artifacts", "kova"), { recursive: true });
  });

  afterAll(async () => {
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("returns latestRunId from the run index when no indexed runs exist and no filters are set", async () => {
    await fs.writeFile(
      path.join(repoRoot, ".artifacts", "kova", "run-index.json"),
      JSON.stringify(
        {
          latestRunId: "kova_test_003",
          runs: [],
        },
        null,
        2,
      ),
      "utf8",
    );

    await expect(resolveLatestRunId(repoRoot)).resolves.toBe("kova_test_003");
  });

  it("renders captured source artifact paths for blocked runs without named artifact paths", () => {
    const artifact = kovaRunArtifactSchema.parse({
      schemaVersion: 1,
      runId: "kova_test_blocked",
      selection: {
        command: "run",
        target: "qa",
        suite: "qa",
        scenarioMode: "explicit",
        scenarioIds: ["channel-chat-baseline"],
        axes: {},
      },
      scenario: {
        id: "qa",
        title: "QA",
        category: "qa",
        capabilities: ["lane.qa"],
      },
      backend: {
        id: "host",
        title: "Host runtime",
        kind: "host",
        runner: "host",
        binary: "node",
      },
      environment: {
        os: "darwin",
        arch: "arm64",
        nodeVersion: "v24.13.0",
        gitDirty: true,
      },
      status: "infra_failed",
      verdict: "blocked",
      classification: {
        domain: "backend",
        reason: "synthetic failure",
      },
      timing: {
        startedAt: "2026-04-08T17:00:00.000Z",
        finishedAt: "2026-04-08T17:00:00.010Z",
        durationMs: 10,
      },
      counts: {
        total: 0,
        passed: 0,
        failed: 0,
      },
      coverage: {
        scenarioIds: ["channel-chat-baseline"],
        capabilities: ["lane.qa"],
        capabilityAreas: ["qa"],
        surfaces: ["channel"],
      },
      execution: {
        state: "failed",
        availability: "available",
        cleanup: {
          status: "not_needed",
        },
        resources: {},
        paths: {},
      },
      scenarioResults: [],
      evidence: {
        sourceArtifactPaths: [
          ".artifacts/kova/runs/kova_test_blocked/qa-output",
          ".artifacts/kova/runs/kova_test_blocked/run.json",
        ],
      },
      notes: [],
    });

    const summary = renderArtifactSummary(artifact);

    expect(summary).toContain("captured .artifacts/kova/runs/kova_test_blocked/qa-output");
    expect(summary).toContain("captured .artifacts/kova/runs/kova_test_blocked/run.json");
    expect(summary).not.toContain("No artifact paths recorded.");
  });

  it("returns undefined filters when none are passed and preserves explicit selector filters", () => {
    expect(parseKovaSelectorFilters(["latest"])).toEqual({
      filters: undefined,
      rest: ["latest"],
    });

    expect(
      parseKovaSelectorFilters([
        "--target",
        "qa",
        "--backend",
        "host",
        "--guest",
        "linux",
        "--mode",
        "fresh",
        "--provider",
        "openai",
        "latest",
      ]),
    ).toEqual({
      filters: {
        target: "qa",
        backend: "host",
        guest: "linux",
        mode: "fresh",
        provider: "openai",
      },
      rest: ["latest"],
    });
  });

  it("treats missing selector filters as empty formatting state", () => {
    expect(hasKovaSelectorFilters(undefined)).toBe(false);
    expect(formatKovaSelectorFilters(undefined)).toBe("");
  });
});
