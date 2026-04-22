/**
 * LocalOverrideManifestSource — phase-1 scaffold.
 *
 * Phase 2 goal: read per-user/per-enterprise overrides from
 * `$OPENCLAW_CONFIG_DIR/extensions/manifest.json` so operators can pin or
 * inject additional plugin entries without touching the CLI or shipping a
 * remote service.
 *
 * Phase 1: the file is read if it exists (parity with how external catalogs
 * in `channels/plugins/catalog.ts` already work), but the contract is kept
 * private so phase-2 can add richer merge semantics.
 */

import fs from "node:fs";
import path from "node:path";
import { isRecord, resolveConfigDir } from "../../utils.js";
import type { ExtensionEntry, ExtensionManifestSource, ManifestLoadContext } from "./types.js";

const OVERRIDE_RELATIVE_PATH = path.join("extensions", "manifest.json");

function parseEntries(raw: unknown): ExtensionEntry[] {
  if (!isRecord(raw)) {
    return [];
  }
  const list = raw.entries;
  if (!Array.isArray(list)) {
    return [];
  }
  const out: ExtensionEntry[] = [];
  for (const item of list) {
    if (!isRecord(item)) {
      continue;
    }
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name) {
      continue;
    }
    out.push({ ...item, name } as ExtensionEntry);
  }
  return out;
}

export function createLocalOverrideManifestSource(): ExtensionManifestSource {
  return {
    id: "local-override",
    load(ctx: ManifestLoadContext): ExtensionEntry[] {
      const env = ctx.env ?? process.env;
      const configDir = resolveConfigDir(env);
      const manifestPath = path.join(configDir, OVERRIDE_RELATIVE_PATH);
      let contents: string;
      try {
        contents = fs.readFileSync(manifestPath, "utf-8");
      } catch {
        return [];
      }
      try {
        return parseEntries(JSON.parse(contents));
      } catch {
        return [];
      }
    },
  };
}
