/**
 * Hook Echo Plugin — diagnostic/development plugin that exercises all lifecycle hooks.
 *
 * Always logs every hook event. Additionally, responds to magic trigger words
 * in the user prompt to exercise block/retry/async-intervention paths:
 *
 *   Prompt triggers (case-insensitive, matched anywhere in user message):
 *     "HOOK_BLOCK_RUN"     → before_agent_run returns block
 *     "HOOK_ASK_RUN"       → before_agent_run returns ask (human approval)
 *     "HOOK_BLOCK_OUTPUT"  → llm_output returns block with custom message
 *     "HOOK_BLOCK_RETRY"   → llm_output returns block with retry: true (test retry path)
 *     "HOOK_ASK_OUTPUT"    → llm_output returns ask (human approval)
 *     "HOOK_ASYNC_BLOCK"   → async llm_output intervenes with block
 *
 * Enable via config: plugins.entries.hook-echo.enabled = true
 */

import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

const PLUGIN_ID = "hook-echo";

/** Check if text contains a trigger (case-insensitive). */
function hasTrigger(text: string | undefined, trigger: string): boolean {
  return !!text && text.toUpperCase().includes(trigger);
}

/**
 * Extract the current user message from the assembled prompt string.
 * The prompt assembles messages chronologically, so the latest user
 * message is near the end.  We walk backwards to find the last
 * timestamp line (the current turn) and return everything from there.
 */
function extractCurrentUserMessage(prompt: string | undefined): string {
  if (!prompt) return "";
  const lines = prompt.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s/.test(lines[i])) {
      return lines.slice(i).join("\n");
    }
  }
  // No timestamp found — use last 500 chars as fallback
  return prompt.slice(-500);
}

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "Hook Echo",
  description:
    "Diagnostic plugin — logs all lifecycle hooks and exercises block/retry/async paths via trigger words",

  register(api: OpenClawPluginApi) {
    const log = api.logger ?? console;

    // ─── before_agent_run (sync) ───────────────────────────────────────
    api.on("before_agent_run", async (event, ctx) => {
      const promptPreview = (event.prompt ?? "").slice(0, 120);
      log.info(
        `[${PLUGIN_ID}] before_agent_run fired — ` +
          `prompt=${JSON.stringify(promptPreview)} ` +
          `channelId=${event.channelId ?? "none"} ` +
          `senderIsOwner=${event.senderIsOwner ?? "unknown"} ` +
          `sessionKey=${ctx.sessionKey ?? "none"} runId=${ctx.runId ?? "none"}`,
      );

      const currentUserMsg = extractCurrentUserMessage(event.prompt);

      if (hasTrigger(currentUserMsg, "HOOK_BLOCK_RUN")) {
        log.info(`[${PLUGIN_ID}] before_agent_run → BLOCKING (trigger: HOOK_BLOCK_RUN)`);
        return {
          outcome: "block" as const,
          reason: "[hook-echo] Run blocked by HOOK_BLOCK_RUN trigger",
          message: "🚫 [hook-echo] This run was blocked by the hook-echo diagnostic plugin.",
        };
      }

      if (hasTrigger(currentUserMsg, "HOOK_ASK_RUN")) {
        log.info(`[${PLUGIN_ID}] before_agent_run → ASKING (trigger: HOOK_ASK_RUN)`);
        return {
          outcome: "ask" as const,
          reason: "[hook-echo] Run requires approval — HOOK_ASK_RUN trigger",
          title: "Hook Echo: Run Approval",
          description: "The hook-echo diagnostic plugin flagged this prompt for human review.",
          severity: "warning" as const,
          timeoutMs: 60_000,
          timeoutBehavior: "deny" as const,
          denialMessage: "🚫 [hook-echo] Run denied — approval was not granted.",
        };
      }

      return { outcome: "pass" as const };
    });

    // ─── before_agent_run (async) ──────────────────────────────────────
    api.on(
      "before_agent_run",
      async (event, _ctx, controller) => {
        log.info(`[${PLUGIN_ID}] async before_agent_run started — simulating slow check`);
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (controller?.signal.aborted) {
          log.info(`[${PLUGIN_ID}] async before_agent_run — aborted, skipping`);
          return;
        }
        log.info(`[${PLUGIN_ID}] async before_agent_run — slow check complete, all clear`);
      },
      { mode: "async", timeoutMs: 5000 },
    );

    // ─── llm_output (sync) ────────────────────────────────────────────
    api.on("llm_output", async (event, ctx) => {
      const textPreview = (event.assistantTexts ?? []).join(" ").slice(0, 120);
      log.info(
        `[${PLUGIN_ID}] llm_output fired — ` +
          `texts=${JSON.stringify(textPreview)} ` +
          `model=${event.model} provider=${event.provider} ` +
          `sessionKey=${ctx.sessionKey ?? "none"} runId=${ctx.runId ?? "none"}`,
      );

      // Only check the last user message to avoid matching trigger words
      // that appear in conversation history (e.g. assistant quoting triggers).
      const currentUserMsg = extractCurrentUserMessage(event.prompt);
      if (hasTrigger(currentUserMsg, "HOOK_BLOCK_RETRY")) {
        log.info(`[${PLUGIN_ID}] llm_output → BLOCKING with retry (trigger: HOOK_BLOCK_RETRY)`);
        return {
          outcome: "block" as const,
          reason:
            "[hook-echo] Output blocked by HOOK_BLOCK_RETRY trigger — asking LLM to try again",
          message:
            "🔁 [hook-echo] Response was blocked and retried by the hook-echo diagnostic plugin.",
          retry: true,
          maxRetries: 2,
        };
      }

      if (hasTrigger(currentUserMsg, "HOOK_BLOCK_OUTPUT")) {
        log.info(`[${PLUGIN_ID}] llm_output → BLOCKING (trigger: HOOK_BLOCK_OUTPUT)`);
        return {
          outcome: "block" as const,
          reason: "[hook-echo] Output blocked by HOOK_BLOCK_OUTPUT trigger",
          message: "🔒 [hook-echo] This response was blocked by the hook-echo diagnostic plugin.",
        };
      }

      if (hasTrigger(currentUserMsg, "HOOK_ASK_OUTPUT")) {
        log.info(`[${PLUGIN_ID}] llm_output → ASKING (trigger: HOOK_ASK_OUTPUT)`);
        return {
          outcome: "ask" as const,
          reason: "[hook-echo] Output requires approval — HOOK_ASK_OUTPUT trigger",
          title: "Hook Echo: Output Review",
          description:
            "The hook-echo diagnostic plugin flagged this response for human review. Approve to deliver, deny to retract.",
          severity: "info" as const,
          timeoutMs: 60_000,
          timeoutBehavior: "deny" as const,
          denialMessage: "🔒 [hook-echo] Response withheld — approval was not granted.",
        };
      }

      return { outcome: "pass" as const };
    });

    // ─── llm_output (async) ───────────────────────────────────────────
    api.on(
      "llm_output",
      async (event, ctx, controller) => {
        const textPreview = (event.assistantTexts ?? []).join(" ").slice(0, 120);
        const currentUserMsg = extractCurrentUserMessage(event.prompt);

        log.info(`[${PLUGIN_ID}] async llm_output started`);

        // Simulate slow async analysis
        await new Promise((resolve) => setTimeout(resolve, 200));
        if (controller?.signal.aborted) {
          log.info(`[${PLUGIN_ID}] async llm_output — aborted`);
          return;
        }

        if (hasTrigger(currentUserMsg, "HOOK_ASYNC_BLOCK")) {
          log.info(
            `[${PLUGIN_ID}] async llm_output → BLOCKING via intervene (trigger: HOOK_ASYNC_BLOCK)`,
          );
          controller?.intervene({
            outcome: "block" as const,
            reason: "[hook-echo] Output async-blocked by HOOK_ASYNC_BLOCK trigger",
            message:
              "🔒 [hook-echo] This response was async-blocked by the hook-echo diagnostic plugin.",
          });
          return;
        }

        log.info(`[${PLUGIN_ID}] async llm_output — check complete, no intervention`);
      },
      { mode: "async", timeoutMs: 10000 },
    );

    // ─── after_tool_call (sync, observe-only) ─────────────────────────
    api.on("after_tool_call", async (event, ctx) => {
      log.info(
        `[${PLUGIN_ID}] after_tool_call fired — ` +
          `tool=${event.toolName} ` +
          `durationMs=${event.durationMs ?? "unknown"} ` +
          `error=${event.error ?? "none"} ` +
          `sessionKey=${ctx.sessionKey ?? "none"}`,
      );
    });
  },
});
