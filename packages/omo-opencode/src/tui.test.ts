/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { RGBA } from "@opentui/core"

import tuiModule, { handleTuiPollError } from "./tui"

type SolidNode = {
  readonly tag: string
  readonly props: Record<string, unknown>
  readonly children: unknown[]
}

type SlotClaimForTest = {
  readonly append: string
  readonly render: (input: { readonly sessionID: string }) => SolidNode
}

type SidebarSetupContext = Parameters<typeof tuiModule.setup>[0]

function rgba(): RGBA {
  return {} as RGBA
}

function sidebarHarness(tempDir: string, claims: SlotClaimForTest[], renders: number[]) {
  const store = { view: undefined as unknown }
  const context = {
    renderer: {
      requestRender: () => {
        renders.push(Date.now())
      },
    },
    theme: {
      text: {
        base: rgba(),
        muted: rgba(),
        feedback: {
          error: { base: rgba() },
          warning: { base: rgba() },
          success: { base: rgba() },
          info: { base: rgba() },
        },
      },
      border: { base: rgba() },
      hue: { accent: { 500: rgba() } },
    },
    location: { directory: tempDir },
    client: {},
    data: {
      on: () => () => undefined,
      location: { default: () => ({ directory: tempDir }) },
      session: {
        get: () => undefined,
        status: () => "idle" as const,
        message: { list: () => [] },
        permission: { list: () => [] },
      },
    },
    storage: {
      memory: (_key: string, options: { readonly initial: { readonly view: unknown } }) => {
        store.view = options.initial.view
        return [
          store,
          (mutation: (draft: { view: unknown }) => void) => {
            const draft = { view: store.view }
            mutation(draft)
            store.view = draft.view
          },
        ] as const
      },
    },
    ui: {
      slot: (claim: SlotClaimForTest) => {
        claims.push(claim)
        return () => undefined
      },
      toast: { show: () => undefined },
      dialog: { show: () => undefined, clear: () => undefined },
      router: { current: () => ({ type: "home" as const }), navigate: () => undefined },
    },
  }
  return { context: context as unknown as SidebarSetupContext, store }
}

describe("TUI sidebar v2 lifecycle", () => {
  let tempDir = ""

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "omo-tui-test-"))
  })

  afterEach(() => {
    mock.restore()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("#given the v2 setup runs #when it registers the sidebar #then the slot is appended to sidebar.content", async () => {
    // given
    const claims: SlotClaimForTest[] = []
    const { context, store } = sidebarHarness(tempDir, claims, [])

    // when
    const cleanup = await tuiModule.setup(context)

    // then
    expect(claims).toHaveLength(1)
    const claim = claims[0]
    if (!claim) throw new Error("sidebar slot was not registered")
    expect(claim.append).toBe("sidebar.content")
    expect(claim.render).toBeFunction()
    expect(store.view).toBeDefined()

    if (typeof cleanup === "function") cleanup()
  })

  it("#given sidebar is disabled in config #when the v2 setup runs #then no slot is registered", async () => {
    // given
    mock.module("./config/validate", () => ({
      validatePluginConfig: () => ({ valid: true, messages: [], config: { tui: { sidebar: { enabled: false } } } }),
    }))
    const claims: SlotClaimForTest[] = []
    const { context } = sidebarHarness(tempDir, claims, [])

    // when
    const cleanup = await tuiModule.setup(context)

    // then
    expect(claims).toHaveLength(0)
    if (typeof cleanup === "function") cleanup()
  })
})

describe("TUI sidebar polling errors", () => {
  it("#given an unexpected Error during polling #when the poll error handler runs #then the error is logged", () => {
    // given
    const pollError = new TypeError("view derivation failed")
    const reportedErrors: Error[] = []

    // when
    handleTuiPollError(pollError, (error) => {
      reportedErrors.push(error)
    })

    // then
    expect(reportedErrors).toEqual([pollError])
  })

  it("#given a non-Error throw during polling #when the poll error handler runs #then the value is rethrown", () => {
    // given
    const thrownValue = "bad poll state"

    expect(() => handleTuiPollError(thrownValue)).toThrow(thrownValue)
  })
})
