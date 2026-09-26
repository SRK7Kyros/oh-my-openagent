import { beforeEach, describe, expect, it, mock } from "bun:test"

import { createPluginModule } from "./create-plugin-module"

// ---------------------------------------------------------------------------
// Shared-handler spies: these stand in for the v1 dispatch entries assembled by
// createPluginInterface / createManagers / createHooks. The v2 setup() path must
// delegate to exactly these handlers (reuse, not rewrite).
// ---------------------------------------------------------------------------
const chatParamsHandler = mock((_input: unknown, _output: unknown) => Promise.resolve())
const chatHeadersHandler = mock((_input: unknown, _output: unknown) => Promise.resolve())
const chatMessageHandler = mock((_input: unknown, _output: unknown) => Promise.resolve())
const messagesTransformHandler = mock((_input: unknown, _output: unknown) => Promise.resolve())
const systemTransformHandler = mock((_input: unknown, _output: unknown) => Promise.resolve())
const commandExecuteBeforeHandler = mock((_input: unknown, _output: unknown) => Promise.resolve())
const eventHandler = mock((_input: unknown) => Promise.resolve())
const toolDefinitionHandler = mock((_input: unknown, _output: unknown) => Promise.resolve())
const toolExecuteBeforeHandler = mock((_input: unknown, _output: unknown) => Promise.resolve())
const toolExecuteAfterHandler = mock((_input: unknown, _output: unknown) => Promise.resolve())
const configHandler = mock((_input: unknown) => Promise.resolve())
const compactionCapture = mock((_sessionID: string) => Promise.resolve())
const disposeHooks = mock(() => {})
const backgroundShutdown = mock(() => Promise.resolve())
const skillMcpDisconnect = mock(() => Promise.resolve())
const tuiStateMirrorStop = mock(() => {})

// ---------------------------------------------------------------------------
// v1 module dependency mocks (mirrors create-plugin-module.test.ts + hermetic
// overrides for the deps that otherwise fall through to real implementations).
// ---------------------------------------------------------------------------
const mockInitConfigContext = mock(() => {})
const mockInstallAgentSortShim = mock(() => {})
const mockSetAgentSortOrder = mock(() => {})
const mockLog = mock(() => {})
const mockLogLegacyPluginStartupWarning = mock(() => {})
const mockMigrateLegacyWorkspaceDirectory = mock(() => ({ migrated: false, skipped: [] }))
const mockRunOpenCodeStartupMigration = mock(() => ({
  journalResumed: false,
  migratedFrom: [],
  reloadRequired: false,
  results: [],
  skippedConflictCount: 0,
}))
const mockStartOmoProcessSweep = mock(() => Promise.resolve())
const mockDetectDuplicateOmoPlugin = mock(() => ({
  detected: false,
  pluginName: null,
  duplicatePlugins: [],
  allPlugins: [],
}))
const mockGetDuplicateOmoPluginWarning = mock(() => "")
const mockDetectExternalSkillPlugin = mock(() => ({ detected: false, pluginName: null, allPlugins: [] }))
const mockGetSkillPluginConflictWarning = mock(() => "")
const mockInjectServerAuthIntoClient = mock(() => {})
const mockInitLiveServerRoute = mock(() => ({ stop: () => {} }))
const mockSetLiveParentWakeRoutingDisabled = mock(() => {})
const mockWarmLiveServerProbe = mock(() => Promise.resolve())
const mockLoadPluginConfig = mock(() => ({}))
const mockLoadConfigChain = mock((directory: string) => ({
  config: mockLoadPluginConfig(directory, {}),
  messages: [],
  path: null,
  valid: true,
}))
const mockRecordPluginTelemetry = mock(() => {})
const mockInitI18n = mock(() => Promise.resolve())
const mockInitializeOpenClaw = mock(() => Promise.resolve())
const mockIsTmuxIntegrationEnabled = mock(() => false)
const mockStartTmuxCheck = mock(() => {})
const mockCreateFirstMessageVariantGate = mock(() => ({
  shouldOverride: () => false,
  markApplied: () => {},
  markSessionCreated: () => {},
  clear: () => {},
}))
const mockCreateRuntimeTmuxConfig = mock(() => ({
  enabled: false,
  layout: "tiled" as const,
  main_pane_size: 60,
  main_pane_min_width: 80,
  agent_pane_min_width: 40,
  isolation: "inline" as const,
}))
const mockCreateModelCacheState = mock(() => ({}))
const mockCreateManagers = mock(() => ({
  backgroundManager: { shutdown: backgroundShutdown },
  skillMcpManager: { disconnectAll: skillMcpDisconnect },
  tuiStateMirror: { stop: tuiStateMirrorStop },
  configHandler,
}))
const mockCreateTools = mock(() => ({
  mergedSkills: [],
  availableSkills: [],
  filteredTools: {},
}))
const mockCreateHooks = mock(() => ({
  disposeHooks,
  compactionContextInjector: { capture: compactionCapture, inject: () => "injected-compaction-ctx" },
  compactionTodoPreserver: undefined,
  claudeCodeHooks: undefined,
}))
const mockCreatePluginInterface = mock(() => ({
  tool: { omoTool: { description: "omo tool desc", args: {}, execute: () => Promise.resolve("ok") } },
  "chat.params": chatParamsHandler,
  "chat.headers": chatHeadersHandler,
  "command.execute.before": commandExecuteBeforeHandler,
  "chat.message": chatMessageHandler,
  "experimental.chat.messages.transform": messagesTransformHandler,
  "experimental.chat.system.transform": systemTransformHandler,
  config: configHandler,
  event: eventHandler,
  "tool.definition": toolDefinitionHandler,
  "tool.execute.before": toolExecuteBeforeHandler,
  "tool.execute.after": toolExecuteAfterHandler,
}))
const mockCreateRuntimeSkillSourceServer = mock(() => ({ url: "http://127.0.0.1:1", stop: () => {} }))

function createTestPluginModule(overrides: Record<string, unknown> = {}) {
  return createPluginModule({
    initConfigContext: mockInitConfigContext,
    installAgentSortShim: mockInstallAgentSortShim,
    setAgentSortOrder: mockSetAgentSortOrder,
    log: mockLog,
    logLegacyPluginStartupWarning: mockLogLegacyPluginStartupWarning,
    migrateLegacyWorkspaceDirectory: mockMigrateLegacyWorkspaceDirectory,
    runOpenCodeStartupMigration: mockRunOpenCodeStartupMigration,
    startOmoProcessSweep: mockStartOmoProcessSweep,
    detectDuplicateOmoPlugin: mockDetectDuplicateOmoPlugin,
    getDuplicateOmoPluginWarning: mockGetDuplicateOmoPluginWarning,
    detectExternalSkillPlugin: mockDetectExternalSkillPlugin,
    getSkillPluginConflictWarning: mockGetSkillPluginConflictWarning,
    injectServerAuthIntoClient: mockInjectServerAuthIntoClient,
    initLiveServerRoute: mockInitLiveServerRoute,
    setLiveParentWakeRoutingDisabled: mockSetLiveParentWakeRoutingDisabled,
    warmLiveServerProbe: mockWarmLiveServerProbe,
    loadConfigChain: mockLoadConfigChain,
    loadPluginConfig: mockLoadPluginConfig,
    recordPluginTelemetry: mockRecordPluginTelemetry,
    initI18n: mockInitI18n,
    initializeOpenClaw: mockInitializeOpenClaw,
    isTmuxIntegrationEnabled: mockIsTmuxIntegrationEnabled,
    startTmuxCheck: mockStartTmuxCheck,
    createFirstMessageVariantGate: mockCreateFirstMessageVariantGate,
    createRuntimeTmuxConfig: mockCreateRuntimeTmuxConfig,
    createModelCacheState: mockCreateModelCacheState,
    createManagers: mockCreateManagers,
    createTools: mockCreateTools,
    createHooks: mockCreateHooks,
    createPluginInterface: mockCreatePluginInterface,
    createRuntimeSkillSourceServer: mockCreateRuntimeSkillSourceServer,
    ...overrides,
  } as never)
}

// ---------------------------------------------------------------------------
// v2 mock context: records registration calls in invocation order and captures
// the registered callbacks so delegation can be exercised.
// ---------------------------------------------------------------------------
const registrationCalls: string[] = []
const sessionCallbacks = new Map<string, Array<(event: unknown) => Promise<void>>>()
const toolHookCallbacks = new Map<string, Array<(event: unknown) => Promise<void>>>()
let toolTransformCallback: ((editor: unknown) => unknown) | undefined
let modelTransformCallback: ((editor: unknown) => unknown) | undefined
let agentTransformCallback: ((editor: unknown) => unknown) | undefined
let providerTransformCallback: ((editor: unknown) => unknown) | undefined
const regDispose = mock(() => Promise.resolve())

function pushCallback(map: Map<string, Array<(event: unknown) => Promise<void>>>, name: string, cb: unknown) {
  const list = map.get(name) ?? []
  list.push(cb as (event: unknown) => Promise<void>)
  map.set(name, list)
}

// Controllable async iterable backing ctx.event.subscribe (v2 returns an
// AsyncIterable the plugin consumes; see upstream client shared-events.ts).
const eventQueue: unknown[] = []
const eventWaiters: Array<(result: IteratorResult<unknown>) => void> = []
let eventStreamClosed = false
const eventIterable = {
  [Symbol.asyncIterator]() {
    return {
      next(): Promise<IteratorResult<unknown>> {
        const queued = eventQueue.shift()
        if (queued !== undefined) return Promise.resolve({ value: queued, done: false })
        if (eventStreamClosed) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => eventWaiters.push(resolve))
      },
      return(): Promise<IteratorResult<unknown>> {
        eventStreamClosed = true
        while (eventWaiters.length > 0) eventWaiters.shift()?.({ value: undefined, done: true })
        return Promise.resolve({ value: undefined, done: true })
      },
    }
  },
}

function pushStreamEvent(event: unknown): void {
  const waiter = eventWaiters.shift()
  if (waiter) waiter({ value: event, done: false })
  else eventQueue.push(event)
}

function createMockV2Context() {
  return {
    location: { directory: "/tmp/omo-v2-setup-test" },
    options: { omoOption: "yes" },
    session: {
      hook: mock((name: string, cb: unknown) => {
        registrationCalls.push(`session.hook:${name}`)
        pushCallback(sessionCallbacks, name, cb)
        return Promise.resolve({ dispose: regDispose })
      }),
    },
    tool: {
      hook: mock((name: string, cb: unknown) => {
        registrationCalls.push(`tool.hook:${name}`)
        pushCallback(toolHookCallbacks, name, cb)
        return Promise.resolve({ dispose: regDispose })
      }),
      transform: mock((cb: unknown) => {
        registrationCalls.push("tool.transform")
        toolTransformCallback = cb as (editor: unknown) => unknown
        return Promise.resolve({ dispose: regDispose })
      }),
    },
    model: {
      transform: mock((cb: unknown) => {
        registrationCalls.push("model.transform")
        modelTransformCallback = cb as (editor: unknown) => unknown
        return Promise.resolve({ dispose: regDispose })
      }),
    },
    agent: {
      transform: mock((cb: unknown) => {
        registrationCalls.push("agent.transform")
        agentTransformCallback = cb as (editor: unknown) => unknown
        return Promise.resolve({ dispose: regDispose })
      }),
    },
    provider: {
      transform: mock((cb: unknown) => {
        registrationCalls.push("provider.transform")
        providerTransformCallback = cb as (editor: unknown) => unknown
        return Promise.resolve({ dispose: regDispose })
      }),
    },
    event: {
      subscribe: mock((_options: unknown) => {
        registrationCalls.push("event.subscribe")
        return eventIterable
      }),
    },
  }
}

type SetupProbe = {
  setup: (ctx: never) => Promise<() => Promise<void>>
}

const EXPECTED_REGISTRATIONS = [
  "session.hook:context", // 1 chat.params
  "session.hook:model.request", // 2 chat.headers
  "session.hook:prompt", // 3 chat.message
  "session.hook:context", // 4 experimental.chat.messages.transform
  "session.hook:context", // 5 experimental.chat.system.transform
  "session.hook:compaction", // 6 experimental.session.compacting
  "tool.hook:execute.before", // 7 tool.execute.before
  "tool.hook:execute.after", // 8 tool.execute.after
  "tool.transform", // 9 tool map + tool.definition
  "model.transform", // 10 config (model slice)
  "agent.transform", // 10 config (agent slice)
  "provider.transform", // 10 config (provider slice)
  "event.subscribe", // 11 event
]

describe("createPluginModule().setup() v2 hook registrations", () => {
  beforeEach(() => {
    registrationCalls.length = 0
    sessionCallbacks.clear()
    toolHookCallbacks.clear()
    toolTransformCallback = undefined
    modelTransformCallback = undefined
    agentTransformCallback = undefined
    providerTransformCallback = undefined
    eventQueue.length = 0
    eventWaiters.length = 0
    eventStreamClosed = false
    regDispose.mockClear()
    chatParamsHandler.mockClear()
    chatHeadersHandler.mockClear()
    chatMessageHandler.mockClear()
    messagesTransformHandler.mockClear()
    systemTransformHandler.mockClear()
    commandExecuteBeforeHandler.mockClear()
    eventHandler.mockClear()
    toolDefinitionHandler.mockClear()
    toolExecuteBeforeHandler.mockClear()
    toolExecuteAfterHandler.mockClear()
    configHandler.mockClear()
    compactionCapture.mockClear()
    disposeHooks.mockClear()
    backgroundShutdown.mockClear()
    chatParamsHandler.mockImplementation(() => Promise.resolve())
    chatHeadersHandler.mockImplementation(() => Promise.resolve())
    chatMessageHandler.mockImplementation(() => Promise.resolve())
    messagesTransformHandler.mockImplementation(() => Promise.resolve())
    systemTransformHandler.mockImplementation(() => Promise.resolve())
    toolExecuteBeforeHandler.mockImplementation(() => Promise.resolve())
    toolExecuteAfterHandler.mockImplementation(() => Promise.resolve())
    toolDefinitionHandler.mockImplementation(() => Promise.resolve())
    configHandler.mockImplementation(() => Promise.resolve())
  })

  async function runSetup(): Promise<{ cleanup: () => Promise<void>; ctx: ReturnType<typeof createMockV2Context> }> {
    const module = createTestPluginModule() as unknown as SetupProbe
    const ctx = createMockV2Context()
    const cleanup = await module.setup(ctx as never)
    return { cleanup, ctx }
  }

  it("registers exactly the disposition-table hook calls and returns a cleanup fn", async () => {
    // given: a v2 context with recording spies (see disposition table in the port artifact)
    // when: setup() runs
    const { cleanup } = await runSetup()

    // then: every v1 hook maps to its v2 registration, in table order, nothing more
    expect(registrationCalls).toEqual(EXPECTED_REGISTRATIONS)
    // and: command.execute.before + experimental.compaction.autocontinue are dropped (no 14th call)
    expect(registrationCalls).toHaveLength(13)
    // and: dispose maps to the cleanup function returned by setup()
    expect(typeof cleanup).toBe("function")
  })

  it("delegates session context hook #1 to the chat.params handler with options write-back", async () => {
    // given: a chat.params handler that mutates the v1 output object
    await runSetup()
    chatParamsHandler.mockImplementation((_input: unknown, output: unknown) => {
      const out = output as { temperature?: number; options: Record<string, unknown> }
      out.temperature = 0.7
      out.options.custom = 1
      return Promise.resolve()
    })
    const callback = sessionCallbacks.get("context")?.[0]
    expect(callback).toBeDefined()

    // when: the v2 context event fires
    const event = {
      sessionID: "s1",
      agent: "sisyphus",
      model: { id: "mod", providerID: "prov" },
      system: [],
      messages: [],
      options: {},
    }
    await callback?.(event)

    // then: the shared v1 handler ran and its output mutations landed on event.options
    expect(chatParamsHandler).toHaveBeenCalledTimes(1)
    expect(event.options).toMatchObject({ temperature: 0.7, custom: 1 })
  })

  it("delegates model.request to the chat.headers handler with headers write-back", async () => {
    // given: a chat.headers handler that mutates output.headers
    await runSetup()
    chatHeadersHandler.mockImplementation((_input: unknown, output: unknown) => {
      const out = output as { headers: Record<string, string> }
      out.headers["x-initiator"] = "agent"
      return Promise.resolve()
    })
    const callback = sessionCallbacks.get("model.request")?.[0]
    expect(callback).toBeDefined()

    // when: the v2 model.request event fires
    const event = {
      sessionID: "s1",
      model: { id: "mod", providerID: "prov" },
      headers: {},
    }
    await callback?.(event)

    // then: the shared handler ran and mutated the event headers in place
    expect(chatHeadersHandler).toHaveBeenCalledTimes(1)
    expect(event.headers["x-initiator"]).toBe("agent")
  })

  it("delegates prompt to the chat.message handler with prompt.text write-back", async () => {
    // given: a chat.message handler that rewrites the output parts
    await runSetup()
    chatMessageHandler.mockImplementation((_input: unknown, output: unknown) => {
      const out = output as { parts: Array<Record<string, unknown>> }
      out.parts = [{ type: "text", text: "rewritten" }]
      return Promise.resolve()
    })
    const callback = sessionCallbacks.get("prompt")?.[0]
    expect(callback).toBeDefined()

    // when: the v2 prompt event fires
    const event = {
      sessionID: "s1",
      messageID: "m1",
      prompt: { text: "hello" },
    }
    await callback?.(event)

    // then: the shared handler ran and the rewritten parts flowed back into prompt.text
    expect(chatMessageHandler).toHaveBeenCalledTimes(1)
    expect(event.prompt.text).toBe("rewritten")
  })

  it("delegates the second context hook to messages.transform over the same messages ref", async () => {
    // given: the messages transform handler
    await runSetup()
    const callback = sessionCallbacks.get("context")?.[1]
    expect(callback).toBeDefined()

    // when: the v2 context event fires with messages
    const event = {
      sessionID: "s1",
      model: { id: "mod", providerID: "prov" },
      agent: "sisyphus",
      system: [],
      messages: [{ info: { role: "user" }, parts: [] }],
      options: {},
    }
    await callback?.(event)

    // then: the shared handler received the very same messages array (mapped, in-place mutation)
    expect(messagesTransformHandler).toHaveBeenCalledTimes(1)
    expect(messagesTransformHandler.mock.calls[0]?.[1]).toEqual({ messages: event.messages })
  })

  it("delegates the third context hook to system.transform with system write-back", async () => {
    // given: a system transform handler that appends a system string
    await runSetup()
    systemTransformHandler.mockImplementation((_input: unknown, output: unknown) => {
      const out = output as { system: string[] }
      out.system.push("extra")
      return Promise.resolve()
    })
    const callback = sessionCallbacks.get("context")?.[2]
    expect(callback).toBeDefined()

    // when: the v2 context event fires with a text system part
    const event = {
      sessionID: "s1",
      model: { id: "mod", providerID: "prov" },
      agent: "sisyphus",
      system: [{ type: "text", text: "base" }],
      messages: [],
      options: {},
    }
    await callback?.(event)

    // then: the shared handler ran and the appended string became a system text part
    expect(systemTransformHandler).toHaveBeenCalledTimes(1)
    expect(event.system).toContainEqual({ type: "text", text: "extra" })
  })

  it("delegates compaction to the shared session-compacting handler", async () => {
    // given: the real createSessionCompactingHandler delegation chain (capture spy)
    await runSetup()
    const callback = sessionCallbacks.get("compaction")?.[0]
    expect(callback).toBeDefined()

    // when: the v2 compaction event fires
    const event = {
      sessionID: "s1",
      model: { id: "mod", providerID: "prov" },
      agent: "sisyphus",
      system: [],
      messages: [],
      options: {},
    }
    await callback?.(event)

    // then: the shared handler captured the session and injected its context into event.system
    expect(compactionCapture).toHaveBeenCalledWith("s1")
    expect(event.system).toContainEqual({ type: "text", text: "injected-compaction-ctx" })
  })

  it("delegates execute.before with mutable input write-back and pass-through throw", async () => {
    // given: a tool.execute.before handler that replaces output.args
    await runSetup()
    toolExecuteBeforeHandler.mockImplementation((_input: unknown, output: unknown) => {
      const out = output as { args: Record<string, unknown> }
      out.args = { b: 2 }
      return Promise.resolve()
    })
    const callback = toolHookCallbacks.get("execute.before")?.[0]
    expect(callback).toBeDefined()

    // when: the v2 execute.before event fires
    const event = { tool: "t", sessionID: "s1", id: "c1", input: { a: 1 } }
    await callback?.(event)

    // then: the shared handler ran and its args replaced the mutable event.input
    expect(toolExecuteBeforeHandler).toHaveBeenCalledTimes(1)
    expect(event.input).toEqual({ b: 2 })
  })

  it("lets an execute.before throw propagate so v2 can deny the tool call", async () => {
    // given: a denying tool.execute.before handler
    await runSetup()
    toolExecuteBeforeHandler.mockImplementation(() => Promise.reject(new Error("denied")))
    const callback = toolHookCallbacks.get("execute.before")?.[0]

    // when/then: the adapter does not swallow the failure (only execute.before may throw)
    await expect(callback?.({ tool: "t", sessionID: "s1", id: "c1", input: {} })).rejects.toThrow("denied")
  })

  it("delegates execute.after on success with metadata write-back and skips errors", async () => {
    // given: a tool.execute.after handler that mutates output.metadata
    await runSetup()
    toolExecuteAfterHandler.mockImplementation((_input: unknown, output: unknown) => {
      const out = output as { metadata: Record<string, unknown> }
      out.metadata.fixed = true
      return Promise.resolve()
    })
    const callback = toolHookCallbacks.get("execute.after")?.[0]
    expect(callback).toBeDefined()

    // when: a completed execute.after event fires
    const completed = {
      tool: "t",
      sessionID: "s1",
      id: "c1",
      input: {},
      status: "completed",
      result: { output: "out", metadata: {} },
    }
    await callback?.(completed)

    // then: the shared handler ran and the metadata mutation flowed back to the result
    expect(toolExecuteAfterHandler).toHaveBeenCalledTimes(1)
    expect(completed.result.metadata).toMatchObject({ fixed: true })

    // and: errored tool calls never reach the handler (v1 has no error channel)
    const failed = {
      tool: "t",
      sessionID: "s1",
      id: "c2",
      input: {},
      status: "error",
      error: new Error("boom"),
    }
    await callback?.(failed)
    expect(toolExecuteAfterHandler).toHaveBeenCalledTimes(1)
  })

  it("reworks the tool map and tool.definition through tool.transform", async () => {
    // given: a tool editor view over one pre-existing tool
    await runSetup()
    const editorAdd = mock(() => {})
    const editorUpdate = mock(() => {})
    const editor = {
      add: editorAdd,
      list: () => [{ id: "listed", description: "d", input: {} }],
      update: editorUpdate,
      get: () => undefined,
      remove: () => {},
    }
    expect(toolTransformCallback).toBeDefined()

    // when: the tool transform runs
    await toolTransformCallback?.(editor)

    // then: OMO tool-map entries are added via the editor
    expect(editorAdd).toHaveBeenCalledTimes(1)
    expect(editorAdd.mock.calls[0]?.[0]).toMatchObject({ id: "omoTool", description: "omo tool desc" })
    // and: the shared tool.definition handler reworks each listed tool in place
    expect(toolDefinitionHandler).toHaveBeenCalledWith({ toolID: "listed" }, expect.anything())
    expect(editorUpdate).toHaveBeenCalledWith("listed", expect.anything())
  })

  it("reworks config through the model/agent/provider transforms with a single shared run", async () => {
    // given: a config handler that fills the synthetic v1 config
    await runSetup()
    configHandler.mockImplementation((input: unknown) => {
      const config = input as Record<string, unknown>
      config.model = { providerID: "prov", modelID: "mod" }
      config.default_agent = "sisyphus"
      config.agent = {}
      config.provider = {}
      return Promise.resolve()
    })

    // when: all three domain transforms run
    const modelDefaultSet = mock(() => {})
    await modelTransformCallback?.({ default: { set: modelDefaultSet, get: () => undefined } })
    const agentDefault = mock(() => {})
    await agentTransformCallback?.({
      default: agentDefault,
      get: () => undefined,
      update: mock(() => {}),
    })
    const providerAdd = mock(() => {})
    await providerTransformCallback?.({
      get: () => undefined,
      add: providerAdd,
      update: mock(() => {}),
    })

    // then: the shared config handler ran exactly once (memoized across the three slices)
    expect(configHandler).toHaveBeenCalledTimes(1)
    // and: the model slice pinned the default model
    expect(modelDefaultSet).toHaveBeenCalledWith("prov", "mod")
    // and: the agent slice pinned the default agent
    expect(agentDefault).toHaveBeenCalledWith("sisyphus")
  })

  it("consumes event.subscribe events through the shared event handler", async () => {
    // given: setup() already consumed the subscription
    await runSetup()
    const handled = Promise.withResolvers<void>()
    eventHandler.mockImplementation(() => {
      handled.resolve()
      return Promise.resolve()
    })

    // when: an event arrives on the v2 stream
    const fakeEvent = { type: "session.idle", properties: { sessionID: "s1" } }
    pushStreamEvent(fakeEvent)
    await handled.promise

    // then: the shared event handler received the {event} envelope
    expect(eventHandler).toHaveBeenCalledWith({ event: fakeEvent })
  })

  it("cleanup disposes registrations and the shared runtime lifecycle", async () => {
    // given: a fully registered setup()
    const { cleanup } = await runSetup()

    // when: cleanup runs (dispose disposition)
    await cleanup()

    // then: every v2 registration was disposed...
    expect(regDispose).toHaveBeenCalledTimes(12)
    // and: the shared v1 dispose chain ran
    expect(disposeHooks).toHaveBeenCalled()
    expect(backgroundShutdown).toHaveBeenCalled()
    expect(skillMcpDisconnect).toHaveBeenCalled()
    expect(tuiStateMirrorStop).toHaveBeenCalled()
  })
})
