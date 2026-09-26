import { isPlainRecord } from "@oh-my-opencode/utils"
import { tool } from "@opencode-ai/plugin"
import type { ToolDefinition } from "@opencode-ai/plugin"

type ToolArgSchema = ToolDefinition["args"][string]

type SchemaWithJsonSchemaOverride = ToolArgSchema & {
  _zod: ToolArgSchema["_zod"] & {
    toJSONSchema?: () => Record<string, unknown>
  }
}

function stripRootJsonSchemaFields(jsonSchema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _schema, ...rest } = jsonSchema
  return rest
}

function attachJsonSchemaOverride(schema: SchemaWithJsonSchemaOverride): void {
  if (schema._zod.toJSONSchema) {
    return
  }

  schema._zod.toJSONSchema = (): Record<string, unknown> => {
    const originalOverride = schema._zod.toJSONSchema
    delete schema._zod.toJSONSchema

    try {
      return stripRootJsonSchemaFields(tool.schema.toJSONSchema(schema))
    } finally {
      schema._zod.toJSONSchema = originalOverride
    }
  }
}

export function normalizeToolArgSchemas<TDefinition extends Pick<ToolDefinition, "args">>(
  toolDefinition: TDefinition,
): TDefinition {
  for (const schema of Object.values(toolDefinition.args)) {
    attachJsonSchemaOverride(schema)
  }

  return toolDefinition
}

/**
 * Builds a JSON Schema `object` for a tool arg map by converting each arg
 * individually (per-arg, proven for every wrapper shape) instead of
 * `z.object(args).toJSONSchema()`, which throws `seen.ref` TypeErrors across
 * the SDK's pinned zod copy for `.describe()`-outermost args. `required` lists
 * args whose def type is not `optional`.
 *
 * Per-arg conversion MUST call the schema's own `_zod.toJSONSchema` override
 * (attached above) when present, not `tool.schema.toJSONSchema(schema)`: the
 * outer converter re-enters `processSchema` on a wrapper node whose `seen`
 * entry is missing and throws `undefined is not an object (evaluating
 * 'seen.ref')` (zod 4.6.5 json-schema-processors). The override's inner
 * conversion runs with the override detached, which is the safe path.
 */
export function argsToJsonSchema(args: Record<string, ToolArgSchema>): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [key, schema] of Object.entries(args)) {
    try {
      const override = schema._zod.toJSONSchema
      const jsonSchema = override ? override() : tool.schema.toJSONSchema(schema)
      properties[key] = stripRootJsonSchemaFields(jsonSchema)
    } catch (error) {
      throw new Error(`tool arg "${key}" JSON Schema conversion failed`, { cause: error })
    }
    if (schema._zod.def.type !== "optional") {
      required.push(key)
    }
  }
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  }
}

const UNSUPPORTED_SCHEMA_KEYWORDS = new Set(["contentEncoding", "contentMediaType"])



function normalizeJsonSchemaRef(value: string): string {
  if (value.startsWith("#") || value.includes(":") || value.startsWith("/")) {
    return value
  }

  return `#/$defs/${value}`
}

export function sanitizeJsonSchema(value: unknown, depth = 0, isPropertyName = false): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonSchema(item, depth + 1, false))
  }

  if (!isPlainRecord(value)) {
    return value
  }

  const sanitized: Record<string, unknown> = {}

  for (const [key, nestedValue] of Object.entries(value)) {
    if (!isPropertyName && UNSUPPORTED_SCHEMA_KEYWORDS.has(key)) {
      continue
    }

    if (depth === 0 && key === "$schema") {
      continue
    }

    if (!isPropertyName && key === "$ref" && typeof nestedValue === "string") {
      sanitized[key] = normalizeJsonSchemaRef(nestedValue)
      continue
    }

    const childIsPropertyName = key === "properties" && !isPropertyName
    sanitized[key] = sanitizeJsonSchema(nestedValue, depth + 1, childIsPropertyName)
  }

  return sanitized
}
