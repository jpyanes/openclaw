/**
 * BundledManifestSource — reads `extensions/manifest.json` from the OpenClaw
 * package root. This is the authoritative phase-1 data source for external
 * (not-in-tree) extensions.
 *
 * Invariants:
 * - Missing/invalid manifest MUST NOT throw. A broken manifest is the same as
 *   "no external extensions available", which degrades onboard gracefully to
 *   only showing bundled (in-tree) plugins.
 * - Unknown fields on entries are preserved verbatim so newer hosts can read
 *   older manifests without data loss.
 */

import fs from "node:fs";
import path from "node:path";
import { resolveOpenClawPackageRootSync } from "../../infra/openclaw-root.js";
import { isRecord } from "../../utils.js";
import type { ExtensionEntry, ExtensionManifestSource, ManifestLoadContext } from "./types.js";

const MANIFEST_FILE_NAME = "manifest.json";
const MANIFEST_DIR_NAME = "extensions";

function resolvePackageRoot(ctx: ManifestLoadContext): string | undefined {
  if (ctx.packageRoot) {
    return ctx.packageRoot;
  }
  return (
    resolveOpenClawPackageRootSync({
      cwd: process.cwd(),
      moduleUrl: import.meta.url,
    }) ?? undefined
  );
}

function parseManifestEntries(raw: unknown): ExtensionEntry[] {
  if (!isRecord(raw)) {
    return [];
  }
  const entries = raw.entries;
  if (!Array.isArray(entries)) {
    return [];
  }
  const normalized: ExtensionEntry[] = [];
  for (const candidate of entries) {
    if (!isRecord(candidate)) {
      continue;
    }
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    if (!name) {
      continue;
    }
    // Preserve unknown fields verbatim (signature, publisher, …) so host-ahead
    // manifests round-trip cleanly through older installations.
    normalized.push({ ...candidate, name } as ExtensionEntry);
  }
  return normalized;
}

export function createBundledManifestSource(): ExtensionManifestSource {
  return {
    id: "bundled",
    load(ctx) {
      const packageRoot = resolvePackageRoot(ctx);
      if (!packageRoot) {
        return [];
      }
      const manifestPath = path.join(packageRoot, MANIFEST_DIR_NAME, MANIFEST_FILE_NAME);
      let contents: string;
      try {
        contents = fs.readFileSync(manifestPath, "utf-8");
      } catch {
        return [];
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(contents);
      } catch {
        // Broken JSON → treat as "no manifest" (never crash onboard).
        return [];
      }
      return parseManifestEntries(parsed);
    },
  };
}
