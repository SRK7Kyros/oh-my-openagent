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
 * - `session.status` — required; the prompt gate's idle check (`isSessionActive`)
 *   and the look_at / task / call_omo_agent pollers read it, so it must return the
 *   real active map rather than an empty page.
 * - `session.todo`/`promptAsync`/`create`/`delete`/`summarize`
 *   /`children`/`message` — tool/CLI paths, not the plain prompt path.
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
  const flat = session.directory
  if (typeof flat === "string") return session
  const nested = asRecord(session.location).directory
  return typeof nested === "string" ? { ...session, directory: nested } : session
}

function toV1Messages(messages: unknown[]): V1Message[] {
  return messages.map(toV1Message).filter((message): message is V1Message => message !== undefined)
}

function toV1Client(ctx: V2SetupContext): PluginContext["client"] {
  const base = process.env.OPENCODE_SERVER_URL ?? "http://127.0.0.1:4096"
  const password = process.env.OPENCODE_SERVER_PASSWORD
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const headers: Record<string, string> = { "content-type": "application/json" }
    if (password) headers.authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`v1 bridge ${method} ${path} failed: ${res.status} ${text}`)
    }
    // Several v2 routes answer with an empty body (`POST /api/session/:id/agent` and
    // `POST /api/session/:id/interrupt` are 204 No Content). A v1 SDK call resolves to
    // `undefined` for those; `res.json()` threw `SyntaxError: Unexpected end of JSON input`,
    // which on the prompt path aborted at `/agent` before `/prompt` was ever sent.
    const text = await res.text()
    return text.length === 0 ? (undefined as T) : (JSON.parse(text) as T)
  }
  const q = (input?: { query?: Record<string, unknown> }): string => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(input?.query ?? {})) {
      if (value !== undefined && value !== null) params.set(key, String(value))
    }
    const s = params.toString()
    return s.length > 0 ? `?${s}` : ""
  }
  // v1 prompt bodies are {parts: [{type:"text",text}]} (plus model/agent/tools/variant), but the
  // v2 `/prompt` endpoint's payload is PromptInput.Prompt = {text, files?, agents?, skills?}
  // (packages/schema/src/prompt-input.ts) and rejects a body without `text` ("Missing key at
  // [\"text\"]", 400). Concatenate the text parts into `text` and carry over only the fields v2
  // accepts; `variant`/`tools` have no v2 equivalent and are dropped (the v2 create payload does
  // take `agent`/`model`, so the agent is selected at session level instead — see `prompt`).
  const toV2PromptBody = (body?: Record<string, unknown>): Record<string, unknown> => {
    const b = asRecord(body)
    const parts = Array.isArray(b.parts) ? b.parts : []
    const text = parts
      .map((part) => {
        const p = asRecord(part)
        return p.type === "text" && typeof p.text === "string" ? p.text : ""
      })
      .filter((value) => value.length > 0)
      .join("\n")
    const out: Record<string, unknown> = { text: typeof b.text === "string" ? b.text : text }
    // v1 attachments ride inside `parts` as `{type:"file", url, filename}`; v2 takes them
    // out-of-band as `files:[{uri, name}]`. Dropping them handed look_at's multimodal-looker
    // child a text-only prompt, so it replied that no document was attached.
    const files = parts.flatMap((part) => {
      const p = asRecord(part)
      if (p.type !== "file") return []
      const uri = typeof p.url === "string" ? p.url : typeof p.uri === "string" ? p.uri : undefined
      if (uri === undefined) return []
      const name = typeof p.filename === "string" ? p.filename : typeof p.name === "string" ? p.name : undefined
      return [name === undefined ? { uri } : { uri, name }]
    })
    if (files.length > 0) out.files = files
    for (const key of ["model", "metadata", "delivery", "id", "resume"]) {
      if (b[key] !== undefined) out[key] = b[key]
    }
    return out
  }

  const id = (input: { path?: { id?: string } }, method: string): string => {
    const sessionID = input?.path?.id
    if (typeof sessionID !== "string" || sessionID.length === 0) {
      throw new Error(`session.${method} requires path.id`)
    }
    return sessionID
  }
  return {
    session: {
      get: (input: { path?: { id?: string } }) => call("GET", `/api/session/${id(input, "get")}`),
      list: async (input?: { query?: Record<string, unknown> }) => {
        const page = await call<{ data?: unknown[] }>("GET", `/api/session${q(input)}`)
        return { ...page, data: (page?.data ?? []).map((s) => toV1Session(asRecord(s))) }
      },
      messages: async (input: { path?: { id?: string } }): Promise<{ data: V1Message[] }> => {
        const sessionID = id(input, "messages")
        const page = await call<{ data?: unknown[] }>("GET", `/api/session/${sessionID}/message`)
        return { data: toV1Messages(page?.data ?? []) }
      },
      message: async (input: { path?: { id?: string; messageID?: string } }) => {
        const sessionID = id(input, "message")
        const messageID = input?.path?.messageID
        if (typeof messageID !== "string" || messageID.length === 0) {
          throw new Error("session.message requires path.messageID")
        }
        return call("GET", `/api/session/${sessionID}/message/${messageID}`)
      },
      create: async (input?: { body?: Record<string, unknown> }) =>
        call("POST", `/api/session`, {
          ...(input?.body ?? {}),
          location: { directory: ctx.location.directory },
        }),
      prompt: async (input: { path?: { id?: string }; body?: Record<string, unknown> }) => {
        const sessionID = id(input, "prompt")
        // v1 selects the agent per prompt; v2 selects it per session (session.create takes
        // `agent`/`model` — packages/server/src/handlers/session.ts). Without this switch a
        // delegated sub-agent prompt (look_at's multimodal-looker, call_omo_agent, task) runs as
        // the parent's default agent and the caller never receives its reply.
        const agent = asRecord(input?.body).agent
        if (typeof agent === "string" && agent.length > 0) {
          await call("POST", `/api/session/${sessionID}/agent`, { agent })
        }
        return call("POST", `/api/session/${sessionID}/prompt`, toV2PromptBody(input?.body))
      },
      // v1 `abort` maps to the v2 `interrupt` route.
      abort: async (input: { path?: { id?: string } }) =>
        call("POST", `/api/session/${id(input, "abort")}/interrupt`),
      delete: async (input: { path?: { id?: string } }) =>
        call("DELETE", `/api/session/${id(input, "delete")}`),
      // v1 `summarize` maps to the v2 `compact` route.
      summarize: async (input: { path?: { id?: string }; body?: Record<string, unknown> }) =>
        call("POST", `/api/session/${id(input, "summarize")}/compact`, input?.body),
      // v1 `promptAsync` has no v2 route; it degrades to the sync `/prompt` so callers never
      // see an undefined method.
      promptAsync: async (input: { path?: { id?: string }; body?: Record<string, unknown> }) =>
        call("POST", `/api/session/${id(input, "promptAsync")}/prompt`, toV2PromptBody(input?.body)),
      children: async (input: { query?: Record<string, unknown> }) =>
        call("GET", `/api/session${q({ query: { ...input?.query, parentID: input?.query?.id } })}`),
      // v1 `status` reads the active map, not an empty page: `GET /api/session/active` answers
      // `{data:{<sessionID>:{type}}}` (type is `running` while a drain owns the session). The
      // previous `{data:{}}` stub made every session look "never seen" to the prompt gate's
      // `isSessionActive` and pinned look_at's poller in its active branch until the 120s timeout.
      status: async () => {
        const active = await call<{ data?: unknown }>("GET", "/api/session/active")
        return { data: asRecord(active?.data) }
      },
      // v2 exposes no todo API; this mirrors the existing documented degradation.
      todo: async () => ({ data: [] }),
    },
    app: {
      agents: async () => call("GET", `/api/agent${q()}`),
      skills: async () => call("GET", `/api/skill${q()}`),
    },
    provider: {
      list: async () => call("GET", `/api/provider${q()}`),
    },
    tui: {
      showToast: async (): Promise<undefined> => undefined,
    },
  } as unknown as PluginContext["client"]
}
