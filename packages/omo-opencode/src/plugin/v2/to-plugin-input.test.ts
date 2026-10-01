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
  const created = 1_700_000_000_000
  return {
    location: { directory: "/tmp/omo-v2-to-plugin-input-test" },
    options: {},
    session: {
      get: async () => ({}),
      hook: async () => ({ dispose: async () => {} }),
      list: async () => ({
        data: [
          {
            id: "ses_1",
            projectID: "proj",
            directory: "/tmp/omo-v2-to-plugin-input-test",
            time: { created, updated: created + 1 },
          },
        ],
      }),
      messages: async () => [
        { id: "msg_1", type: "user", time: { created }, text: "hello world" },
        {
          id: "msg_2",
          type: "assistant",
          agent: "sisyphus",
          time: { created: created + 1, completed: created + 2 },
          content: [
            { type: "text", text: "hi there" },
            { type: "reasoning", text: "thinking..." },
            {
              type: "tool",
              id: "call_1",
              name: "read",
              state: { status: "completed", input: { file: "a" }, content: ["done"] },
            },
          ],
        },
      ],
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

  it("keeps session.get/messages/list on the adapted client (prior v2-port behaviour)", async () => {
    // given: the adapted v1 PluginInput
    const input = toV1PluginInput(createMinimalV2Context())

    // when: the session-manager storage reaches the session surface
    const page = await input.client.session.list()
    const messages = await input.client.session.messages({ path: { id: "ses_1" } })

    // then: get/list exist, list forwards the v2 page, and messages fold into
    // the v1 {info, parts} shape the session-manager expects
    expect(typeof input.client.session.get).toBe("function")
    expect((page as { data: unknown[] }).data).toHaveLength(1)
    expect(messages.data).toHaveLength(2)
    expect(messages.data[0]).toMatchObject({
      info: { id: "msg_1", role: "user" },
      parts: [{ type: "text", text: "hello world" }],
    })
    expect(messages.data[1]).toMatchObject({ info: { id: "msg_2", role: "assistant", agent: "sisyphus" } })
    expect(messages.data[1].parts).toEqual([
      { id: "msg_2:text", type: "text", text: "hi there" },
      { id: "msg_2:reasoning", type: "thinking", thinking: "thinking..." },
      {
        id: "call_1",
        type: "tool",
        tool: "read",
        callID: "call_1",
        input: { file: "a" },
        output: '["done"]',
        error: undefined,
      },
    ])
  })
})
