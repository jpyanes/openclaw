import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBundledManifestSource } from "./bundled-source.js";
import type { ExtensionEntry } from "./types.js";

/** Bundled source is synchronous; narrow the union for ergonomic assertions. */
function loadSync(root: string): ExtensionEntry[] {
  const source = createBundledManifestSource();
  const result = source.load({ packageRoot: root });
  if (!Array.isArray(result)) {
    throw new Error("bundled source must be synchronous in phase 1");
  }
  return result;
}

describe("bundled extension manifest source", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-extensions-"));
    fs.mkdirSync(path.join(tmpRoot, "extensions"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("reads entries from extensions/manifest.json", () => {
    fs.writeFileSync(
      path.join(tmpRoot, "extensions", "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        entries: [
          {
            name: "@wecom/wecom-openclaw-plugin",
            kind: "channel",
            source: "external",
            openclaw: {
              channel: { id: "wecom", label: "WeCom" },
              install: { npmSpec: "@wecom/wecom-openclaw-plugin" },
            },
          },
        ],
      }),
    );

    const result = loadSync(tmpRoot);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("@wecom/wecom-openclaw-plugin");
    expect(result[0]?.openclaw?.channel?.id).toBe("wecom");
  });

  it("returns [] when manifest.json is missing (never crashes onboard)", () => {
    expect(loadSync(tmpRoot)).toEqual([]);
  });

  it("returns [] when manifest.json is malformed JSON", () => {
    fs.writeFileSync(path.join(tmpRoot, "extensions", "manifest.json"), "{ not json");
    expect(loadSync(tmpRoot)).toEqual([]);
  });

  it("ignores entries with no name", () => {
    fs.writeFileSync(
      path.join(tmpRoot, "extensions", "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        entries: [{ kind: "channel" }, { name: "   " }, { name: "@ok/ok" }],
      }),
    );
    expect(loadSync(tmpRoot).map((e) => e.name)).toEqual(["@ok/ok"]);
  });

  it("tolerates entries shape as object instead of array (returns [])", () => {
    fs.writeFileSync(
      path.join(tmpRoot, "extensions", "manifest.json"),
      JSON.stringify({ schemaVersion: 1, entries: {} }),
    );
    expect(loadSync(tmpRoot)).toEqual([]);
  });
});
