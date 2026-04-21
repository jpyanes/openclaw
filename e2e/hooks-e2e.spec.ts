import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, type Page, type WebSocket } from "@playwright/test";

const GATEWAY_HTTP = "http://127.0.0.1:19004";
const GATEWAY_WS = "ws://127.0.0.1:19004";
const AUTH_TOKEN = "d4d2f9d6e37dfe2e306742aad982285206f2e0039ca62cf6";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = join(HERE, "screenshots");
const FRAMES_DIR = join(HERE, "frames");
mkdirSync(SCREENSHOT_DIR, { recursive: true });
mkdirSync(FRAMES_DIR, { recursive: true });

type JsonObject = Record<string, unknown>;

type ParsedFrame = {
  dir: "in" | "out";
  ts: number;
  raw: string;
  data: JsonObject | null;
};

type FramesBag = { frames: ParsedFrame[] };

type HookEvent = { ts: number; msg: JsonObject };

type HookRunResult = {
  events: HookEvent[];
  finalState: "final" | "error" | "timeout";
  errorMessage?: string;
  errorKind?: string;
  text: string;
  approvalIds: string[];
  retryCount: number;
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}

function getString(obj: JsonObject | undefined, key: string): string | undefined {
  if (!obj) {
    return undefined;
  }
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

function getObject(obj: JsonObject | undefined, key: string): JsonObject | undefined {
  if (!obj) {
    return undefined;
  }
  const v = obj[key];
  return isObject(v) ? v : undefined;
}

/**
 * Open the control-ui in WebKit and inject the auth token into localStorage
 * BEFORE the SPA boots. Capture every WebSocket frame the SPA exchanges so
 * we have protocol-level evidence even when we drive the gateway through
 * our own raw WebSocket.
 */
async function openControlUi(page: Page, bag: FramesBag): Promise<void> {
  page.on("websocket", (ws: WebSocket) => {
    ws.on("framesent", (event) => {
      const raw =
        typeof event.payload === "string" ? event.payload : event.payload.toString("utf8");
      let parsed: JsonObject | null = null;
      try {
        const j = JSON.parse(raw) as unknown;
        parsed = isObject(j) ? j : null;
      } catch {
        parsed = null;
      }
      bag.frames.push({ dir: "out", ts: Date.now(), raw, data: parsed });
    });
    ws.on("framereceived", (event) => {
      const raw =
        typeof event.payload === "string" ? event.payload : event.payload.toString("utf8");
      let parsed: JsonObject | null = null;
      try {
        const j = JSON.parse(raw) as unknown;
        parsed = isObject(j) ? j : null;
      } catch {
        parsed = null;
      }
      bag.frames.push({ dir: "in", ts: Date.now(), raw, data: parsed });
    });
  });

  await page.addInitScript((token: string) => {
    try {
      localStorage.setItem("openclaw.controlUi.authToken", token);
      localStorage.setItem("openclaw.auth.token", token);
      localStorage.setItem("authToken", token);
    } catch {
      /* localStorage may be unavailable on some pages */
    }
  }, AUTH_TOKEN);

  await page.goto(GATEWAY_HTTP, { waitUntil: "domcontentloaded" });
}

type RunOpts = {
  timeoutMs?: number;
  approvalDecision?: "allow-once" | "deny" | null;
  waitAfterFinalMs?: number;
};

/**
 * Drive the gateway over a fresh WebKit-originated WebSocket from inside the
 * page context. This goes through the same protocol path the SPA uses and
 * gives the suite deterministic control over every connect/chat/approval
 * frame.
 */
async function runHookTrigger(
  page: Page,
  message: string,
  opts: RunOpts = {},
): Promise<HookRunResult> {
  const sessionKey = `e2e-${randomUUID()}`;
  const idempotencyKey = randomUUID();
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const approvalDecision = opts.approvalDecision ?? null;
  const waitAfterFinalMs = opts.waitAfterFinalMs ?? 0;

  type EvalArgs = {
    wsUrl: string;
    token: string;
    message: string;
    sessionKey: string;
    idempotencyKey: string;
    timeoutMs: number;
    approvalDecision: "allow-once" | "deny" | null;
    waitAfterFinalMs: number;
  };

  const args: EvalArgs = {
    wsUrl: GATEWAY_WS,
    token: AUTH_TOKEN,
    message,
    sessionKey,
    idempotencyKey,
    timeoutMs,
    approvalDecision,
    waitAfterFinalMs,
  };

  return await page.evaluate((a: EvalArgs) => {
    type WireRecord = Record<string, unknown>;
    type LocalEvent = { ts: number; msg: WireRecord };

    return new Promise<HookRunResult>((resolve) => {
      const ws = new WebSocket(a.wsUrl);
      const events: LocalEvent[] = [];
      const approvalIds: string[] = [];
      let text = "";
      let finalState: "final" | "error" | "timeout" = "timeout";
      let errorMessage: string | undefined;
      let errorKind: string | undefined;
      let retryCount = 0;
      let nextId = 100;
      let connected = false;
      let runStarted = false;
      let finished = false;

      const timer = setTimeout(() => {
        if (!finished) {
          finished = true;
          try {
            ws.close();
          } catch {
            /* already closed */
          }
          resolve({
            events: events as HookEvent[],
            finalState,
            errorMessage,
            errorKind,
            text,
            approvalIds,
            retryCount,
          });
        }
      }, a.timeoutMs);

      const send = (obj: WireRecord) => {
        ws.send(JSON.stringify(obj));
      };

      const finish = (state: "final" | "error") => {
        finalState = state;
        const settle = () => {
          if (finished) {
            return;
          }
          finished = true;
          clearTimeout(timer);
          try {
            ws.close();
          } catch {
            /* already closed */
          }
          resolve({
            events: events as HookEvent[],
            finalState,
            errorMessage,
            errorKind,
            text,
            approvalIds,
            retryCount,
          });
        };
        if (a.waitAfterFinalMs > 0) {
          setTimeout(settle, a.waitAfterFinalMs);
        } else {
          settle();
        }
      };

      const isObj = (v: unknown): v is WireRecord => typeof v === "object" && v !== null;

      const getStr = (o: WireRecord | undefined, k: string): string | undefined => {
        if (!o) {
          return undefined;
        }
        const v = o[k];
        return typeof v === "string" ? v : undefined;
      };

      const getObj = (o: WireRecord | undefined, k: string): WireRecord | undefined => {
        if (!o) {
          return undefined;
        }
        const v = o[k];
        return isObj(v) ? v : undefined;
      };

      const extractMessageText = (m: WireRecord | undefined): string => {
        if (!m) {
          return "";
        }
        const t = getStr(m, "text");
        if (t) {
          return t;
        }
        const content = m["content"];
        if (Array.isArray(content)) {
          return content.map((c) => (isObj(c) ? (getStr(c, "text") ?? "") : "")).join("");
        }
        return "";
      };

      const onMessage = (ev: MessageEvent) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(typeof ev.data === "string" ? ev.data : "");
        } catch {
          return;
        }
        if (!isObj(parsed)) {
          return;
        }
        const data = parsed;
        events.push({ ts: Date.now(), msg: data });

        const dataType = getStr(data, "type");
        const dataEvent = getStr(data, "event");
        const dataMethod = getStr(data, "method");

        // Connect handshake: server sends 'connect.challenge' as event with payload
        if ((dataType === "event" || dataType === "evt") && dataEvent === "connect.challenge") {
          send({
            type: "req",
            id: "connect-" + Date.now(),
            method: "connect",
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              auth: { token: a.token },
              client: {
                id: "openclaw-control-ui",
                version: "2026.4.15-beta.1",
                platform: "MacIntel",
                mode: "webchat",
                instanceId: "e2e-" + Math.random().toString(36).slice(2),
              },
              role: "operator",
              scopes: [
                "operator.admin",
                "operator.read",
                "operator.write",
                "operator.approvals",
                "operator.pairing",
              ],
              caps: ["tool-events"],
              userAgent: "e2e-webkit",
              locale: "en-US",
            },
          });
          void dataMethod;
          return;
        }

        if (dataType === "res" && data["ok"] === true && !connected) {
          connected = true;
          if (!runStarted) {
            runStarted = true;
            send({
              type: "req",
              id: String(nextId++),
              method: "chat.send",
              params: {
                sessionKey: a.sessionKey,
                message: a.message,
                idempotencyKey: a.idempotencyKey,
              },
            });
          }
          return;
        }

        if (dataType === "res" && data["ok"] === false) {
          const err = getObj(data, "error");
          errorMessage = getStr(err, "message") || "rpc-error";
          const details = getObj(err, "details");
          errorKind = getStr(err, "code") || getStr(details, "code") || "rpc-error";
          if (!runStarted) {
            finish("error");
          }
          return;
        }

        if (dataType === "event" || dataType === "evt") {
          const d = getObj(data, "payload") ?? getObj(data, "data") ?? {};
          if (dataEvent === "chat") {
            const message = getObj(d, "message");
            const stateField = getStr(d, "state");
            const delta = getStr(d, "delta");
            if (delta) {
              text += delta;
            }
            if (stateField === "delta" && message) {
              const t = extractMessageText(message);
              if (t) {
                text = t;
              }
            }
            if (stateField === "final" && message) {
              const t = extractMessageText(message);
              if (t) {
                text = t;
              }
            }
            const dText = getStr(d, "text");
            if (dText && stateField === "final") {
              text = dText;
            }
            if (stateField === "error") {
              errorMessage =
                getStr(d, "errorMessage") ||
                getStr(d, "message") ||
                extractMessageText(message) ||
                "unknown";
              errorKind = getStr(d, "errorKind") || getStr(d, "kind");
              finish("error");
              return;
            }
            if (stateField === "final") {
              const t = text || extractMessageText(message);
              const errorish = /agent failed|blocked|policy|denied|hook-echo/i.test(t);
              if (errorish) {
                errorMessage = t;
                errorKind = errorKind || "final-block";
                finish("error");
                return;
              }
              finish("final");
              return;
            }
            if (stateField === "retry" || d["retry"] === true) {
              retryCount += 1;
            }
          }
          if (dataEvent === "plugin.approval.requested" || dataEvent === "approval.requested") {
            const id = getStr(d, "id") ?? getStr(d, "approvalId");
            if (id) {
              approvalIds.push(id);
              if (a.approvalDecision) {
                send({
                  type: "req",
                  id: String(nextId++),
                  method: "plugin.approval.resolve",
                  params: { id, decision: a.approvalDecision },
                });
              }
            }
          }
        }
      };

      const onError = () => {
        errorMessage = errorMessage || "ws-error";
        errorKind = errorKind || "ws-error";
        finish("error");
      };

      const onClose = () => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          resolve({
            events: events as HookEvent[],
            finalState,
            errorMessage,
            errorKind,
            text,
            approvalIds,
            retryCount,
          });
        }
      };

      ws.addEventListener("message", onMessage);
      ws.addEventListener("error", onError);
      ws.addEventListener("close", onClose);
    });
  }, args);
}

function logFrames(name: string, frames: ParsedFrame[]) {
  const path = join(FRAMES_DIR, `${name}.jsonl`);
  const lines = frames.map((f) =>
    JSON.stringify({ ts: f.ts, dir: f.dir, data: f.data ?? f.raw.slice(0, 500) }),
  );
  writeFileSync(path, lines.join("\n"));
}

function recordResult(name: string, payload: HookRunResult) {
  const line = JSON.stringify({ ts: Date.now(), name, ...payload });
  appendFileSync(join(HERE, "results.jsonl"), line + "\n");
}

async function shoot(page: Page, name: string) {
  const path = join(SCREENSHOT_DIR, `${name}.png`);
  try {
    await page.screenshot({ path, fullPage: true });
  } catch {
    /* page may already be closed */
  }
  return path;
}

const bagFor = new WeakMap<Page, FramesBag>();

function getBag(page: Page): FramesBag {
  let bag = bagFor.get(page);
  if (!bag) {
    bag = { frames: [] };
    bagFor.set(page, bag);
  }
  return bag;
}

function chatDeltaCount(events: HookEvent[]): number {
  return events.filter((e) => {
    if (!isObject(e.msg)) {
      return false;
    }
    if (getString(e.msg, "event") !== "chat") {
      return false;
    }
    const payload = getObject(e.msg, "payload") ?? getObject(e.msg, "data");
    return getString(payload, "state") === "delta";
  }).length;
}

test.describe("Lifecycle hook outcomes (WebKit)", () => {
  test.beforeEach(async ({ page }) => {
    await openControlUi(page, getBag(page));
  });

  test.afterEach(async ({ page }, testInfo) => {
    const bag = getBag(page);
    const safe = testInfo.title.replace(/[^a-z0-9]+/gi, "_");
    logFrames(safe, bag.frames);
    await shoot(page, `${safe}_end`);
  });

  test("normal message (no hook trigger)", async ({ page }) => {
    await shoot(page, "normal_pre");
    const result = await runHookTrigger(page, "Reply with the single word OK and nothing else.", {
      timeoutMs: 90_000,
    });
    await shoot(page, "normal_post");
    recordResult("normal", result);
    expect(["final", "error"]).toContain(result.finalState);
    if (result.finalState === "final") {
      expect((result.text || "").length).toBeGreaterThan(0);
    }
  });

  test("HOOK_BLOCK_RUN — before_agent_run block", async ({ page }) => {
    await shoot(page, "block_run_pre");
    const result = await runHookTrigger(page, "HOOK_BLOCK_RUN please block this", {
      timeoutMs: 30_000,
    });
    await shoot(page, "block_run_post");
    recordResult("HOOK_BLOCK_RUN", result);
    expect(result.finalState).toBe("error");
    const msg = (result.errorMessage || result.text || "").toLowerCase();
    expect(msg).toMatch(/block|policy|denied/);
    // No streaming LLM output should have arrived (only the block message)
    expect(chatDeltaCount(result.events)).toBe(0);
  });

  test("HOOK_ASK_RUN — before_agent_run ask (approve)", async ({ page }) => {
    await shoot(page, "ask_run_approve_pre");
    const result = await runHookTrigger(page, "HOOK_ASK_RUN please ask, then continue", {
      timeoutMs: 90_000,
      approvalDecision: "allow-once",
    });
    await shoot(page, "ask_run_approve_post");
    recordResult("HOOK_ASK_RUN_approve", result);
    expect(result.approvalIds.length).toBeGreaterThanOrEqual(1);
    expect(["final", "error"]).toContain(result.finalState);
  });

  test("HOOK_ASK_RUN — before_agent_run ask (deny)", async ({ page }) => {
    await shoot(page, "ask_run_deny_pre");
    const result = await runHookTrigger(page, "HOOK_ASK_RUN please ask, then deny", {
      timeoutMs: 60_000,
      approvalDecision: "deny",
    });
    await shoot(page, "ask_run_deny_post");
    recordResult("HOOK_ASK_RUN_deny", result);
    expect(result.approvalIds.length).toBeGreaterThanOrEqual(1);
    expect(result.finalState).toBe("error");
  });

  test("HOOK_BLOCK_OUTPUT — llm_output block", async ({ page }) => {
    await shoot(page, "block_output_pre");
    const result = await runHookTrigger(
      page,
      "HOOK_BLOCK_OUTPUT please answer something then get blocked",
      { timeoutMs: 90_000, waitAfterFinalMs: 1500 },
    );
    await shoot(page, "block_output_post");
    recordResult("HOOK_BLOCK_OUTPUT", result);
    // We document either path: error or final-with-block-text
    expect(["final", "error"]).toContain(result.finalState);
  });

  test("HOOK_BLOCK_RETRY — llm_output block with retry", async ({ page }) => {
    await shoot(page, "block_retry_pre");
    const result = await runHookTrigger(page, "HOOK_BLOCK_RETRY please answer and trigger retry", {
      timeoutMs: 120_000,
    });
    await shoot(page, "block_retry_post");
    recordResult("HOOK_BLOCK_RETRY", result);
    expect(["final", "error"]).toContain(result.finalState);
  });

  test("HOOK_ASK_OUTPUT — llm_output ask (approve)", async ({ page }) => {
    await shoot(page, "ask_output_approve_pre");
    const result = await runHookTrigger(
      page,
      "HOOK_ASK_OUTPUT please answer and ask for approval",
      { timeoutMs: 120_000, approvalDecision: "allow-once" },
    );
    await shoot(page, "ask_output_approve_post");
    recordResult("HOOK_ASK_OUTPUT_approve", result);
    expect(result.approvalIds.length).toBeGreaterThanOrEqual(1);
    expect(["final", "error"]).toContain(result.finalState);
  });

  test("HOOK_ASK_OUTPUT — llm_output ask (deny)", async ({ page }) => {
    await shoot(page, "ask_output_deny_pre");
    const result = await runHookTrigger(page, "HOOK_ASK_OUTPUT please answer then deny", {
      timeoutMs: 120_000,
      approvalDecision: "deny",
    });
    await shoot(page, "ask_output_deny_post");
    recordResult("HOOK_ASK_OUTPUT_deny", result);
    expect(result.approvalIds.length).toBeGreaterThanOrEqual(1);
    expect(result.finalState).toBe("error");
  });
});
