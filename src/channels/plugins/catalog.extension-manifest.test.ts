import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listChannelPluginCatalogEntries } from "./catalog.js";

/**
 * Phase-1 integration test for the extension manifest seam: asserts that an
 * entry declared in `extensions/manifest.json` with a `channel` payload shows
 * up in `listChannelPluginCatalogEntries` as an installable candidate (i.e.
 * available for onboard to offer to the user).
 *
 * Uses the real repo manifest so regressions that drop the manifest source
 * from the catalog merge loop are caught. The environment is pinned so the
 * test does not leak user-level catalog overrides.
 */
describe("channel catalog ← extension manifest", () => {
  let tmpConfig: string;
  let savedEnv: Record<string, string | undefined>;

  beforeAll(() => {
    tmpConfig = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-catalog-"));
    // Isolate from the developer machine: no user-level catalog overrides
    // and no state dir pollution.
    savedEnv = {
      OPENCLAW_CONFIG_DIR: process.env.OPENCLAW_CONFIG_DIR,
      OPENCLAW_STATE_DIR: process.env.OPENCLAW_STATE_DIR,
      OPENCLAW_PLUGIN_CATALOG_PATHS: process.env.OPENCLAW_PLUGIN_CATALOG_PATHS,
      OPENCLAW_MPM_CATALOG_PATHS: process.env.OPENCLAW_MPM_CATALOG_PATHS,
    };
    process.env.OPENCLAW_CONFIG_DIR = tmpConfig;
    process.env.OPENCLAW_STATE_DIR = tmpConfig;
    process.env.OPENCLAW_PLUGIN_CATALOG_PATHS = "";
    process.env.OPENCLAW_MPM_CATALOG_PATHS = "";
  });

  afterAll(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
    fs.rmSync(tmpConfig, { recursive: true, force: true });
  });

  it("includes @wecom/wecom-openclaw-plugin from extensions/manifest.json", () => {
    const entries = listChannelPluginCatalogEntries({
      workspaceDir: tmpConfig,
      env: process.env,
    });
    const wecom = entries.find((entry) => entry.id === "wecom");
    expect(wecom, "WeCom channel should be surfaced by the extension manifest").toBeDefined();
    expect(wecom?.install.npmSpec).toBe("@wecom/wecom-openclaw-plugin");
    expect(wecom?.meta.label).toBe("WeCom");
  });
});
