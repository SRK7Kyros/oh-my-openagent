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
// build/plan demotion strip + v2-structured key guards.
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

  it("coerces a string model to Model.Ref and never demotes build", async () => {
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
    expect(updates.build?.mode).toBe("primary")
    expect(updates.build?.hidden).toBe(false)
    expect(updates.build?.model).toEqual({ id: "mimo-v2.6-pro", providerID: "opencode-go" })
    expect(updates.build?.description).toBe("Build agent")
  })

  it("never demotes plan either", async () => {
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
    expect(updates.plan?.mode).toBe("primary")
    expect(updates.plan?.hidden).toBe(false)
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