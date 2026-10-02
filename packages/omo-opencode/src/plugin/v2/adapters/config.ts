import type { V2AgentEditor, V2Dispatch, V2ModelEditor, V2ProviderEditor } from "../types"
import { applyAgentEntry, isRecord, toModelRef } from "./agent"

export { toModelRef } from "./agent"

/**
 * v2's `AgentEditor.update()` UPSERTS, so OMO's own primaries (sisyphus) are
 * CREATED by the agent transform below. That makes v1's `build`/`plan`
 * demotion (`subagent`+`hidden`) safe to apply on v2 as well: there is always
 * a selectable OMO primary, so the old "keep build/plan selectable" guard was
 * obsolete and merely re-exposed the host built-ins in agent pickers (e.g.
 * OpenChamber), which the user does not want when running OMO.
 */

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
// v2's AgentEditor has no add(), but `update(id, fn)` UPSERTS: the draft seeds
// a fresh `AgentV2.Info.empty(id)` when the id is missing
// (packages/core/src/plugin/agent.ts). OMO's own agents are therefore CREATED
// here, not skipped. Existing host agents take the update path and receive
// OMO's definition verbatim — including v1's `build`/`plan` demotion.
export function createAgentTransformAdapter(run: () => Promise<Record<string, unknown>>) {
  return async (editor: V2AgentEditor): Promise<void> => {
    const config = await run()
    const agents = config.agent
    const created = new Set<string>()
    if (isRecord(agents)) {
      for (const [id, definition] of Object.entries(agents)) {
        if (!isRecord(definition)) continue
        if (editor.get(id) === undefined) {
          editor.update(id, (agent) => applyAgentEntry(agent, id, definition))
          created.add(id)
        } else {
          editor.update(id, (agent) => applyDefinition(agent, definition))
        }
      }
    }
    const defaultAgent = config.default_agent
    if (
      typeof defaultAgent === "string" &&
      (created.has(defaultAgent) || editor.get(defaultAgent) !== undefined)
    ) {
      editor.default(defaultAgent)
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
