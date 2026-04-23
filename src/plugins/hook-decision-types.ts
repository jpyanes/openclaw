/**
 * Hook Decision Types — Milestone 0
 *
 * Structured decision contract for gate/policy hooks.
 * Core is outcome-agnostic — it handles the mechanics of each outcome
 * without knowing *why* the decision was made.
 *
 * Any plugin can return a HookDecision from any gate hook for any purpose:
 * moderation, PII scrubbing, cost gates, compliance, etc.
 */

// ---------------------------------------------------------------------------
// HookDecision — the core discriminated union
// ---------------------------------------------------------------------------

/**
 * Structured decision returned by gate/policy hooks.
 * Core is outcome-agnostic — it handles the mechanics of each outcome
 * without knowing *why* the decision was made.
 */
export type HookDecision = HookDecisionPass | HookDecisionBlock | HookDecisionAsk;

/** Content is fine. Proceed normally. */
export type HookDecisionPass = {
  outcome: "pass";
};

/** Default user-facing replacement message when a `block` decision omits one. */
export const DEFAULT_BLOCK_MESSAGE = "This response was blocked by policy";

/** Default upper bound on retries when `block.retry === true`. */
export const DEFAULT_BLOCK_MAX_RETRIES = 3;

/**
 * Content is blocked. Core handles the mechanics:
 *  - For `llm_output`: replace the assistant response text with `message`
 *    (or the default message) and end the turn normally — NOT an error.
 *    If `retry` is true, the LLM is asked to try again until `maxRetries`
 *    is exhausted, after which the turn ends with the block message.
 *  - For `before_agent_run`: terminate the run before submitting the prompt
 *    and surface `message` to the user. `retry` is not meaningful here
 *    (the prompt has not changed) and is ignored.
 *  - For `after_tool_call`: log + surface `message` (when wired) so the
 *    blocked tool result is replaced with the policy text.
 *
 * `reason` is internal (logged, not shown). `message` is user-facing.
 */
export type HookDecisionBlock = {
  outcome: "block";
  /** Internal reason for logging/observability. Never shown to user. */
  reason: string;
  /**
   * Optional user-facing replacement text. Defaults to
   * `DEFAULT_BLOCK_MESSAGE` when not provided.
   * Preferred over the deprecated `userMessage` field.
   */
  message?: string;
  /**
   * @deprecated Prefer `message`. Retained for backwards compatibility with
   * pre-merge callers; readers must fall back to `message` when both are
   * absent.
   */
  userMessage?: string;
  /**
   * If true, retry the LLM call (same model, same prompt) instead of
   * terminating the turn. Only meaningful for `llm_output`. Default: false.
   */
  retry?: boolean;
  /**
   * Upper bound on retries when `retry` is true. Defaults to
   * `DEFAULT_BLOCK_MAX_RETRIES` (3) — guard against infinite loops.
   */
  maxRetries?: number;
  /** Plugin-defined category for analytics (e.g. "violence", "pii", "cost_limit"). */
  category?: string;
  /** Opaque metadata for the plugin's own use. Core persists but doesn't interpret. */
  metadata?: Record<string, unknown>;
};

/**
 * Content requires human approval before proceeding.
 * The pipeline pauses and an approval prompt is shown to the owner.
 * If denied (or on timeout with deny behavior), treated as block.
 */
export type HookDecisionAsk = {
  outcome: "ask";
  /** Internal reason for logging/observability. Never shown to user. */
  reason: string;
  /** Title shown in the approval prompt. Should be short and clear. */
  title: string;
  /** Description shown in the approval prompt. */
  description: string;
  /** Visual severity hint for the UI. Default: "warning". */
  severity?: "info" | "warning" | "critical";
  /** How long to wait for user response in ms. Default: 120000. Max: 600000. */
  timeoutMs?: number;
  /** What happens on timeout. Default: "deny". */
  timeoutBehavior?: "allow" | "deny";
  /** Message shown to the user if denied. Only meaningful for output gates. */
  denialMessage?: string;
  /** Plugin-defined category for analytics. */
  category?: string;
  /** Opaque metadata for the plugin's own use. Core persists but doesn't interpret. */
  metadata?: Record<string, unknown>;
};

/**
 * Resolve the user-facing message for a block decision, honoring the
 * deprecated `userMessage` field as a fallback before defaulting.
 */
export function resolveBlockMessage(decision: HookDecisionBlock): string {
  return decision.message ?? decision.userMessage ?? decision.reason ?? DEFAULT_BLOCK_MESSAGE;
}

// ---------------------------------------------------------------------------
// Decision outcome priority for merging (most-restrictive-wins)
// ---------------------------------------------------------------------------

/** Outcome severity for most-restrictive-wins merging. Higher = more restrictive. */
export const HOOK_DECISION_SEVERITY: Record<HookDecision["outcome"], number> = {
  pass: 0,
  ask: 1,
  block: 2,
};

/**
 * Merge two HookDecisions using most-restrictive-wins semantics.
 * `block > ask > pass`
 */
export function mergeHookDecisions(a: HookDecision | undefined, b: HookDecision): HookDecision {
  if (!a) {
    return b;
  }
  return HOOK_DECISION_SEVERITY[b.outcome] > HOOK_DECISION_SEVERITY[a.outcome] ? b : a;
}

/**
 * Type guard: does this object look like a HookDecision (has `outcome` field)?
 */
export function isHookDecision(value: unknown): value is HookDecision {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return v.outcome === "pass" || v.outcome === "block" || v.outcome === "ask";
}

// ---------------------------------------------------------------------------
// Phase-restricted decision types
// ---------------------------------------------------------------------------

/** Outcomes valid for input gates (before_agent_run). */
export type InputGateDecision = HookDecisionPass | HookDecisionBlock | HookDecisionAsk;

/** Outcomes valid for output gates (llm_output, after_tool_call). */
export type OutputGateDecision = HookDecision;

/**
 * A gate hook decision paired with the pluginId that produced it.
 * Returned by `runBeforeAgentRun` and `runLlmOutput` so callers can
 * attribute approval requests and audit entries to the originating plugin.
 */
export type GateHookResult = {
  decision: HookDecision;
  pluginId: string;
};

// ---------------------------------------------------------------------------
// Hook Decision Event (observability)
// ---------------------------------------------------------------------------

/**
 * Core-emitted event whenever a gate hook returns a non-pass HookDecision.
 * Not moderation-specific — fires for any plugin, for any reason.
 */
export type HookDecisionEvent = {
  timestamp: number;
  hookPoint: string;
  pluginId: string;
  decision: HookDecision;
  sessionKey: string;
  sessionId?: string;
  runId?: string;
  channelId?: string;
  senderId?: string;
  /** Duration of the hook handler execution. */
  hookDurationMs: number;
  /** Whether channel retraction was attempted and succeeded. */
  channelRetractionResult?: "success" | "fallback" | "not_attempted";
};

// ---------------------------------------------------------------------------
// HookController — async intervention handle
// ---------------------------------------------------------------------------

/**
 * Controller for async (non-blocking) hook handlers.
 * Allows retroactive intervention in the running pipeline.
 *
 * intervene() ALWAYS performs all steps (no branching on pipeline state):
 * 1. Abort the stream (if running) or prevent start
 * 2. Redact any persisted content from the session transcript
 * 3. Best-effort channel retraction (delete/edit delivered messages)
 * 4. Surface replacement message to the user
 */
export type HookController = {
  /** Aborted when the intervention window closes (timeout or pipeline cleanup). */
  signal: AbortSignal;
  /** Intervene in the running pipeline. Always stops + replaces persisted content. */
  intervene(decision: HookDecision): void;
};

// ---------------------------------------------------------------------------
// Redaction audit entry
// ---------------------------------------------------------------------------

/**
 * Entry written to the per-session redaction audit log.
 * Contains hashes, not content (the redacted content is gone forever).
 */
export type RedactionAuditEntry = {
  /** Timestamp of the redaction. */
  ts: number;
  /** The hook point that triggered the redaction. */
  hookPoint: string;
  /** Which plugin requested the redaction. */
  pluginId: string;
  /** Internal reason for the redaction. */
  reason: string;
  /** Plugin-defined category. */
  category?: string;
  /** SHA-256 hash of the redacted content (not the content itself). */
  contentHash?: string;
  /** Number of messages removed from the transcript. */
  messagesRemoved: number;
};
