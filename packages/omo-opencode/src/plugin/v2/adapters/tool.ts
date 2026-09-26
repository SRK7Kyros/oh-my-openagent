import { argsToJsonSchema } from "../../normalize-tool-arg-schemas"
import type {
  ToolAfterIn,
  ToolAfterOut,
  ToolBeforeIn,
  ToolBeforeOut,
  ToolDefinitionIn,
  ToolDefinitionOut,
  ToolExecuteAfterEvent,
  ToolExecuteBeforeEvent,
  V2Dispatch,
  V2ToolEditor,
  V2ToolInfo,
} from "../types"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// 7. tool.execute.before -> ctx.tool.hook("execute.before")
//    event.input is mutable; a handler throw propagates so v2 denies the call.
export function createToolBeforeAdapter(dispatch: V2Dispatch) {
  return async (event: ToolExecuteBeforeEvent): Promise<void> => {
    const handler = dispatch["tool.execute.before"]
    if (!handler) return
    const output: ToolBeforeOut = {
      args: isRecord(event.input) ? event.input : {},
    }
    const input: ToolBeforeIn = { tool: event.tool, sessionID: event.sessionID, callID: event.id }
    await handler(input, output)
    event.input = output.args
  }
}

// 8. tool.execute.after -> ctx.tool.hook("execute.after")
//    Only "completed" results map (v1 has no error channel for this hook).
export function createToolAfterAdapter(dispatch: V2Dispatch) {
  return async (event: ToolExecuteAfterEvent): Promise<void> => {
    if (event.status !== "completed") return
    const handler = dispatch["tool.execute.after"]
    if (!handler) return
    const result = isRecord(event.result) ? event.result : {}
    const output: ToolAfterOut = {
      title: typeof result.title === "string" ? result.title : "",
      output: typeof result.output === "string" ? result.output : "",
      metadata: isRecord(result.metadata) ? result.metadata : {},
    }
    const input: ToolAfterIn = {
      tool: event.tool,
      sessionID: event.sessionID,
      callID: event.id,
      args: event.input,
    }
    await handler(input, output)
    result.title = output.title
    result.output = output.output
    result.metadata = output.metadata
    event.result = result
  }
}

// 9. tool map + tool.definition -> ctx.tool.transform (one registration)
export function createToolTransformAdapter(dispatch: V2Dispatch) {
  return async (editor: V2ToolEditor): Promise<void> => {
    for (const [name, definition] of Object.entries(dispatch.tool ?? {})) {
      let input: Record<string, unknown>
      try {
        input = argsToJsonSchema(definition.args)
      } catch (error) {
        throw new Error(`v2 tool input schema conversion failed for "${name}"`, { cause: error })
      }
      const added: V2ToolInfo = {
        id: name,
        name,
        description: definition.description,
        input,
        inputSchema: input,
        execute: definition.execute,
      }
      editor.add(added)
    }
    const definitionHandler = dispatch["tool.definition"]
    if (!definitionHandler) return
    for (const tool of editor.list()) {
      const output: ToolDefinitionOut = { description: tool.description, parameters: tool.input }
      const input: ToolDefinitionIn = { toolID: tool.id }
      await definitionHandler(input, output)
      editor.update(tool.id, (target) => {
        target.description = output.description
        target.input = output.parameters
      })
    }
  }
}
