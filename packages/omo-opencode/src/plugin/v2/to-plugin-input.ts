import { $ } from "bun"

import type { PluginContext } from "../types"
import type { V2SetupContext } from "./types"

/**
 * Adapts the v2 setup context to the v1 `PluginInput` the shared bootstrap
 * (serverPlugin) consumes.
 *
 * The slice of the v1 SDK client surface that dispatch handlers touch is
 * rebuilt on the v2 context domains. `session.get` translates the v1
 * `{path: {id}}` call shape to v2's `{sessionID}` (the v2.0.18 host
 * schema-errors on any other key). `session.messages` degrades to an empty
 * page: the v2 plugin context exposes no messages API, so btw-side
 * parent-context injection is a no-op on v2. `tui.showToast` is a no-op:
 * the v2 server context has no TUI service, yet several chat.message hooks
 * (no-sisyphus-gpt, no-hephaestus-non-gpt, keyword-detector,
 * auto-update-checker) call `client.tui.showToast` directly, so its absence
 * threw `TypeError: undefined is not an object (evaluating 'tui.showToast')`
 * and failed every /prompt with HTTP 500. `showToast` is the only `tui.*`
 * member OMO touches.
 *
 * Audited v1 client members on the prompt path:
 * - `tui.showToast` — required; added here.
 * - `session.get` / `session.messages` — required; rebuilt here.
 * - `session.abort` — retry path only, wrapped in try/catch (fail soft).
 * - `session.todo`/`promptAsync`/`status`/`create`/`delete`/`summarize`/`list`
 *   /`children`/`message` — tool/CLI paths, not the prompt path.
 * - `app.agents` / `app.skills` — tool/CLI paths; one call site is optional
 *   chained, the others are not reached on a plain prompt.
 * - `provider.list` — guarded by a `typeof … === "function"` check upstream.
 * - `command.*` — not called by OMO.
 * Other v1 client methods stay absent; the hooks that reach them are non-fatal.
 *
 * The two typed assertions below are host bridges (same idiom as
 * `ctx as PluginEventContext` in plugin/event.ts), not `any` escapes: the
 * dispatch only uses `directory`, `client` and `serverUrl` downstream.
 */
export function toV1PluginInput(ctx: V2SetupContext): PluginContext {
  const directory = ctx.location.directory
  return {
    client: toV1Client(ctx),
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

function toV1Client(ctx: V2SetupContext): PluginContext["client"] {
  return {
    session: {
      get: (input: { path?: { id?: string } }) => {
        const sessionID = input?.path?.id
        if (typeof sessionID !== "string" || sessionID.length === 0) {
          throw new Error("session.get requires path.id")
        }
        return ctx.session.get({ sessionID })
      },
      messages: async (): Promise<{ data: unknown[] }> => ({ data: [] }),
    },
    tui: {
      showToast: async (): Promise<undefined> => undefined,
    },
  } as unknown as PluginContext["client"]
}
