import { $ } from "bun"

import type { PluginContext } from "../types"
import type { V2SetupContext } from "./types"

/**
 * Adapts the v2 setup context to the v1 `PluginInput` the shared bootstrap
 * (serverPlugin) consumes.
 *
 * The slice of the v1 SDK client surface that dispatch handlers touch is
 * rebuilt on the v2 context domains. `session.get`/`session.messages`
 * translate the v1 `{path: {id}}` call shape to v2's `{sessionID}` (the
 * v2.0.18 host schema-errors on any other key). `session.messages` folds the
 * v2 message union into the v1 `{info, parts}` page the session-manager
 * storage expects; `session.list` forwards to the v2 session list, whose
 * `{data, cursor}` page `normalizeSDKResponse` unwraps. `tui.showToast` is a
 * no-op:
 * the v2 server context has no TUI service, yet several chat.message hooks
 * (no-sisyphus-gpt, no-hephaestus-non-gpt, keyword-detector,
 * auto-update-checker) call `client.tui.showToast` directly, so its absence
 * threw `TypeError: undefined is not an object (evaluating 'tui.showToast')`
 * and failed every /prompt with HTTP 500. `showToast` is the only `tui.*`
 * member OMO touches.
 *
 * Audited v1 client members on the prompt path:
 * - `tui.showToast` — required; added here.
 * - `session.get` / `session.messages` / `session.list` — required; rebuilt here.
 * - `session.abort` — retry path only, wrapped in try/catch (fail soft).
 * - `session.todo`/`promptAsync`/`status`/`create`/`delete`/`summarize`
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

type V1Message = {
  info: Record<string, unknown>
  parts: Array<Record<string, unknown>>
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function toEpochMillis(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  const millis = asRecord(value).epochMilliseconds
  return typeof millis === "number" ? millis : 0
}

function stringify(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

function assistantParts(messageID: string, content: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(content)) return []
  const parts: Array<Record<string, unknown>> = []
  for (const entry of content) {
    const part = asRecord(entry)
    if (part.type === "text") {
      parts.push({ id: `${messageID}:text`, type: "text", text: typeof part.text === "string" ? part.text : "" })
      continue
    }
    if (part.type === "reasoning") {
      parts.push({
        id: `${messageID}:reasoning`,
        type: "thinking",
        thinking: typeof part.text === "string" ? part.text : "",
      })
      continue
    }
    if (part.type === "tool") {
      const state = asRecord(part.state)
      const toolID = typeof part.id === "string" ? part.id : `${messageID}:tool`
      parts.push({
        id: toolID,
        type: "tool",
        tool: typeof part.name === "string" ? part.name : "",
        callID: toolID,
        input: asRecord(state.input),
        output: state.status === "completed" ? stringify(state.content) : undefined,
        error: state.status === "error" ? stringify(state.error) : undefined,
      })
    }
  }
  return parts
}

function toV1Message(message: unknown): V1Message | undefined {
  const record = asRecord(message)
  const id = record.id
  if (typeof id !== "string" || id.length === 0) return undefined
  const time = asRecord(record.time)
  const parts =
    record.type === "assistant"
      ? assistantParts(id, record.content)
      : typeof record.text === "string" && record.text.length > 0
        ? [{ id: `${id}:text`, type: "text", text: record.text }]
        : []
  return {
    info: {
      id,
      role: record.type === "assistant" ? "assistant" : "user",
      agent: typeof record.agent === "string" ? record.agent : undefined,
      time: {
        created: toEpochMillis(time.created),
        updated: time.completed !== undefined ? toEpochMillis(time.completed) : undefined,
      },
    },
    parts,
  }
}

/**
 * v1 session objects carry a flat `directory`; the v2 API nests it under `location`. OMO's
 * session manager filters on `session.directory`, and an undefined one reaches
 * `path.normalize(undefined)`, which Bun reports as `The "path" property must be of type string`.
 */
function toV1Session(session: Record<string, unknown>): Record<string, unknown> {
  const location = isRecord(session.location) ? session.location : undefined
  const directory =
    typeof session.directory === "string"
      ? session.directory
      : typeof location?.directory === "string"
        ? location.directory
        : undefined
  return directory === undefined ? session : { ...session, directory }
}

function toV1Messages(messages: unknown[]): V1Message[] {
  return messages.map(toV1Message).filter((message): message is V1Message => message !== undefined)
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
      list: async (input?: { query?: Record<string, unknown> }) => {
        const page = await ctx.session.list(input?.query)
        return { ...page, data: (page?.data ?? []).map(toV1Session) }
      },
      messages: async (input: { path?: { id?: string } }): Promise<{ data: V1Message[] }> => {
        const sessionID = input?.path?.id
        if (typeof sessionID !== "string" || sessionID.length === 0) {
          throw new Error("session.messages requires path.id")
        }
        return { data: toV1Messages(await ctx.session.messages({ sessionID })) }
      },
      todo: async () => ({ data: [] }),
    },
    tui: {
      showToast: async (): Promise<undefined> => undefined,
    },
  } as unknown as PluginContext["client"]
}
