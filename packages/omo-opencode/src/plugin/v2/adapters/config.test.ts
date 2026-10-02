import { describe, expect, it, mock } from "bun:test"
import type { V2AgentEditor } from "../types"
import { createAgentTransformAdapter, toModelRef } from "./config"

// ---------------------------------------------------------------------------
// toModelRef — string / explicit-object model selections must become v2
// Model.Ref objects ({id, providerID, variant?}), mirroring Model.Ref.parse.
// ---------------------------------------------------------------------------
describe("toModelRef", () => {
  it("converts a plain provider/model string to a Model.Ref", () => {
    expect(toModelRef("opencode-go/mimo-v2.6-pro")).toEqual({
      id: "mimo-v2.6-pro",
      providerID: "opencode-go",
    })
  })

  it("converts a provider/model#variant string to a Model.Ref with variant", () => {
    expect(toModelRef("opencode-go/mimo-v2.6-pro#high")).toEqual({
      id: "mimo-v2.6-pro",
      providerID: "opencode-go",
      variant: "high",
    })
  })

  it("converts an explicit {providerID, model} object to a Model.Ref", () => {
    expect(toModelRef({ providerID: "prov", model: "mod" })).toEqual({
      id: "mod",
      providerID: "prov",
    })
  })

  it("converts an explicit {providerID, modelID} object to a Model.Ref", () => {
    expect(toModelRef({ providerID: "prov", modelID: "mod" })).toEqual({
      id: "mod",
      providerID: "prov",
    })
  })

  it("passes through an already-correct {id, providerID, variant} object", () => {
    expect(toModelRef({ id: "mod", providerID: "prov", variant: "v" })).toEqual({
      id: "mod",
      providerID: "prov",
      variant: "v",
    })
  })

  it("returns undefined for a string without a slash", () => {
    expect(toModelRef("no-slash")).toBeUndefined()
  })

  it("returns undefined for a string with an empty provider segment", () => {
    expect(toModelRef("/mod")).toBeUndefined()
  })

  it("returns undefined for a string with an empty model id", () => {
    expect(toModelRef("prov/")).toBeUndefined()
  })

  it("returns undefined for a string with an empty variant", () => {
    expect(toModelRef("prov/mod#")).toBeUndefined()
  })

  it("returns undefined for a string whose variant contains a second #", () => {
    expect(toModelRef("prov/mod#a#b")).toBeUndefined()
  })

  it("returns undefined for a string whose providerID contains #", () => {
    expect(toModelRef("pro#v/mod")).toBeUndefined()
  })

  it("returns undefined for non-string non-object input", () => {
    expect(toModelRef(42)).toBeUndefined()
    expect(toModelRef(null)).toBeUndefined()
    expect(toModelRef(undefined)).toBeUndefined()
  })

  it("returns undefined for an object without providerID", () => {
    expect(toModelRef({ model: "mod" })).toBeUndefined()
    expect(toModelRef({})).toBeUndefined()
  })

  it("returns undefined for an object with providerID but no model id", () => {
    expect(toModelRef({ providerID: "prov" })).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// createAgentTransformAdapter — default-agent guard + model coercion +
// build/plan demotion + v2-structured key guards.
// ---------------------------------------------------------------------------
describe("createAgentTransformAdapter", () => {
  it("sets the default agent when it exists in the v2 registry", async () => {
    const defaultFn = mock(() => {})
    const editor: V2AgentEditor = {
      default: defaultFn,
      get: (id) => (id === "build" ? { mode: "primary" } : undefined),
      update: mock(() => {}),
    }
    const run = async () => ({ default_agent: "build", agent: {} })
    await createAgentTransformAdapter(run)(editor)
    expect(defaultFn).toHaveBeenCalledWith("build")
  })

  it("leaves v2's built-in default alone when the configured default does not exist", async () => {
    const defaultFn = mock(() => {})
    const editor: V2AgentEditor = {
      default: defaultFn,
      get: () => undefined,
      update: mock(() => {}),
    }
    const run = async () => ({ default_agent: "sisyphus", agent: {} })
    await createAgentTransformAdapter(run)(editor)
    expect(defaultFn).not.toHaveBeenCalled()
  })

  it("coerces a string model to Model.Ref and demotes build like v1", async () => {
    const updates: Record<string, Record<string, unknown>> = {}
    const editor: V2AgentEditor = {
      default: mock(() => {}),
      get: (id) => (id === "build" ? { mode: "primary", hidden: false } : undefined),
      update: (id, fn) => {
        const agent: Record<string, unknown> = { mode: "primary", hidden: false }
        fn(agent)
        updates[id] = agent
      },
    }
    const run = async () => ({
      agent: {
        build: {
          mode: "subagent",
          hidden: true,
          model: "opencode-go/mimo-v2.6-pro",
          description: "Build agent",
        },
      },
    })
    await createAgentTransformAdapter(run)(editor)
    expect(updates.build?.mode).toBe("subagent")
    expect(updates.build?.hidden).toBe(true)
    expect(updates.build?.model).toEqual({ id: "mimo-v2.6-pro", providerID: "opencode-go" })
    expect(updates.build?.description).toBe("Build agent")
  })

  it("demotes plan too", async () => {
    const updates: Record<string, Record<string, unknown>> = {}
    const editor: V2AgentEditor = {
      default: mock(() => {}),
      get: (id) => (id === "plan" ? { mode: "primary", hidden: false } : undefined),
      update: (id, fn) => {
        const agent: Record<string, unknown> = { mode: "primary", hidden: false }
        fn(agent)
        updates[id] = agent
      },
    }
    const run = async () => ({
      agent: { plan: { mode: "subagent", hidden: true, description: "Plan agent" } },
    })
    await createAgentTransformAdapter(run)(editor)
    expect(updates.plan?.mode).toBe("subagent")
    expect(updates.plan?.hidden).toBe(true)
    expect(updates.plan?.description).toBe("Plan agent")
  })

  it("skips v2-structured keys when the v1 shape is wrong", async () => {
    const updates: Record<string, Record<string, unknown>> = {}
    const editor: V2AgentEditor = {
      default: mock(() => {}),
      get: (id) => (id === "explore" ? { mode: "primary" } : undefined),
      update: (id, fn) => {
        const agent: Record<string, unknown> = {
          permissions: { existing: true },
          request: { existing: true },
          mode: "primary",
        }
        fn(agent)
        updates[id] = agent
      },
    }
    const run = async () => ({
      agent: {
        explore: {
          permissions: "not-a-record",
          request: 42,
          mode: 123,
          description: "ok",
        },
      },
    })
    await createAgentTransformAdapter(run)(editor)
    expect(updates.explore?.permissions).toEqual({ existing: true })
    expect(updates.explore?.request).toEqual({ existing: true })
    expect(updates.explore?.mode).toBe("primary")
    expect(updates.explore?.description).toBe("ok")
  })
})

// ---------------------------------------------------------------------------
// upsert path — v2's `AgentEditor.update()` CREATES the agent when the id is
// missing (packages/core/src/plugin/agent.ts: `draft.update(AgentV2.defaultID,
// …)` for agents the host has not predefined). OMO's own agents (sisyphus,
// oracle, …) must therefore be CREATED, not skipped. Shape mirrors
// oh-my-opencode-slim `src/v2/adapters.ts:applyAgentToDraft` (verified live on
// @opencode/plugin 2.0.18).
// ---------------------------------------------------------------------------
describe("createAgentTransformAdapter upsert (v2 agents actually exist)", () => {
  type Rule = { action: string; resource: string; effect: string }

  function makeEditor(initial: Record<string, Record<string, unknown>> = {}) {
    const registry: Record<string, Record<string, unknown>> = { ...initial }
    const defaultFn = mock(() => {})
    const editor: V2AgentEditor = {
      default: defaultFn,
      get: (id) => registry[id],
      update: (id, fn) => {
        const agent: Record<string, unknown> = registry[id] ?? {}
        // Info.empty(id) defaults from @opencode-ai/schema/agent.
        if (agent.request === undefined) agent.request = { headers: {}, body: {} }
        if (agent.mode === undefined) agent.mode = "all"
        if (agent.hidden === undefined) agent.hidden = false
        if (agent.permissions === undefined) agent.permissions = []
        fn(agent)
        registry[id] = agent
      },
    }
    return { editor, registry, defaultFn }
  }

  it("creates OMO agents that do not exist in the v2 registry", async () => {
    const { editor, registry } = makeEditor()
    const run = async () => ({
      agent: {
        sisyphus: {
          mode: "primary",
          model: "openrouter/deepseek/deepseek-v4.1-flash",
          prompt: "you are sisyphus",
          description: "orchestrator",
        },
        oracle: { mode: "subagent", prompt: "oracle" },
      },
    })
    await createAgentTransformAdapter(run)(editor)
    expect(Object.keys(registry).sort()).toEqual(["oracle", "sisyphus"])
    expect(registry.sisyphus?.system).toBe("you are sisyphus")
    expect(registry.sisyphus?.mode).toBe("primary")
    expect(registry.sisyphus?.hidden).toBe(false)
    expect(Array.isArray(registry.sisyphus?.permissions)).toBe(true)
    expect(registry.oracle?.mode).toBe("subagent")
  })

  it("coerces every created agent model to object form, never a bare string", async () => {
    const { editor, registry } = makeEditor()
    const run = async () => ({
      agent: {
        oracle: { model: "openrouter/deepseek/deepseek-v4.1-flash" },
        metis: { model: { providerID: "opencode-go", model: "mimo-v2.6-pro" } },
        momus: {},
      },
    })
    await createAgentTransformAdapter(run)(editor)
    expect(registry.oracle?.model).toEqual({
      id: "deepseek/deepseek-v4.1-flash",
      providerID: "openrouter",
    })
    expect(registry.metis?.model).toEqual({ id: "mimo-v2.6-pro", providerID: "opencode-go" })
    expect(typeof registry.momus?.model).not.toBe("string")
  })

  it("gives created agents a permissive base and applies explicit denials", async () => {
    const { editor, registry } = makeEditor()
    const run = async () => ({
      agent: {
        sisyphus: {
          mode: "primary",
          permission: {
            question: "allow",
            call_omo_agent: "deny",
            task: "deny",
            bash: "ask",
          },
        },
      },
    })
    await createAgentTransformAdapter(run)(editor)
    const rules = registry.sisyphus?.permissions as Rule[]
    expect(rules[0]).toEqual({ action: "*", resource: "*", effect: "allow" })
    expect(rules).toContainEqual({ action: "call_omo_agent", resource: "*", effect: "deny" })
    expect(rules).toContainEqual({ action: "subagent", resource: "*", effect: "deny" })
    expect(rules).toContainEqual({ action: "execute", resource: "*", effect: "ask" })
  })

  it("maps a v1 tools record onto permission rules", async () => {
    const { editor, registry } = makeEditor()
    const run = async () => ({ agent: { oracle: { tools: { read: true, write: false } } } })
    await createAgentTransformAdapter(run)(editor)
    const rules = registry.oracle?.permissions as Rule[]
    expect(rules).toContainEqual({ action: "read", resource: "*", effect: "allow" })
    expect(rules).toContainEqual({ action: "write", resource: "*", effect: "deny" })
  })

  it("resolves default_agent to an agent created by this transform", async () => {
    const { editor, defaultFn } = makeEditor()
    const run = async () => ({
      default_agent: "sisyphus",
      agent: { sisyphus: { mode: "primary" } },
    })
    await createAgentTransformAdapter(run)(editor)
    expect(defaultFn).toHaveBeenCalledWith("sisyphus")
  })

  it("updates pre-existing agents, applying demotion without clobbering other fields", async () => {
    const { editor, registry } = makeEditor({
      build: { mode: "primary", hidden: false, description: "host build", hostOwned: true },
    })
    const run = async () => ({
      agent: {
        build: {
          mode: "subagent",
          hidden: true,
          model: "opencode-go/mimo-v2.6-pro",
          description: "Build agent",
        },
      },
    })
    await createAgentTransformAdapter(run)(editor)
    expect(registry.build?.mode).toBe("subagent")
    expect(registry.build?.hidden).toBe(true)
    expect(registry.build?.description).toBe("Build agent")
    expect(registry.build?.model).toEqual({ id: "mimo-v2.6-pro", providerID: "opencode-go" })
    expect(registry.build?.hostOwned).toBe(true)
  })
})