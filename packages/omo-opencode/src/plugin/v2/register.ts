import type { Hooks } from "@opencode-ai/plugin"

import type { EventIn, V2Cleanup, V2Dispatch, V2Registration, V2SetupContext } from "./types"
import {
  createChatHeadersAdapter,
  createChatMessageAdapter,
  createChatParamsAdapter,
  createCompactingAdapter,
  createMessagesTransformAdapter,
  createPromptTracker,
  createSystemTransformAdapter,
} from "./adapters/session"
import { createToolAfterAdapter, createToolBeforeAdapter, createToolTransformAdapter } from "./adapters/tool"
import {
  createAgentTransformAdapter,
  createConfigRun,
  createModelTransformAdapter,
  createProviderTransformAdapter,
} from "./adapters/config"

/**
 * The v2 adapters drive the very handler entries the v1 `server()` path
 * returns. Both host generations type those entries with different structural
 * views of the same wire payloads; this single typed boundary maps the v1 Hooks
 * record onto the adapter-facing dispatch. Handler bodies underneath are the
 * untouched shared implementations — registered hooks delegate, never re-implement.
 */
function asDispatch(hooks: Hooks): V2Dispatch {
  return hooks as unknown as V2Dispatch
}

function startEventSubscription(ctx: V2SetupContext, dispatch: V2Dispatch): { abort: () => void } {
  const controller = new AbortController()
  const stream = ctx.event.subscribe({ signal: controller.signal })
  void (async () => {
    try {
      for await (const event of stream) {
        const handler = dispatch.event
        if (handler) await handler({ event: event as EventIn["event"] })
      }
    } catch {
      // Stream torn down by abort during cleanup or host shutdown — lifecycle
      // is owned by the cleanup function returned from setup().
    }
  })()
  return { abort: () => controller.abort() }
}

/**
 * Registers the v2 hook surface (disposition table: /tmp/oc2-t2-omo.md) and
 * returns the setup() cleanup function (v1 `dispose` disposition).
 *
 * DROPPED-WITH-NOTE (no v2 registration happens for these v1 hooks):
 * - command.execute.before — v2 has no command hook domain.
 * - experimental.compaction.autocontinue — deliberately NOT approximated via
 *   ctx.session.prompt (would risk a prompt loop); documented in the artifact.
 */
export async function registerV2Hooks(args: { ctx: V2SetupContext; hooks: Hooks }): Promise<V2Cleanup> {
  const { ctx } = args
  const dispatch = asDispatch(args.hooks)
  const tracker = createPromptTracker()
  const registrations: V2Registration[] = []

  async function record(registration: Promise<V2Registration>): Promise<void> {
    registrations.push(await registration)
  }

  await record(ctx.session.hook("context", createChatParamsAdapter(dispatch)))
  await record(ctx.session.hook("model.request", createChatHeadersAdapter(dispatch, tracker)))
  await record(ctx.session.hook("prompt", createChatMessageAdapter(dispatch, tracker)))
  await record(ctx.session.hook("context", createMessagesTransformAdapter(dispatch)))
  await record(ctx.session.hook("context", createSystemTransformAdapter(dispatch)))
  await record(ctx.session.hook("compaction", createCompactingAdapter(dispatch)))
  await record(ctx.tool.hook("execute.before", createToolBeforeAdapter(dispatch)))
  await record(ctx.tool.hook("execute.after", createToolAfterAdapter(dispatch)))
  await record(ctx.tool.transform(createToolTransformAdapter(dispatch)))
  const runConfig = createConfigRun(dispatch.config)
  await record(ctx.model.transform(createModelTransformAdapter(runConfig)))
  await record(ctx.agent.transform(createAgentTransformAdapter(runConfig)))
  await record(ctx.provider.transform(createProviderTransformAdapter(runConfig)))
  const subscription = startEventSubscription(ctx, dispatch)

  return async () => {
    subscription.abort()
    for (const registration of registrations) await registration.dispose()
    await dispatch.dispose?.()
  }
}
