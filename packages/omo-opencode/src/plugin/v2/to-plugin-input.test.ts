import { describe, expect, it } from "bun:test"

import type { V2SetupContext } from "./types"
import { toV1PluginInput } from "./to-plugin-input"

/**
 * Reproduces the v2 prompt-path crash from the serve log:
 *   TypeError: undefined is not an object (evaluating 'tui.showToast')
 *   at notifyWhenModelCacheIsMissing (dist/index.js)
 * The v1 chat.message dispatch reaches `ctx.client.tui.showToast` through
 * several hooks; the v2 adapter must expose a safe no-op surface.
 */
function createMinimalV2Context(): V2SetupContext {
  return {
    location: { directory: "/tmp/omo-v2-to-plugin-input-test" },
    options: {},
    session: {
      get: async () => ({}),
      hook: async () => ({ dispose: async () => {} }),
    },
  } as unknown as V2SetupContext
}

describe("toV1PluginInput v1 client adapter", () => {
  it("gives the adapted client a no-op tui.showToast (the chat.message toast crash)", async () => {
    // given: the adapted v1 PluginInput, exactly as createPluginInterface wires it
    const input = toV1PluginInput(createMinimalV2Context())

    // when: a v1 hook calls showToast and chains .catch, as no-sisyphus-gpt does
    // (pre-fix `input.client.tui` is undefined -> TypeError on `.showToast`)
    const result = input.client.tui.showToast({
      body: { title: "t", message: "m", variant: "warning", duration: 1 },
    })

    // then: the call resolves to undefined instead of rejecting the prompt
    await expect(result).resolves.toBeUndefined()
  })

  it("keeps session.get/messages on the adapted client (prior v2-port behaviour)", async () => {
    // given: the adapted v1 PluginInput
    const input = toV1PluginInput(createMinimalV2Context())

    // when: the dispatch helpers used by claude-code-hooks reach the session surface
    const page = await input.client.session.messages()

    // then: both members exist and degrade safely
    expect(typeof input.client.session.get).toBe("function")
    expect(page).toEqual({ data: [] })
  })
})
