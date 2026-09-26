import type { PluginModule } from "@opencode-ai/plugin"

// ---------------------------------------------------------------------------
// Minimal structural types for the OpenCode v2 plugin surface.
// Deliberately local: the built dist must construct the export object without
// any runtime dependency on `@opencode/plugin` (v1 hosts only carry
// `@opencode-ai/plugin`). Only fields the adapters touch are declared.
// ---------------------------------------------------------------------------

export type V2Registration = { dispose: () => Promise<void> }
export type V2Cleanup = () => Promise<void>

// --- v2 event payloads (structural subsets of the schema shapes) ---

export type V2SystemPart = { type?: string; text?: string } & Record<string, unknown>

export type V2MessageLike = { info: unknown; parts: Array<Record<string, unknown>> }

export type SessionContextEvent = {
  sessionID: string
  model: { id: string; providerID: string }
  agent: string
  system: V2SystemPart[]
  messages: V2MessageLike[]
  options: Record<string, unknown>
}

export type SessionPromptEvent = {
  sessionID: string
  messageID: string
  prompt: { text: string } & Record<string, unknown>
}

export type SessionModelRequestEvent = {
  sessionID: string
  model: { id: string; providerID: string }
  headers: Record<string, string>
}

export type SessionCompactionEvent = SessionContextEvent & { result?: unknown }

export type ToolExecuteBeforeEvent = {
  tool: string
  sessionID: string
  id: string
  input: unknown
}

export type ToolExecuteAfterEvent = ToolExecuteBeforeEvent & {
  status: "completed" | "error"
  result?: ({ output?: unknown; metadata?: Record<string, unknown> } & Record<string, unknown>) | undefined
  error?: unknown
}

// --- v2 editor surfaces (structural subsets) ---

export type V2ToolInfo = {
  id?: string
  description: string
  input: unknown
  execute: (...args: never[]) => unknown
}

export type V2ToolEditor = {
  add(tool: V2ToolInfo): void
  list(): Array<{ id: string; description: string; input: unknown }>
  update(id: string, update: (tool: { description: string; input: unknown }) => void): void
}

export type V2ModelEditor = {
  default: { set(providerID: string, modelID: string): void; get(): string | undefined }
}

export type V2AgentEditor = {
  default(id: string | undefined): void
  get(id: string): unknown
  update(id: string, update: (agent: Record<string, unknown>) => void): void
}

export type V2ProviderEditor = {
  get(id: string): unknown
  add(provider: { id?: string; info: unknown; models?: unknown }): void
  update(id: string, update: (provider: Record<string, unknown>) => void): void
}

// --- v2 setup context (structural subset of the v2 plugin Context) ---

export type V2SetupContext = {
  location: { directory: string; worktree?: string }
  options?: Record<string, unknown>
  session: { hook(name: string, cb: (event: never) => unknown): Promise<V2Registration> }
  tool: {
    hook(name: string, cb: (event: never) => unknown): Promise<V2Registration>
    transform(cb: (editor: V2ToolEditor) => unknown): Promise<V2Registration>
  }
  model: { transform(cb: (editor: V2ModelEditor) => unknown): Promise<V2Registration> }
  agent: { transform(cb: (editor: V2AgentEditor) => unknown): Promise<V2Registration> }
  provider: { transform(cb: (editor: V2ProviderEditor) => unknown): Promise<V2Registration> }
  event: { subscribe(options?: { signal?: AbortSignal }): AsyncIterable<unknown> }
}

// ---------------------------------------------------------------------------
// The shared v1 dispatch: the handler entries `serverPlugin` assembles. The v2
// adapters construct these exact (input, output) pairs so every v1 handler body
// is reused unchanged.
// ---------------------------------------------------------------------------

export type DispatchHandler<I, O> = (input: I, output: O) => Promise<void>

export type ChatParamsIn = {
  sessionID: string
  agent: string
  model: { providerID: string; modelID: string }
  provider: { id: string }
  message: Record<string, unknown>
}

export type ChatParamsOut = {
  temperature?: number
  topP?: number
  topK?: number
  maxOutputTokens?: number
  options: Record<string, unknown>
}

export type ChatHeadersIn = {
  sessionID: string
  provider: { id: string }
  message: { id?: string; role?: string }
  model?: unknown
}

export type ChatHeadersOut = { headers: Record<string, string> }

export type ChatMessageIn = {
  sessionID: string
  messageID?: string
  agent?: string
}

export type ChatMessageOut = {
  message: Record<string, unknown>
  parts: Array<Record<string, unknown>>
}

export type MessagesTransformOut = { messages: V2MessageLike[] }

export type SystemTransformIn = { sessionID?: string; model: { id: string; providerID: string } }
export type SystemTransformOut = { system: string[] }

export type CompactingIn = { sessionID: string }
export type CompactingOut = { context: string[]; prompt?: string }

export type ToolBeforeIn = { tool: string; sessionID: string; callID: string }
export type ToolBeforeOut = { args: Record<string, unknown> }

export type ToolAfterIn = { tool: string; sessionID: string; callID?: string; args?: unknown }
export type ToolAfterOut = { title: string; output: string; metadata: Record<string, unknown> }

export type ToolDefinitionIn = { toolID: string }
export type ToolDefinitionOut = { description: string; parameters: unknown }

export type EventIn = { event: { type: string; properties?: unknown } & Record<string, unknown> }

export type V1ToolDefinition = {
  description: string
  args: Record<string, unknown>
  execute: (...args: never[]) => unknown
}

export type V2Dispatch = {
  tool?: Record<string, V1ToolDefinition>
  "chat.params"?: DispatchHandler<ChatParamsIn, ChatParamsOut>
  "chat.headers"?: DispatchHandler<ChatHeadersIn, ChatHeadersOut>
  "chat.message"?: DispatchHandler<ChatMessageIn, ChatMessageOut>
  "experimental.chat.messages.transform"?: DispatchHandler<Record<string, never>, MessagesTransformOut>
  "experimental.chat.system.transform"?: DispatchHandler<SystemTransformIn, SystemTransformOut>
  "experimental.session.compacting"?: DispatchHandler<CompactingIn, CompactingOut>
  "tool.execute.before"?: DispatchHandler<ToolBeforeIn, ToolBeforeOut>
  "tool.execute.after"?: DispatchHandler<ToolAfterIn, ToolAfterOut>
  "tool.definition"?: DispatchHandler<ToolDefinitionIn, ToolDefinitionOut>
  config?: (input: Record<string, unknown>) => Promise<void>
  event?: (input: EventIn) => Promise<void>
  dispose?: () => Promise<void>
}

/**
 * v1 `PluginModule` only knows `server`; the dual-shape export adds `setup` for
 * v2 loaders. The v1 loader ignores unknown keys (`readV1Plugin` validates only
 * id/server/tui) and the v2 loader strips unknown keys, so one object serves
 * both hosts.
 */
export type DualPluginModule = PluginModule & {
  setup: (ctx: V2SetupContext) => Promise<V2Cleanup>
}
