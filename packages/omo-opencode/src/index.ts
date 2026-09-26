import type { DualPluginModule } from "./plugin/v2/types"
import { createPluginModule } from "./testing/create-plugin-module"

const pluginModule: DualPluginModule = createPluginModule()

export const omoPlugin = pluginModule.server

export default pluginModule

export type {
  AgentName,
  AgentOverrideConfig,
  AgentOverrides,
  BuiltinCommandName,
  HookName,
  McpName,
  OhMyOpenCodeConfig,
} from "./config"

export type { ConfigLoadError } from "./shared/config-errors"
