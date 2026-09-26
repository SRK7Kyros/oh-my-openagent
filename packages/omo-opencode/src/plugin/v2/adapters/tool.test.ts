import { describe, expect, it } from "bun:test"
import { tool } from "@opencode-ai/plugin"

import { argsToJsonSchema } from "../../normalize-tool-arg-schemas"

type JsonSchemaLike = { type?: string; description?: string }

describe("argsToJsonSchema", () => {
  it("converts describe-outermost and optional args without the cross-zod object conversion", () => {
    // given: arg shapes where z.object(args).toJSONSchema() throws seen.ref across zod copies
    const args = {
      plain: tool.schema.string(),
      described: tool.schema.string().describe("a described string"),
      optionalOnly: tool.schema.string().optional(),
      optionalDescribe: tool.schema.string().optional().describe("optional described"),
      describeOptional: tool.schema.string().describe("describe first").optional(),
    }

    // when: the per-arg converter builds the object schema
    const schema = argsToJsonSchema(args)

    // then: every arg converted and only non-optional def types are required
    expect(schema.type).toBe("object")
    const properties = schema.properties as Record<string, JsonSchemaLike>
    expect(properties.plain?.type).toBe("string")
    expect(properties.described?.type).toBe("string")
    expect(properties.described?.description).toBe("a described string")
    expect(properties.optionalOnly?.type).toBe("string")
    expect(properties.optionalDescribe?.description).toBe("optional described")
    expect(properties.describeOptional?.description).toBe("describe first")
    expect(schema.required).toEqual(["plain", "described"])
    expect(schema.additionalProperties).toBe(false)
  })

  it("omits required when every arg is optional", () => {
    // given: a single optional arg
    // when: the converter builds the object schema
    const schema = argsToJsonSchema({ maybe: tool.schema.string().optional() })

    // then: no required key is emitted
    expect(schema.required).toBeUndefined()
    expect(schema.type).toBe("object")
  })
})