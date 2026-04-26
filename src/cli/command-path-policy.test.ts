import { describe, expect, it } from "vitest";
import type { CliCommandCatalogEntry } from "./command-catalog.js";
import {
  resolveCliCatalogCommandPath,
  resolveCliCommandPathPolicy,
  resolveCliNetworkProxyPolicy,
} from "./command-path-policy.js";

describe("command-path-policy", () => {
  it("resolves status policy with shared startup semantics", () => {
    expect(resolveCliCommandPathPolicy(["status"])).toEqual({
      bypassConfigGuard: false,
      routeConfigGuard: "when-suppressed",
      loadPlugins: "never",
      hideBanner: false,
      ensureCliPath: false,
      networkProxy: "bypass",
    });
  });

  it("applies exact overrides after broader channel plugin rules", () => {
    expect(resolveCliCommandPathPolicy(["channels", "send"])).toEqual({
      bypassConfigGuard: false,
      routeConfigGuard: "never",
      loadPlugins: "always",
      hideBanner: false,
      ensureCliPath: true,
      networkProxy: "default",
    });
    expect(resolveCliCommandPathPolicy(["channels", "add"])).toEqual({
      bypassConfigGuard: false,
      routeConfigGuard: "never",
      loadPlugins: "never",
      hideBanner: false,
      ensureCliPath: true,
      networkProxy: "bypass",
    });
    expect(resolveCliCommandPathPolicy(["channels", "status"])).toEqual({
      bypassConfigGuard: false,
      routeConfigGuard: "never",
      loadPlugins: "never",
      hideBanner: false,
      ensureCliPath: true,
      networkProxy: expect.any(Function),
    });
    expect(resolveCliCommandPathPolicy(["channels", "list"])).toEqual({
      bypassConfigGuard: false,
      routeConfigGuard: "never",
      loadPlugins: "never",
      hideBanner: false,
      ensureCliPath: true,
      networkProxy: "bypass",
    });
    expect(resolveCliCommandPathPolicy(["channels", "logs"])).toEqual({
      bypassConfigGuard: false,
      routeConfigGuard: "never",
      loadPlugins: "never",
      hideBanner: false,
      ensureCliPath: true,
    });
  });

  it("keeps config-only agent commands on config-only startup", () => {
    for (const commandPath of [
      ["agents", "bind"],
      ["agents", "bindings"],
      ["agents", "unbind"],
      ["agents", "set-identity"],
      ["agents", "delete"],
    ]) {
      expect(resolveCliCommandPathPolicy(commandPath)).toEqual({
        bypassConfigGuard: false,
        routeConfigGuard: "never",
        loadPlugins: "never",
        hideBanner: false,
        ensureCliPath: true,
      });
    }
  });

  it("resolves mixed startup-only rules", () => {
    expect(resolveCliCommandPathPolicy(["configure"])).toEqual({
      bypassConfigGuard: true,
      routeConfigGuard: "never",
      loadPlugins: "never",
      hideBanner: false,
      ensureCliPath: true,
      networkProxy: "default",
    });
    expect(resolveCliCommandPathPolicy(["config", "validate"])).toEqual({
      bypassConfigGuard: true,
      routeConfigGuard: "never",
      loadPlugins: "never",
      hideBanner: false,
      ensureCliPath: true,
      networkProxy: "bypass",
    });
    expect(resolveCliCommandPathPolicy(["gateway", "status"])).toEqual({
      bypassConfigGuard: false,
      routeConfigGuard: "always",
      loadPlugins: "never",
      hideBanner: false,
      ensureCliPath: true,
      networkProxy: "bypass",
    });
    expect(resolveCliCommandPathPolicy(["plugins", "update"])).toEqual({
      bypassConfigGuard: false,
      routeConfigGuard: "never",
      loadPlugins: "never",
      hideBanner: true,
      ensureCliPath: true,
      networkProxy: "default",
    });
    expect(resolveCliCommandPathPolicy(["cron", "list"])).toEqual({
      bypassConfigGuard: true,
      routeConfigGuard: "never",
      loadPlugins: "never",
      hideBanner: false,
      ensureCliPath: true,
      networkProxy: "bypass",
    });
  });

  it("defaults unknown command paths to network proxy routing", () => {
    expect(resolveCliNetworkProxyPolicy(["node", "openclaw", "googlemeet", "login"])).toBe(
      "default",
    );
  });

  it("resolves static network proxy bypass policies from the catalog", () => {
    expect(resolveCliNetworkProxyPolicy(["node", "openclaw", "status"])).toBe("bypass");
    expect(
      resolveCliNetworkProxyPolicy(["node", "openclaw", "config", "get", "proxy.enabled"]),
    ).toBe("bypass");
    expect(resolveCliNetworkProxyPolicy(["node", "openclaw", "proxy", "start"])).toBe("bypass");
  });

  it("resolves mixed network proxy policies from argv-sensitive catalog entries", () => {
    expect(resolveCliNetworkProxyPolicy(["node", "openclaw", "gateway"])).toBe("default");
    expect(resolveCliNetworkProxyPolicy(["node", "openclaw", "gateway", "run"])).toBe("default");
    expect(resolveCliNetworkProxyPolicy(["node", "openclaw", "gateway", "health"])).toBe("bypass");
    expect(resolveCliNetworkProxyPolicy(["node", "openclaw", "node", "run"])).toBe("default");
    expect(resolveCliNetworkProxyPolicy(["node", "openclaw", "node", "status"])).toBe("bypass");
    expect(resolveCliNetworkProxyPolicy(["node", "openclaw", "agent", "--local"])).toBe("default");
    expect(resolveCliNetworkProxyPolicy(["node", "openclaw", "agent", "run"])).toBe("bypass");
    expect(resolveCliNetworkProxyPolicy(["node", "openclaw", "channels", "status"])).toBe("bypass");
    expect(
      resolveCliNetworkProxyPolicy(["node", "openclaw", "channels", "status", "--probe"]),
    ).toBe("default");
    expect(resolveCliNetworkProxyPolicy(["node", "openclaw", "models", "status"])).toBe("bypass");
    expect(resolveCliNetworkProxyPolicy(["node", "openclaw", "models", "status", "--probe"])).toBe(
      "default",
    );
    expect(resolveCliNetworkProxyPolicy(["node", "openclaw", "skills", "info", "browser"])).toBe(
      "bypass",
    );
    expect(resolveCliNetworkProxyPolicy(["node", "openclaw", "skills", "search", "browser"])).toBe(
      "default",
    );
  });

  it("uses the longest catalog command path for deep network proxy overrides", () => {
    const catalog: readonly CliCommandCatalogEntry[] = [
      { commandPath: ["nodes"], policy: { networkProxy: "bypass" } },
      {
        commandPath: ["nodes", "camera", "snap"],
        exact: true,
        policy: { networkProxy: "default" },
      },
    ];

    expect(
      resolveCliCatalogCommandPath(["node", "openclaw", "nodes", "camera", "snap"], catalog),
    ).toEqual(["nodes", "camera", "snap"]);
    expect(
      resolveCliNetworkProxyPolicy(["node", "openclaw", "nodes", "camera", "snap"], catalog),
    ).toBe("default");
    expect(
      resolveCliNetworkProxyPolicy(["node", "openclaw", "nodes", "camera", "list"], catalog),
    ).toBe("bypass");
  });

  it("stops catalog command path resolution before positional arguments", () => {
    expect(
      resolveCliCatalogCommandPath(["node", "openclaw", "config", "get", "proxy.enabled"]),
    ).toEqual(["config", "get"]);
    expect(
      resolveCliCatalogCommandPath(["node", "openclaw", "message", "send", "--to", "demo"]),
    ).toEqual(["message"]);
  });

  it("treats bare gateway invocations with options as the gateway runtime", () => {
    const argv = ["node", "openclaw", "gateway", "--port", "1234"];

    expect(resolveCliCatalogCommandPath(argv)).toEqual(["gateway"]);
    expect(resolveCliNetworkProxyPolicy(argv)).toBe("default");
  });
});
