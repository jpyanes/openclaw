// Private runtime barrel for the bundled Nostr extension.
// Importing the public plugin-sdk/nostr surface here creates a cycle:
// runtime-api -> plugin-sdk/nostr -> setup-api -> setup-surface -> types -> config-schema.
// Keep this barrel limited to the symbols runtime code actually needs.

export { buildChannelConfigSchema } from "../../src/channels/plugins/config-schema.js";
export { formatPairingApproveHint } from "../../src/channels/plugins/helpers.js";
export type { ChannelPlugin } from "../../src/channels/plugins/types.plugin.js";
export { MarkdownConfigSchema } from "../../src/config/zod-schema.core.js";
export { DEFAULT_ACCOUNT_ID } from "../../src/routing/session-key.js";
export {
  collectStatusIssuesFromLastError,
  createDefaultChannelRuntimeState,
} from "../../src/plugin-sdk/status-helpers.js";
