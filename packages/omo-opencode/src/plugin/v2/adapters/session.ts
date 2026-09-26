import type {
  ChatHeadersIn,
  ChatMessageIn,
  ChatMessageOut,
  ChatParamsIn,
  ChatParamsOut,
  CompactingIn,
  CompactingOut,
  MessagesTransformOut,
  SessionCompactionEvent,
  SessionContextEvent,
  SessionModelRequestEvent,
  SessionPromptEvent,
  SystemTransformIn,
  V2Dispatch,
  V2SystemPart,
} from "../types"

/**
 * Tracks the latest user prompt per session so the model.request adapter can
 * supply the message identity that v2's SessionModelRequest does not carry.
 */
export type PromptTracker = {
  record(sessionID: string, message: { id: string; role: string }): void
  last(sessionID: string): { id?: string; role?: string }
}

export function createPromptTracker(): PromptTracker {
  const latest = new Map<string, { id: string; role: string }>()
  return {
    record(sessionID, message) {
      latest.set(sessionID, message)
    },
    last(sessionID) {
      return latest.get(sessionID) ?? {}
    },
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

function copyScalar(options: Record<string, unknown>, key: string, value: number | undefined): void {
  if (value !== undefined) options[key] = value
}

// 1. chat.params -> ctx.session.hook("context") mutating event.options
export function createChatParamsAdapter(dispatch: V2Dispatch) {
  return async (event: SessionContextEvent): Promise<void> => {
    const handler = dispatch["chat.params"]
    if (!handler) return
    const message: Record<string, unknown> = {}
    const output: ChatParamsOut = {
      temperature: numberOrUndefined(event.options.temperature),
      topP: numberOrUndefined(event.options.topP),
      topK: numberOrUndefined(event.options.topK),
      maxOutputTokens: numberOrUndefined(event.options.maxTokens),
      options: event.options,
    }
    const input: ChatParamsIn = {
      sessionID: event.sessionID,
      agent: event.agent,
      model: { providerID: event.model.providerID, modelID: event.model.id },
      provider: { id: event.model.providerID },
      message,
    }
    await handler(input, output)
    copyScalar(event.options, "temperature", output.temperature)
    copyScalar(event.options, "topP", output.topP)
    copyScalar(event.options, "topK", output.topK)
    if (output.maxOutputTokens !== undefined) event.options.maxTokens = output.maxOutputTokens
    if (typeof message.variant === "string") event.options.variant = message.variant
  }
}

// 2. chat.headers -> ctx.session.hook("model.request") mutating event.headers
export function createChatHeadersAdapter(dispatch: V2Dispatch, tracker: PromptTracker) {
  return async (event: SessionModelRequestEvent): Promise<void> => {
    const handler = dispatch["chat.headers"]
    if (!handler) return
    const input: ChatHeadersIn = {
      sessionID: event.sessionID,
      provider: { id: event.model.providerID },
      message: tracker.last(event.sessionID),
      model: { providerID: event.model.providerID, modelID: event.model.id },
    }
    await handler(input, { headers: event.headers })
  }
}

// 3. chat.message -> ctx.session.hook("prompt")
export function createChatMessageAdapter(dispatch: V2Dispatch, tracker: PromptTracker) {
  return async (event: SessionPromptEvent): Promise<void> => {
    tracker.record(event.sessionID, { id: event.messageID, role: "user" })
    const handler = dispatch["chat.message"]
    if (!handler) return
    const output: ChatMessageOut = {
      message: { id: event.messageID, role: "user" },
      parts: [{ type: "text", text: event.prompt.text }],
    }
    const input: ChatMessageIn = { sessionID: event.sessionID, messageID: event.messageID }
    await handler(input, output)
    const texts: string[] = []
    for (const part of output.parts) {
      if (part.type === "text" && typeof part.text === "string") texts.push(part.text)
    }
    if (texts.length > 0) event.prompt.text = texts.join("\n")
    const variant = output.message.variant
    if (typeof variant === "string") event.prompt.variant = variant
  }
}

// 4. experimental.chat.messages.transform -> ctx.session.hook("context") over event.messages
export function createMessagesTransformAdapter(dispatch: V2Dispatch) {
  return async (event: SessionContextEvent): Promise<void> => {
    const handler = dispatch["experimental.chat.messages.transform"]
    if (!handler) return
    const output: MessagesTransformOut = { messages: event.messages }
    await handler({}, output)
  }
}

function systemPartText(part: V2SystemPart): string {
  return typeof part.text === "string" ? part.text : JSON.stringify(part)
}

function sameTexts(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((text, index) => text === right[index])
}

// 5. experimental.chat.system.transform -> ctx.session.hook("context") over event.system
export function createSystemTransformAdapter(dispatch: V2Dispatch) {
  return async (event: SessionContextEvent): Promise<void> => {
    const handler = dispatch["experimental.chat.system.transform"]
    if (!handler) return
    const originalTexts = event.system.map(systemPartText)
    const system = [...originalTexts]
    const input: SystemTransformIn = {
      sessionID: event.sessionID,
      model: { id: event.model.id, providerID: event.model.providerID },
    }
    await handler(input, { system })
    if (!sameTexts(system, originalTexts)) {
      event.system.splice(0, event.system.length, ...system.map((text) => ({ type: "text", text })))
    }
  }
}

// 6. experimental.session.compacting -> ctx.session.hook("compaction")
export function createCompactingAdapter(dispatch: V2Dispatch) {
  return async (event: SessionCompactionEvent): Promise<void> => {
    const handler = dispatch["experimental.session.compacting"]
    if (!handler) return
    const output: CompactingOut = { context: [] }
    const input: CompactingIn = { sessionID: event.sessionID }
    await handler(input, output)
    for (const text of output.context) event.system.push({ type: "text", text })
    // v1 output.prompt (replace the compaction prompt) has no v2 slot:
    // SessionCompaction.result would short-circuit the compaction model call,
    // which is a different contract. Dropped-with-note — see the port artifact.
  }
}
