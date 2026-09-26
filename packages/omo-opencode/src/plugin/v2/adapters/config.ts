import type { V2AgentEditor, V2Dispatch, V2ModelEditor, V2ProviderEditor } from "../types"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function applyDefinition(target: Record<string, unknown>, definition: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(definition)) target[key] = value
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
    if (typeof defaultAgent === "string") editor.default(defaultAgent)
    const agents = config.agent
    if (!isRecord(agents)) return
    for (const [id, definition] of Object.entries(agents)) {
      if (!isRecord(definition)) continue
      if (editor.get(id) === undefined) continue
      editor.update(id, (agent) => applyDefinition(agent, definition))
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
