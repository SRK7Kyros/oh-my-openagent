import type { V2PermissionRule } from "../types"

export function isRecord(value: unknown): value is Record<string, unknown> {
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
 * v2 has no implicit default-allow: an agent with no matching rule falls to
 * `ask` and an agent with an empty ruleset can be denied wholesale. v1
 * permission maps list only EXPLICIT entries and rely on the host's implicit
 * allow for everything else, so a created agent starts from v2's standard
 * permissive base (mirrors the host's own `AgentV2.Info` defaults) and overlays
 * the v1 entries. Source: oh-my-opencode-slim `src/v2/adapters.ts` (verified
 * against @opencode/plugin 2.0.18).
 */
const V2_PERMISSION_BASE: V2PermissionRule[] = [
  { action: "*", resource: "*", effect: "allow" },
  { action: "external_directory", resource: "*", effect: "ask" },
  { action: "read", resource: "*.env", effect: "ask" },
  { action: "read", resource: "*.env.*", effect: "ask" },
  { action: "read", resource: "*.env.example", effect: "allow" },
]

function isEffect(value: unknown): value is V2PermissionRule["effect"] {
  return value === "allow" || value === "deny" || value === "ask"
}

/** A v1 permission key is a tool name; v2 renamed `task` → `subagent` and the
 * shell tool maps to `execute`. Both the original and the v2 alias are emitted
 * so a tool registered under either name is governed. */
function permissionKeyToActions(key: string): string[] {
  if (key === "task") return ["subagent", "task"]
  if (key === "bash") return ["execute", "bash"]
  return [key]
}

/** Build the ordered permission ruleset for a created agent: permissive base
 * first, explicit v1 entries after. v2 evaluates last-match-wins, so an
 * explicit denial overrides the base allow. */
export function buildAgentPermissions(definition: Record<string, unknown>): V2PermissionRule[] {
  const rules: V2PermissionRule[] = [...V2_PERMISSION_BASE]
  const permission = definition.permission
  if (isRecord(permission)) {
    for (const [key, value] of Object.entries(permission)) {
      const actions = permissionKeyToActions(key)
      if (isEffect(value)) {
        for (const action of actions) rules.push({ action, resource: "*", effect: value })
      } else if (isRecord(value)) {
        for (const [pattern, effect] of Object.entries(value)) {
          if (!isEffect(effect)) continue
          for (const action of actions) rules.push({ action, resource: pattern, effect })
        }
      }
    }
  }
  const tools = definition.tools
  if (isRecord(tools)) {
    for (const [tool, enabled] of Object.entries(tools)) {
      if (typeof enabled === "boolean") {
        rules.push({ action: tool, resource: "*", effect: enabled ? "allow" : "deny" })
      }
    }
  } else if (Array.isArray(tools)) {
    for (const tool of tools) {
      if (typeof tool === "string") rules.push({ action: tool, resource: "*", effect: "allow" })
    }
  }
  return rules
}

function coerceMode(value: unknown): "subagent" | "primary" | "all" {
  return value === "primary" || value === "all" ? value : "subagent"
}

/**
 * Populate a v2 `Agent.Info` entry from a v1 OMO agent definition. Called only
 * for ids the host registry does not already hold, so the entry is the
 * `Info.empty(id)` the draft created (`request`, `mode`, `hidden`,
 * `permissions` pre-seeded). Mirrors oh-my-opencode-slim
 * `src/v2/adapters.ts:applyAgentToDraft`: v1 `prompt` → v2 `system`, v1
 * `permission` map → v2 ordered ruleset, model coerced to a `Model.Ref`.
 */
export function applyAgentEntry(
  agent: Record<string, unknown>,
  id: string,
  definition: Record<string, unknown>,
): void {
  agent.id = id
  agent.mode = coerceMode(definition.mode)
  agent.hidden = definition.hidden === true
  if (typeof definition.description === "string") agent.description = definition.description

  const system = typeof definition.prompt === "string" ? definition.prompt : definition.system
  if (typeof system === "string") agent.system = system

  const model = toModelRef(definition.model)
  if (model) {
    const ref = model as { id: string; providerID: string; variant?: string }
    if (typeof definition.variant === "string") ref.variant = definition.variant
    agent.model = ref
  }

  const request = isRecord(agent.request) ? agent.request : {}
  if (!isRecord(request.headers)) request.headers = {}
  if (!isRecord(request.body)) request.body = {}
  const incoming = isRecord(definition.request) ? definition.request : undefined
  if (incoming) {
    if (isRecord(incoming.headers)) Object.assign(request.headers, incoming.headers)
    if (isRecord(incoming.body)) Object.assign(request.body, incoming.body)
  }
  agent.request = request

  agent.permissions = buildAgentPermissions(definition)
  if (typeof definition.color === "string") agent.color = definition.color
  if (typeof definition.steps === "number") agent.steps = definition.steps
}
