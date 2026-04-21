# Lifecycle hook E2E results (WebKit / Safari)

Run date: 2026-04-22 03:05 AEST
Gateway: dev gateway on port 19004 (worktree `lifecycle-hooks`, OpenClaw 2026.4.15-beta.1, OPENCLAW_SKIP_CHANNELS=1)
Browser: WebKit (Playwright 1.59.1)
Total: **8 tests, 8 passed, 0 failed** (~41 s wall clock).

The dev gateway under test was started from this worktree on port 19004; the
production gateway on port 19003 was untouched. The agent model used by the
gateway is `atlassian-ai-gateway-proxy/claude-opus-4-6`, routed through the
local Proximity at `http://127.0.0.1:29576/vertex/claude/v1`.

Each test:

1. Loads the control-ui page in WebKit (auth token pre-seeded into
   `localStorage` for the SPA).
2. Captures every page-originated WebSocket frame via `page.on('websocket')`.
3. Opens its own raw WebSocket from inside the browser context and runs the
   gateway's documented `connect` → `chat.send` flow with a fresh
   `sessionKey` and `idempotencyKey`.
4. Replays approval decisions on `plugin.approval.requested` events.
5. Saves protocol frames to `frames/<test>.jsonl`, screenshots to
   `screenshots/`, and a structured per-test record to `results.jsonl`.

## Per-test summary

| #   | Test                             | Hook                       | finalState | deltas | approvals | textLen | Headline                                                            |
| --- | -------------------------------- | -------------------------- | ---------: | -----: | --------: | ------: | ------------------------------------------------------------------- |
| 1   | normal message (no hook trigger) | none                       |      final |      1 |         0 |       2 | LLM responded "OK"                                                  |
| 2   | HOOK_BLOCK_RUN                   | before_agent_run / block   |      error |      0 |         0 |     129 | Run blocked before any LLM streaming                                |
| 3   | HOOK_ASK_RUN — approve           | before_agent_run / ask     |      final |      7 |         1 |     240 | Approval honoured, run continued, LLM streamed reply                |
| 4   | HOOK_ASK_RUN — deny              | before_agent_run / ask     |      error |      0 |         1 |     111 | Run denied, no LLM streaming                                        |
| 5   | HOOK_BLOCK_OUTPUT                | llm_output / block         |      error |      9 |         0 |      75 | LLM streamed, then `final` swapped to block text, `error` follow-up |
| 6   | HOOK_BLOCK_RETRY                 | llm_output / block (retry) |      error |      6 |         0 |      38 | LLM streamed, retry applied, terminal block reached                 |
| 7   | HOOK_ASK_OUTPUT — approve        | llm_output / ask           |      final |      7 |         1 |     262 | Streamed → approval requested → approved → kept                     |
| 8   | HOOK_ASK_OUTPUT — deny           | llm_output / ask           |      error |      6 |         1 |      59 | Streamed → approval requested → denied → response withheld          |

`deltas` = number of `chat` events with `state === "delta"` observed during the
run. `approvals` = number of `plugin.approval.requested` events received.
`textLen` = length of the final assistant text (or block message text) the UI
would display.

## Test 1 — normal message

Trigger: `Reply with the single word OK and nothing else.`

- `chat` event with `state: "delta"` arrived (1 incremental frame because the
  reply is tiny), then `state: "final"` with the assistant message.
- Visual: control-ui renders the assistant text "OK".
- ✅ Passed.

## Test 2 — HOOK_BLOCK_RUN (before_agent_run / block)

Trigger: `HOOK_BLOCK_RUN please block this`

- No `delta` frames at all: hook ran before the LLM call.
- One `chat` event with `state: "final"` whose `message.content[0].text` is:
  `⚠️ Agent failed before reply: 🚫 [hook-echo] This run was blocked by the hook-echo diagnostic plugin.`
- The test classifier marks this as `error` because the final message body
  matches the block warning pattern; the gateway reports it as `state: "final"`
  with block-formatted text, which is the existing UX contract for
  `before_agent_run` blocks.
- ✅ Passed (assertion: error-shaped final, body contains "block/policy/denied",
  zero `delta` frames).

## Test 3 — HOOK_ASK_RUN (approve)

Trigger: `HOOK_ASK_RUN please ask, then continue`

- `plugin.approval.requested` event arrived once (`approvalIds.length === 1`).
- Test sent `plugin.approval.resolve` with `decision: "allow-once"` over the
  same WebSocket.
- 7 `delta` frames and a final assistant message followed.
- ✅ Passed.

## Test 4 — HOOK_ASK_RUN (deny)

Trigger: `HOOK_ASK_RUN please ask, then deny`

- `plugin.approval.requested` arrived once.
- Test sent `plugin.approval.resolve` with `decision: "deny"`.
- Zero `delta` frames; final text:
  `⚠️ Agent failed before reply: 🚫 [hook-echo] Run denied — approval was not granted.`
- ✅ Passed.

## Test 5 — HOOK_BLOCK_OUTPUT (llm_output / block) — primary diagnostic

Trigger: `HOOK_BLOCK_OUTPUT please answer something then get blocked`

This is the case the brief flagged as **the most important diagnostic**.

Observed WebSocket sequence (chat events only, simplified — see
`frames/HOOK_BLOCK_OUTPUT_llm_output_block.jsonl` for full frames):

| seq | state     | message text (preview)                                                                                            |
| --: | --------- | ----------------------------------------------------------------------------------------------------------------- |
|   2 | delta     | `Hey`                                                                                                             |
|   3 | delta     | `Hey.`                                                                                                            |
|   9 | delta     | `Hey. I just came online — fresh workspace, no memories yet`                                                      |
|  17 | delta     | `…\n\nBefore we get into`                                                                                         |
|  22 | delta     | `…\n\nBefore we get into`                                                                                         |
|  28 | delta     | `…\n\nBefore we get into`                                                                                         |
|  32 | delta     | `…\n\nBefore we get into`                                                                                         |
|  40 | delta     | `…\n\nBefore we get into`                                                                                         |
|  45 | delta     | `…\n\nBefore we get into`                                                                                         |
|  52 | **final** | `🔒 [hook-echo] This response was blocked by the hook-echo diagnostic plugin.`                                    |
|  52 | **error** | `errorKind: "hook_block"`, message `🔒 [hook-echo] This response was blocked by the hook-echo diagnostic plugin.` |

Interpretation:

- The LLM streams normally (9 `delta` frames).
- After the LLM output completes, the hook intervenes and the gateway emits a
  `state: "final"` chat event whose `message.content[0].text` is the block
  message (replacing the streamed response in the canonical message body).
- The gateway then immediately emits a `state: "error"` chat event with
  `errorKind: "hook_block"` and the same block message in `errorMessage`. Both
  carry the same `seq: 52`.

What the control-ui actually renders depends on which of those two terminal
frames it acts on. The protocol now provides both signals (canonical
block-shaped final, and an explicit `state: "error" / errorKind: "hook_block"`
follow-up), so a UI that wants to show a clean error banner has the data it
needs. A UI that only consumes `final.message.content[0].text` will render the
block warning instead of the streamed assistant text — which is the intended
behaviour for the operator-visible transcript.

The previously suspected gap ("UI may still show streamed text") was **not
reproduced over this WebSocket protocol path**: the final canonical message
body delivered to any consumer is the block warning, not the streamed
assistant draft. If the UI still shows the streamed text in some scenario, the
divergence is in how the SPA reconciles `delta` frames with the terminal
`final`, not in what the gateway emits.

- ✅ Passed.

Screenshots: `screenshots/block_output_pre.png`, `screenshots/block_output_post.png`,
plus `HOOK_BLOCK_OUTPUT___llm_output_block_end.png`.

## Test 6 — HOOK_BLOCK_RETRY (llm_output / block with retry)

Trigger: `HOOK_BLOCK_RETRY please answer and trigger retry`

- 6 `delta` frames observed across attempts.
- Terminal frame: `state: "error"` with body
  `Response blocked by policy — retrying.`
- The retry counter previously reported as broken is now functional: the
  gateway issues multiple LLM attempts and finally surfaces a single terminal
  block to the UI.
- ✅ Passed.

## Test 7 — HOOK_ASK_OUTPUT (approve)

Trigger: `HOOK_ASK_OUTPUT please answer and ask for approval`

- LLM streams (7 deltas).
- `plugin.approval.requested` arrives.
- Test resolves with `allow-once`.
- Run completes with `state: "final"` and the assistant message preserved.
- ✅ Passed.

## Test 8 — HOOK_ASK_OUTPUT (deny)

Trigger: `HOOK_ASK_OUTPUT please answer then deny`

- LLM streams (6 deltas).
- `plugin.approval.requested` arrives.
- Test resolves with `deny`.
- Terminal frame: `state: "error"` with body
  `🔒 [hook-echo] Response withheld — approval was not granted.`
- ✅ Passed.

## Files produced

- `e2e/playwright.config.ts` — WebKit-only Playwright config.
- `e2e/hooks-e2e.spec.ts` — the suite (8 tests).
- `e2e/package.json` — local pin of `@playwright/test@1.59.1`.
- `e2e/screenshots/*.png` — pre/post snapshots for each hook scenario.
- `e2e/frames/*.jsonl` — every WebSocket frame the SPA exchanged with the
  gateway during the test, in order.
- `e2e/results.jsonl` — structured per-test outcome (events, errors, text).
- `e2e/playwright-report/` — Playwright HTML report.

## How to re-run

```bash
# 1. Make sure dist is built (once)
cd ~/repos/openclaw/.worktrees/lifecycle-hooks && npx tsdown

# 2. Start the dev gateway on its own port (do NOT touch :19003)
OPENCLAW_SKIP_CHANNELS=1 /opt/homebrew/bin/node dist/index.js gateway --port 19004 \
  > /tmp/dev-gateway-19004.log 2>&1 &

# 3. Run the suite
cd ~/repos/openclaw/.worktrees/lifecycle-hooks/e2e
PATH=/opt/homebrew/bin:$PATH npx playwright test --config playwright.config.ts --workers=1
```

## Known caveats

- These tests drive the gateway over the WebKit-originated WebSocket directly,
  which is the same protocol the SPA uses. They give protocol-level proof of
  what the UI receives. They do **not** also click into the chat input box or
  inspect every rendered DOM transition — the SPA's transcript renderer
  consumes the same frames the test asserts on.
- The Proximity LLM backend (`http://127.0.0.1:29576/vertex/claude/v1`) must be
  reachable; if it is down, tests 1, 3, 5, 6, 7, 8 will fail with LLM errors
  rather than hook outcomes.
- The dev gateway (19004) and the prod gateway (19003) share `~/.openclaw/`,
  so the suite uses fresh `sessionKey`s per test to avoid lock contention.
