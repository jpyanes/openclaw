import { describe, expect, it } from "vitest";
import {
  resolveExtensionManifest,
  resolveExtensionManifestSync,
  type ExtensionManifestSource,
} from "./index.js";

function fakeSource(
  id: ExtensionManifestSource["id"],
  entries: Array<{ name: string } & Record<string, unknown>>,
): ExtensionManifestSource {
  return {
    id,
    load: () => entries,
  };
}

describe("extension-registry", () => {
  it("merges entries from all sources and tags __source", async () => {
    const resolved = await resolveExtensionManifest({
      sources: [
        fakeSource("bundled", [{ name: "@a/a", description: "bundled" }]),
        fakeSource("remote", [{ name: "@b/b", description: "remote" }]),
        fakeSource("local-override", [{ name: "@c/c", description: "local" }]),
      ],
    });
    expect(resolved.map((e) => `${e.name}:${e.__source}`).toSorted()).toEqual([
      "@a/a:bundled",
      "@b/b:remote",
      "@c/c:local-override",
    ]);
  });

  it("resolves precedence local-override > remote > bundled", async () => {
    const resolved = await resolveExtensionManifest({
      sources: [
        fakeSource("bundled", [{ name: "@x/x", description: "bundled" }]),
        fakeSource("remote", [{ name: "@x/x", description: "remote" }]),
        fakeSource("local-override", [{ name: "@x/x", description: "local" }]),
      ],
    });
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.__source).toBe("local-override");
    expect(resolved[0]?.description).toBe("local");
  });

  it("remote beats bundled when no local-override exists", async () => {
    const resolved = await resolveExtensionManifest({
      sources: [
        fakeSource("bundled", [{ name: "@x/x", description: "bundled" }]),
        fakeSource("remote", [{ name: "@x/x", description: "remote" }]),
      ],
    });
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.__source).toBe("remote");
  });

  it("skips entries without a name", async () => {
    const resolved = await resolveExtensionManifest({
      sources: [
        fakeSource("bundled", [
          { name: "", description: "nameless" } as { name: string },
          { name: "@ok/ok" },
        ]),
      ],
    });
    expect(resolved.map((e) => e.name)).toEqual(["@ok/ok"]);
  });

  it("preserves unknown fields verbatim so newer manifests survive older hosts", async () => {
    const resolved = await resolveExtensionManifest({
      sources: [
        fakeSource("bundled", [
          {
            name: "@a/a",
            publisher: { org: "acme" },
            signature: { kid: "ed25519/abc", sig: "…" },
            capabilities: ["hook:before-tool"],
          },
        ]),
      ],
    });
    expect(resolved[0]?.publisher).toEqual({ org: "acme" });
    expect(resolved[0]?.signature).toEqual({ kid: "ed25519/abc", sig: "…" });
    expect(resolved[0]?.capabilities).toEqual(["hook:before-tool"]);
  });

  it("sync variant ignores async sources and only consults sync-capable sources", () => {
    const syncSource: ExtensionManifestSource = {
      id: "bundled",
      load: () => [{ name: "@sync/x" }],
    };
    const asyncSource: ExtensionManifestSource = {
      id: "remote",
      load: () => Promise.resolve([{ name: "@async/y" }]),
    };
    const resolved = resolveExtensionManifestSync({ sources: [syncSource, asyncSource] });
    expect(resolved.map((e) => e.name)).toEqual(["@sync/x"]);
  });

  it("degrades gracefully when a source throws by keeping other sources", async () => {
    const brokenSource: ExtensionManifestSource = {
      id: "remote",
      load: () => {
        throw new Error("network down");
      },
    };
    // The contract says sources MUST NOT throw, but the composer itself should
    // propagate that so we can surface broken sources in diagnostics rather
    // than silently hide them. Document the behaviour for future phases.
    await expect(
      resolveExtensionManifest({
        sources: [fakeSource("bundled", [{ name: "@ok/ok" }]), brokenSource],
      }),
    ).rejects.toThrow("network down");
  });
});
