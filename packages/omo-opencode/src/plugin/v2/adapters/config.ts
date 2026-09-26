import type { V2AgentEditor, V2Dispatch, V2ModelEditor, V2ProviderEditor } from "../types"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Convert a config-side model selection to a runtime `Model.Ref`
 * (`{id, providerID, variant?}`). Accepts the short string form
 * `provider/model#variant` and the explicit object form
 * `{providerID, model|modelID|id, variant?}`. Mirrors v2's `Model.Ref.parse`
 * (packages/schema/src/model.ts) — returns `undefined` for invalid input
 * instead of throwing.
 */
export function toModelRef(value: unknown): unknown {
  if (typeof value === "string") {
    const providerEnd = value.indexOf("/")
    if (providerEnd <= 0) return undefined
    const providerID = value.slice(0, providerEnd)
    const variantStart = value.indexOf("#", providerEnd + 1)
    const id = value.slice(providerEnd + 1, variantStart === -1 ? undefined : variantStart)
    const variant = variantStart === -1 ? undefined : value.slice(variantStart + 1)
    if (!id || providerID.includes("#") || (variant !== undefined && (!variant || variant.includes("#"))))
      return undefined
    return { id, providerID, ...(variant ? { variant } : {}) }
  }
  if (isRecord(value) && typeof value.providerID === "string") {
    const id =
      typeof value.id === "string"
        ? value.id
        : typeof value.model === "string"
          ? value.model
          : typeof value.modelID === "string"
            ? value.modelID
            : undefined
    if (!id) return undefined
    return {
      id,
      providerID: value.providerID,
      ...(typeof value.variant === "string" ? { variant: value.variant } : {}),
    }
  }
  return undefined
}

/**
 * v2 built-in primary agents that must stay selectable. OMO's v1 config
 * demotes `build`/`plan` to `subagent`+`hidden` (sisyphus is v1's primary), but
 * v2's `AgentEditor` has no `add()` so sisyphus cannot exist — demoting build
 * would leave v2 with no selectable primary.
 */
const V2_PRIMARY_AGENTS = new Set(["build", "plan"])

function stripDemotion(definition: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(definition)) {
    if (key === "mode" || key === "hidden") continue
    result[key] = value
  }
  return result
}

/**
 * Copy a v1 agent/provider definition onto a v2 runtime record. v2-structured
 * keys (`model`, `permissions`, `request`, `mode`) are coerced or skipped when
 * the v1-shaped value would clobber the v2 schema type.
 */
function applyDefinition(target: Record<string, unknown>, definition: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(definition)) {
    if (key === "model") {
      target[key] = toModelRef(value)
      continue
    }
    if ((key === "permissions" || key === "request") && !isRecord(value)) continue
    if (key === "mode" && typeof value !== "string") continue
    target[key] = value
  }
}

/**
 * The v1 `config` hook mutates a single Config object; v2 has no global config
 * hook, only per-domain transforms. All three slices share ONE run of the same
 * shared configHandler against a synthetic config (memoized), then each
 * transform applies its own domain to its editor. This is the documented
 * "rework into nearest equivalents" disposition for `config`.
 */
export function createConfigRun(configHandler: V2Dispatch["config"] | undefined) {
  let cached: Promise<Record<string, unknown>> | undefined
  return function run(): Promise<Record<string, unknown>> {
    if (!cached) {
      const synthetic: Record<string, unknown> = {}
      cached = (async () => {
        if (configHandler) await configHandler(synthetic)
        return synthetic
      })()
    }
    return cached
  }
}

// 10a. config model slice -> ctx.model.transform
export function createModelTransformAdapter(run: () => Promise<Record<string, unknown>>) {
  return async (editor: V2ModelEditor): Promise<void> => {
    const config = await run()
    const model = config.model
    if (typeof model === "string") {
      const separator = model.indexOf("/")
      if (separator > 0) {
        editor.default.set(model.slice(0, separator), model.slice(separator + 1))
      }
      return
    }
    if (!isRecord(model)) return
    const providerID = typeof model.providerID === "string" ? model.providerID : undefined
    const modelID = typeof model.modelID === "string" ? model.modelID : undefined
    if (providerID !== undefined && modelID !== undefined) {
      editor.default.set(providerID, modelID)
    }
  }
}

// 10b. config agent slice -> ctx.agent.transform
// v2 limitation: AgentEditor has no add() — OMO agent definitions can only be
// merged into agents that already exist (documented in the port artifact).
export function createAgentTransformAdapter(run: () => Promise<Record<string, unknown>>) {
  return async (editor: V2AgentEditor): Promise<void> => {
    const config = await run()
    const defaultAgent = config.default_agent
    if (typeof defaultAgent === "string" && editor.get(defaultAgent) !== undefined) {
      editor.default(defaultAgent)
    }
    const agents = config.agent
    if (!isRecord(agents)) return
    for (const [id, definition] of Object.entries(agents)) {
      if (!isRecord(definition)) continue
      if (editor.get(id) === undefined) continue
      const safe = V2_PRIMARY_AGENTS.has(id) ? stripDemotion(definition) : definition
      editor.update(id, (agent) => applyDefinition(agent, safe))
    }
  }
}

// 10c. config provider slice -> ctx.provider.transform
export function createProviderTransformAdapter(run: () => Promise<Record<string, unknown>>) {
  return async (editor: V2ProviderEditor): Promise<void> => {
    const config = await run()
    const providers = config.provider
    if (!isRecord(providers)) return
    for (const [id, definition] of Object.entries(providers)) {
      if (!isRecord(definition)) continue
      const info = isRecord(definition.info) ? definition.info : definition
      const models = definition.models
      if (editor.get(id) === undefined) {
        editor.add({ id, info, models })
      } else {
        editor.update(id, (provider) => applyDefinition(provider, definition))
      }
    }
  }
}
