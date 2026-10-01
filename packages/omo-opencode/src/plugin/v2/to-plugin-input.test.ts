import { afterAll, beforeEach, describe, expect, it } from "bun:test"

import type { V2SetupContext } from "./types"
import { toV1PluginInput } from "./to-plugin-input"

const CREATED = 1_700_000_000_000

type RecordedCall = { method: string; pathname: string; body: unknown }

let calls: RecordedCall[] = []
const originalFetch = globalThis.fetch

const V2_MESSAGES = [
  { id: "msg_1", type: "user", time: { created: CREATED }, text: "hello world" },
  {
    id: "msg_2",
    type: "assistant",
    agent: "sisyphus",
    time: { created: CREATED + 1, completed: CREATED + 2 },
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
]

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function emptyResponse(status: number): Response {
  return new Response(null, { status })
}

function installFetchStub(): void {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    const url = new URL(String(input))
    const method = (init?.method ?? "GET").toUpperCase()
    const body = typeof init?.body === "string" && init.body.length > 0 ? JSON.parse(init.body) : undefined
    calls.push({ method, pathname: url.pathname, body })

    if (url.pathname === "/api/session" && method === "GET") {
      return jsonResponse({
        data: [{ id: "ses_1", location: { directory: "/tmp/omo-v2-to-plugin-input-test" } }],
        cursor: null,
      })
    }
    if (url.pathname === "/api/session" && method === "POST") return jsonResponse({ data: { id: "ses_new" } })
    if (url.pathname === "/api/session/active") return jsonResponse({ data: { ses_1: { type: "running" } } })
    if (url.pathname === "/api/session/ses_1/message") return jsonResponse({ data: V2_MESSAGES })
    if (url.pathname === "/api/session/ses_1/agent" && method === "POST") return emptyResponse(204)
    if (url.pathname === "/api/session/ses_1/prompt" && method === "POST") return jsonResponse({ data: { id: "msg_new" } })
    return new Response("not found", { status: 404 })
  }) as typeof fetch
}

function createMinimalV2Context(): V2SetupContext {
  return { location: { directory: "/tmp/omo-v2-to-plugin-input-test" }, options: {} } as unknown as V2SetupContext
}

beforeEach(() => {
  calls = []
  installFetchStub()
})

afterAll(() => {
  globalThis.fetch = originalFetch
})

describe("toV1PluginInput v1 client adapter", () => {
  it("gives the adapted client a no-op tui.showToast (the chat.message toast crash)", async () => {
    // given: the adapted v1 PluginInput, exactly as createPluginInterface wires it
    const input = toV1PluginInput(createMinimalV2Context())

    // when: a v1 hook calls showToast and chains .catch, as no-sisyphus-gpt does
    const result = input.client.tui.showToast({
      body: { title: "t", message: "m", variant: "warning", duration: 1 },
    })

    // then: the call resolves to undefined instead of rejecting the prompt
    await expect(result).resolves.toBeUndefined()
  })

  it("folds session.list/messages into the v1 shapes the session-manager expects", async () => {
    // given: the adapted v1 PluginInput
    const input = toV1PluginInput(createMinimalV2Context())

    // when: the session-manager storage reaches the session surface
    const page = await input.client.session.list()
    const messages = await input.client.session.messages({ path: { id: "ses_1" } })

    // then: list flattens the nested v2 location directory and messages expose {info, parts}
    expect((page as { data: Array<{ directory?: string }> }).data[0].directory).toBe("/tmp/omo-v2-to-plugin-input-test")
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

  it("reads the real active-session map so callers can conclude idle", async () => {
    // given: the adapted v1 PluginInput over a server reporting ses_1 as running
    const input = toV1PluginInput(createMinimalV2Context())

    // when: the prompt gate / look_at poller reads session.status
    const status = await input.client.session.status()

    // then: it forwards the active map instead of the old empty {data:{}}
    expect(status).toEqual({ data: { ses_1: { type: "running" } } })
    expect(calls.some((call) => call.pathname === "/api/session/active")).toBe(true)
  })

  it("still sends /prompt after /agent answers 204 No Content", async () => {
    // given: the adapted v1 PluginInput
    const input = toV1PluginInput(createMinimalV2Context())

    // when: a delegated prompt (look_at / task / call_omo_agent) selects an agent then prompts
    const result = await input.client.session.prompt({
      path: { id: "ses_1" },
      body: { agent: "multimodal-looker", model: { providerID: "p", modelID: "m" }, parts: [{ type: "text", text: "hi" }] },
    })

    // then: the empty /agent body does not abort the flow, and /prompt receives the v2 body
    expect(result).toEqual({ data: { id: "msg_new" } })
    expect(calls.find((call) => call.pathname === "/api/session/ses_1/agent")?.method).toBe("POST")
    const promptCall = calls.find((call) => call.pathname === "/api/session/ses_1/prompt")
    expect(promptCall?.body).toMatchObject({ text: "hi", model: { providerID: "p", modelID: "m" } })
  })

  it("moves v1 file parts into the v2 files[] attachments", async () => {
    // given: the adapted v1 PluginInput
    const input = toV1PluginInput(createMinimalV2Context())

    // when: look_at dispatches a prompt that carries the file as a v1 part
    await input.client.session.prompt({
      path: { id: "ses_1" },
      body: {
        agent: "multimodal-looker",
        parts: [
          { type: "text", text: "analyze this" },
          { type: "file", mime: "text/markdown", url: "file:///tmp/doc.md", filename: "doc.md" },
        ],
      },
    })

    // then: the attachment is forwarded out-of-band so the child is not told nothing is attached
    const promptCall = calls.find((call) => call.pathname === "/api/session/ses_1/prompt")
    expect(promptCall?.body).toMatchObject({
      text: "analyze this",
      files: [{ uri: "file:///tmp/doc.md", name: "doc.md" }],
    })
  })
})
