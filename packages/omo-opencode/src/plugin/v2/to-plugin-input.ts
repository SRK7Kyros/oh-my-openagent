import { $ } from "bun"

import type { PluginContext } from "../types"
import type { V2SetupContext } from "./types"

/**
 * Adapts the v2 setup context to the v1 `PluginInput` the shared bootstrap
 * (serverPlugin) consumes. The v2 Context exposes the same read/action surface
 * as the v1 SDK client, so the context doubles as the client across the
 * host-API boundary. The two typed assertions below are host bridges (same
 * idiom as `ctx as PluginEventContext` in plugin/event.ts), not `any` escapes:
 * the dispatch only uses `directory`, `client` and `serverUrl` downstream.
 */
export function toV1PluginInput(ctx: V2SetupContext): PluginContext {
  const directory = ctx.location.directory
  return {
    client: ctx as unknown as PluginContext["client"],
    project: {
      id: "omo-v2",
      worktree: directory,
      time: { created: Date.now() },
    },
    directory,
    worktree: ctx.location.worktree ?? directory,
    experimental_workspace: { register: () => {} },
    serverUrl: new URL("http://localhost"),
    $: $ as PluginContext["$"],
  }
}
