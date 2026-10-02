import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { RGBA } from "@opentui/core"

import { registerBtwSideTui } from "./features/btw-side"
import { registerNativeEditionNudgeTui } from "./features/native-edition-nudge"
import { computeView, viewKey } from "./features/tui-sidebar/compute-view"
import { POLL_INTERVAL_MS } from "./features/tui-sidebar/constants"
import { deriveAgents, deriveConfig, deriveJobBoard, deriveLoop, deriveRoster } from "./features/tui-sidebar/derivers"
import type { ViewNode } from "./features/tui-sidebar/element-helpers"
import { readMirror } from "./features/tui-sidebar/mirror-io"
import { buildViewNodes } from "./features/tui-sidebar/render-view"
import type { RosterRow } from "./features/tui-sidebar/state-types"
import type { SidebarView } from "./features/tui-sidebar/state-types"
import { log } from "./shared/logger"
import { trackLoadedPluginSandbox } from "./hooks/auto-update-checker/checker/sandbox-refresh"

// The OpenCode v2 TUI plugin contract is `{ id, setup(context) }`. This module is
// built against the v1 `TuiPluginApi` types that OMO still ships, so the context
// surface it consumes is declared structurally here instead of imported.
type TuiResolvedTheme = {
  readonly text: {
    readonly base: RGBA
    readonly muted: RGBA
    readonly feedback: Readonly<
      Record<"error" | "warning" | "success" | "info", { readonly base: RGBA }>
    >
  }
  readonly border: { readonly base: RGBA }
  readonly hue: { readonly accent: Readonly<Record<number, RGBA>> }
}

type TuiLocation = { readonly directory: string }

type TuiRoute =
  | { readonly type: "home" }
  | { readonly type: "session"; readonly sessionID: string }
  | { readonly type: "plugin"; readonly id: string; readonly name: string }

type TuiDestination = { readonly type: "home" } | { readonly type: "session"; readonly sessionID: string }

type SolidRuntime = Pick<typeof import("@opentui/solid"), "createElement" | "insert" | "setProp">
type SolidNode = ReturnType<SolidRuntime["createElement"]>

type TuiSlotClaim = {
  readonly append: "sidebar.content"
  readonly render: (input: { readonly sessionID: string }) => SolidNode
}

type TuiSetupContext = {
  readonly renderer: { readonly requestRender: () => void }
  readonly theme: TuiResolvedTheme
  readonly location: TuiLocation | undefined
  readonly client: unknown
  readonly data: {
    readonly on: (type: string, handler: (event: unknown) => void) => () => void
    readonly location: { readonly default: () => TuiLocation }
    readonly session: {
      readonly get: (sessionID: string) => unknown
      readonly status: (sessionID: string) => "idle" | "running"
      readonly message: { readonly list: (sessionID: string) => readonly unknown[] }
      readonly permission: { readonly list: (sessionID: string) => readonly unknown[] | undefined }
    }
  }
  readonly storage: {
    readonly memory: <Value extends object>(
      key: string,
      options: { readonly initial: Value },
    ) => readonly [Value, (mutation: (draft: Value) => void) => void]
  }
  readonly ui: {
    readonly slot: (claim: TuiSlotClaim) => () => void
    readonly toast: {
      readonly show: (input: {
        readonly message: string
        readonly variant?: string
        readonly title?: string
        readonly duration?: number
      }) => void
    }
    readonly dialog: {
      readonly show: (render: () => unknown) => void
      readonly clear: () => void
    }
    readonly router: {
      readonly current: () => TuiRoute
      readonly navigate: (destination: TuiDestination) => void
    }
  }
}

type TuiSetupCleanup = () => void

type TuiDefinition = {
  readonly id: string
  readonly setup: (
    context: TuiSetupContext,
  ) => TuiSetupCleanup | Promise<TuiSetupCleanup | undefined> | undefined
}

type TuiThemeLike = {
  readonly text?: RGBA
  readonly textMuted?: RGBA
  readonly borderSubtle?: RGBA
  readonly error?: RGBA
  readonly warning?: RGBA
  readonly success?: RGBA
  readonly info?: RGBA
  readonly accent?: RGBA
}

// The exact v1 `TuiPluginApi` surface OMO's TUI features consume (see
// features/btw-side/* and features/native-edition-nudge/tui.ts). Only members
// the v2 context can supply are present; anything v2 lacks is left undefined so
// the consumers' existing try/catch degrades instead of fabricating behavior.
type LegacyTuiApi = {
  readonly renderer: TuiSetupContext["renderer"]
  readonly theme: { readonly current: TuiThemeLike }
  readonly client: unknown
  readonly state: {
    readonly path: { readonly directory: string }
    readonly session: {
      readonly get: (sessionID: string) => unknown
      readonly messages: (sessionID: string) => unknown
      readonly status: (sessionID: string) => { readonly type: "idle" | "busy" }
      readonly permission: (sessionID: string) => readonly unknown[]
      readonly question: (sessionID: string) => readonly unknown[]
    }
  }
  readonly route: {
    readonly current: { readonly name: string; readonly params?: Record<string, unknown> }
    readonly navigate: (name: string, params?: Record<string, unknown>) => void
  }
  readonly ui: {
    readonly toast: (input: {
      readonly message: string
      readonly variant?: string
      readonly title?: string
      readonly duration?: number
    }) => void
    readonly dialog: {
      readonly replace: (render: () => unknown) => void
      readonly clear: () => void
    }
  }
  readonly event: {
    readonly on: (type: string, handler: (event: unknown) => void) => () => void
  }
  readonly lifecycle: {
    readonly onDispose: (dispose: () => void) => () => void
  }
}

function mapTheme(theme: TuiResolvedTheme): TuiThemeLike {
  return {
    text: theme.text.base,
    textMuted: theme.text.muted,
    borderSubtle: theme.border.base,
    error: theme.text.feedback.error.base,
    warning: theme.text.feedback.warning.base,
    success: theme.text.feedback.success.base,
    info: theme.text.feedback.info.base,
    accent: theme.hue.accent[500],
  }
}

function legacyRoute(context: TuiSetupContext): { readonly name: string; readonly params?: Record<string, unknown> } {
  const route = context.ui.router.current()
  if (route.type === "session") return { name: "session", params: { sessionID: route.sessionID } }
  return { name: route.type }
}

function createLegacyTuiApi(
  context: TuiSetupContext,
  directory: string,
): { readonly api: TuiPluginApi; readonly cleanups: Array<() => void> } {
  const cleanups: Array<() => void> = []
  const legacy = {
    renderer: context.renderer,
    theme: { current: mapTheme(context.theme) },
    client: context.client,
    state: {
      path: { directory },
      session: {
        get: (sessionID: string) => context.data.session.get(sessionID),
        messages: (sessionID: string) => context.data.session.message.list(sessionID),
        status: (sessionID: string) => ({
          type: context.data.session.status(sessionID) === "running" ? ("busy" as const) : ("idle" as const),
        }),
        permission: (sessionID: string) => context.data.session.permission.list(sessionID) ?? [],
        question: () => [],
      },
    },
    route: {
      get current() {
        return legacyRoute(context)
      },
      navigate: (name: string, params?: Record<string, unknown>) => {
        if (name === "session" && typeof params?.["sessionID"] === "string") {
          context.ui.router.navigate({ type: "session", sessionID: params["sessionID"] })
          return
        }
        if (name === "home") context.ui.router.navigate({ type: "home" })
      },
    },
    ui: {
      toast: (input: { message: string; variant?: string; title?: string; duration?: number }) =>
        context.ui.toast.show({
          message: input.message,
          variant: input.variant,
          title: input.title,
          duration: input.duration,
        }),
      dialog: {
        replace: (render: () => unknown) => context.ui.dialog.show(render),
        clear: () => context.ui.dialog.clear(),
      },
    },
    event: {
      on: (type: string, handler: (event: unknown) => void) => context.data.on(type, handler),
    },
    lifecycle: {
      onDispose: (dispose: () => void) => {
        cleanups.push(dispose)
        return () => {
          const index = cleanups.indexOf(dispose)
          if (index !== -1) cleanups.splice(index, 1)
        }
      },
    },
  } satisfies LegacyTuiApi
  // The v2 context cannot satisfy the v1 `TuiPluginApi` type (the two contracts
  // differ), so the mapped subset is bridged here with a single local cast.
  return { api: legacy as unknown as TuiPluginApi, cleanups }
}

function materialize(nodes: readonly ViewNode[], solid: SolidRuntime): SolidNode {
  const root = solid.createElement("box")
  solid.setProp(root, "flexDirection", "column")
  for (const node of nodes) {
    solid.insert(root, materializeNode(node, solid))
  }
  return root
}

function materializeNode(node: ViewNode, solid: SolidRuntime): SolidNode {
  const element = solid.createElement(node.kind)
  for (const [name, value] of Object.entries(node.props)) {
    solid.setProp(element, name, value)
  }
  if (node.kind === "text") {
    solid.insert(element, node.text ?? "")
  }
  for (const child of node.children ?? []) {
    solid.insert(element, materializeNode(child, solid))
  }
  return element
}

type RosterResolver = (directory: string) => RosterRow[]
type PluginValidation = {
  readonly valid: boolean
  readonly messages: readonly string[]
  readonly config: {
    readonly tui?: {
      readonly sidebar?: {
        readonly enabled?: boolean
      }
    }
  }
}

async function loadPluginValidation(directory: string): Promise<PluginValidation> {
  const { validatePluginConfig } = await import("./config/validate")
  return validatePluginConfig(directory)
}

async function loadRosterRows(directory: string): Promise<readonly RosterRow[]> {
  const { resolveRoster } = await import("./features/tui-sidebar/roster-resolver")
  const resolver: RosterResolver = resolveRoster
  return resolver(directory)
}

async function readView(directory: string): Promise<SidebarView> {
  const validation = await loadPluginValidation(directory)
  const mirror = readMirror(directory)
  const roster = await loadRosterRows(directory)
  return computeView({
    config: deriveConfig(validation),
    roster: deriveRoster(roster),
    agents: deriveAgents(mirror),
    jobs: deriveJobBoard(mirror),
    loop: deriveLoop(mirror),
  })
}

export function handleTuiPollError(
  error: unknown,
  reportPollError: (error: Error) => void = (pollError) => log("[tui-sidebar] polling failed", { error: pollError }),
): void {
  if (error instanceof Error) {
    reportPollError(error)
    return
  }
  throw error
}

const module: TuiDefinition = {
  id: "oh-my-openagent:tui",
  setup: async (context) => {
    // The TUI plugin runs on OpenCode's main thread, the only thread that
    // emits `exit`; it applies a sandbox refresh the server plugin requested.
    trackLoadedPluginSandbox()

    const solid = await import("@opentui/solid").catch(() => null)
    if (!solid) {
      return
    }

    const directory = context.location?.directory ?? context.data.location.default().directory
    const { api, cleanups } = createLegacyTuiApi(context, directory)

    try {
      await registerBtwSideTui(api, solid)
    } catch (error) {
      log("[btw-side] TUI registration failed", { error })
    }

    try {
      registerNativeEditionNudgeTui(api as never)
    } catch (error) {
      log("[native-edition-nudge] TUI registration failed", { error })
    }

    let disposed = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const runCleanups = (): void => {
      if (disposed) return
      disposed = true
      if (timer) clearTimeout(timer)
      while (cleanups.length > 0) {
        const cleanup = cleanups.pop()
        if (cleanup) cleanup()
      }
    }

    if ((await loadPluginValidation(directory)).config.tui?.sidebar?.enabled === false) {
      return runCleanups
    }

    const initialView = await readView(directory)
    const [sidebar, setSidebar] = context.storage.memory<{ view: SidebarView }>(
      "oh-my-openagent:tui-sidebar",
      { initial: { view: initialView } },
    )

    let currentKey = viewKey(initialView)

    const unregisterSlot = context.ui.slot({
      append: "sidebar.content",
      render: () => {
        const root = solid.createElement("box")
        solid.setProp(root, "flexDirection", "column")
        solid.insert(root, () =>
          materialize(buildViewNodes(sidebar.view, mapTheme(context.theme)), solid),
        )
        return root
      },
    })

    let inFlight = false

    const schedule = (): void => {
      timer = setTimeout(tick, POLL_INTERVAL_MS)
    }

    const tick = async (): Promise<void> => {
      if (disposed || inFlight) {
        if (!disposed) schedule()
        return
      }
      inFlight = true
      try {
        const nextView = await readView(directory)
        const nextKey = viewKey(nextView)
        if (nextKey !== currentKey) {
          currentKey = nextKey
          setSidebar((draft) => {
            draft.view = nextView
          })
          context.renderer.requestRender()
        }
      } catch (error) {
        handleTuiPollError(error)
      } finally {
        inFlight = false
        if (!disposed) schedule()
      }
    }

    schedule()

    return () => {
      unregisterSlot()
      runCleanups()
    }
  },
}

export default module
