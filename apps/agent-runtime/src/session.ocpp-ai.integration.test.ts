import { Tool } from '@ocpp/codemode'
import { AIError, LLMEvent, RateLimitError, type LLMRequest } from '@ocpp/ai'
import { TestLLM } from '@ocpp/ai/testing'
import { ProjectID } from '@ocpp/schema/project-id'
import { SessionID } from '@ocpp/schema/session-id'
import { AbsolutePath } from '@ocpp/schema/schema'
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  PubSub,
  Schema,
  Scope,
} from 'effect'
import { createSpecterApp, EventLog } from '@specter-ts/core'
import { eventsFor } from '@specter-ts/core/testing'
import {
  createImmediateReactionSchedulerLayer,
  createMemoryEventLog,
} from '@specter-ts/memory'
import {
  createMemoryReactionOutboxStore,
  type OutboxedReaction,
} from '@specter-ts/reaction-outbox'
import { afterEach, describe, expect, it } from 'vitest'

import { createSessionAppConfig, memorySliceStoreLayer } from './app.ts'
import { sessionEvent } from './events.ts'
import type { RunStepRequest } from './features/session/run-step-reaction/impl.ts'
import { type Delta, DeltaChannel } from './plugins/delta-channel.ts'
import { Model } from './plugins/model.ts'
import { modelStepHostLayer } from './plugins/step-host.ts'
import { ocppAiModelLayer } from './plugins/ocpp-ai-model.ts'
import {
  type OcppCredential,
  OcppCredentials,
} from './plugins/ocpp-credentials.ts'

// The real @ocpp/ai code path (request building, LLM.stream, response folding,
// error classification) against TestLLM's scripted LLMClient, with the real
// Code Mode `execute` tool. Only the provider's HTTP is faked.

const key: OcppCredential = {
  integrationID: 'openai',
  label: 'test',
  type: 'key',
  key: 'sk-test',
}
const credentialsLayer = (credential: OcppCredential | undefined) =>
  Layer.succeed(OcppCredentials, {
    load: Effect.succeed({
      _tag: 'found' as const,
      path: ':memory:',
      credentials: credential ? [credential] : [],
    }),
    find: () => Effect.succeed(credential),
  })

const usage = (inputTokens: number, outputTokens: number) => ({
  inputTokens,
  nonCachedInputTokens: inputTokens,
  outputTokens,
})
const text = (id: string, ...chunks: string[]) => [
  LLMEvent.textStart({ id }),
  ...chunks.map((chunk) => LLMEvent.textDelta({ id, text: chunk })),
  LLMEvent.textEnd({ id }),
]
const stopWith = (u: ReturnType<typeof usage>, ...events: LLMEvent[]) =>
  TestLLM.complete({ reason: { normalized: 'stop' }, usage: u }, ...events)
const toolCallsWith = (u: ReturnType<typeof usage>, ...events: LLMEvent[]) =>
  TestLLM.complete(
    { reason: { normalized: 'tool-calls' }, usage: u },
    ...events,
  )
const executeCall = (id: string, code: string) =>
  LLMEvent.toolCall({ id, name: 'execute', input: { code } })

const boot = async (
  credential: OcppCredential | undefined = key,
  hostTools: Record<string, Tool.Tool> = {},
) => {
  const scope = Effect.runSync(Scope.make())
  const base = await Effect.runPromise(
    Layer.build(
      Layer.mergeAll(TestLLM.testLayer(), credentialsLayer(credential)),
    ).pipe(Scope.provide(scope)),
  )
  const modelContext = await Effect.runPromise(
    Layer.build(
      ocppAiModelLayer({ providerID: 'openai', modelID: 'gpt-test' }).pipe(
        Layer.provide(Layer.succeedContext(base)),
      ),
    ).pipe(Scope.provide(scope)),
  )
  const llm = Context.get(base, TestLLM.Test)
  const model = Context.get(modelContext, Model)

  const log = createMemoryEventLog()
  await Effect.runPromise(
    log.append([
      sessionEvent('session-created').create({
        sessionID: SessionID.make('ses_1'),
        projectID: ProjectID.make('prj_1'),
        location: { directory: AbsolutePath.make('/tmp/ws') },
        slug: 'brave-otter',
        version: '2',
      }),
    ]),
  )
  const pubsub = Effect.runSync(PubSub.unbounded<Delta>())
  const subscription = Effect.runSync(
    Scope.provide(PubSub.subscribe(pubsub), scope),
  )
  const outbox =
    createMemoryReactionOutboxStore<OutboxedReaction<RunStepRequest>>()
  const full = createSessionAppConfig(outbox)
  const events = [
    ...new Map(
      Object.values(full.slices)
        .flatMap((slice) => eventsFor(slice, full.events))
        .map((definition) => [definition.type, definition]),
    ).values(),
  ]
  const app = await createSpecterApp(
    { ...full, events },
    Layer.mergeAll(
      Layer.succeed(EventLog, log),
      memorySliceStoreLayer,
      createImmediateReactionSchedulerLayer(),
      modelStepHostLayer({ system: 'Be brief.', hostTools }).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(Model, model),
            Layer.succeed(DeltaChannel, { pubsub }),
          ),
        ),
      ),
    ),
  )
  const types = () =>
    log
      .inspect()
      .map((event) => event.type)
      .filter((type) => type !== 'session-created')
  const payloads = (type: string) =>
    log
      .inspect()
      .filter((event) => event.type === type)
      .map((event) => event.payload as Record<string, unknown>)
  const waitFor = async (condition: () => boolean) => {
    const deadline = Date.now() + 5000
    while (!condition()) {
      if (Date.now() > deadline)
        throw new Error(`Timed out; events: ${types().join(', ')}`)
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  return {
    app,
    llm,
    types,
    payloads,
    waitFor,
    requests: () => Effect.runPromise(llm.requests()),
    deltas: () => Effect.runSync(PubSub.takeAll(subscription)),
    close: async () => {
      await app.close()
      await Effect.runPromise(Scope.close(scope, Exit.void))
    },
  }
}

const prompt = {
  type: 'enqueueInput' as const,
  payload: {
    sessionID: 'ses_1',
    inboxID: 'msg_a',
    type: 'user' as const,
    payload: { text: 'say hi' },
  },
}

const messageParts = (request: LLMRequest) =>
  request.messages.map((message) => ({
    role: message.role,
    parts: message.content.map((part) => part.type),
  }))

let running: Awaited<ReturnType<typeof boot>> | undefined
const start = async (
  credential?: OcppCredential | undefined,
  hostTools?: Record<string, Tool.Tool>,
) => {
  running = await boot(credential, hostTools)
  return running
}
afterEach(async () => {
  await running?.close()
  running = undefined
})

describe('step loop on the @ocpp/ai path (TestLLM provider)', () => {
  it('runs one text step and stops, streaming deltas and recording usage', async () => {
    const t = await start()
    await Effect.runPromise(
      t.llm.push(stopWith(usage(7, 3), ...text('t1', 'Hel', 'lo'))),
    )

    await t.app.command(prompt)
    await t.waitFor(() => t.types().includes('session-execution-settled'))

    expect(t.types()).toEqual([
      'session-inbox-enqueued',
      'session-execution-started',
      'session-inbox-delivered',
      'session-step-started',
      'session-block-recorded',
      'session-step-settled',
      'session-execution-settled',
    ])
    expect(t.deltas().map((delta) => delta.text)).toEqual(['Hel', 'lo'])
    expect(t.payloads('session-block-recorded')[0]).toMatchObject({
      ordinal: 0,
      text: 'Hello',
    })
    expect(t.payloads('session-step-started')[0]).toMatchObject({
      model: { id: 'gpt-test', providerID: 'openai' },
    })
    expect(t.payloads('session-step-settled')[0]).toMatchObject({
      outcome: 'succeeded',
      finish: 'stop',
      tokens: {
        input: 7,
        output: 3,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    })
    // The request carries the plugin's system prompt, the durable transcript
    // and the one model-visible tool.
    const [request, ...rest] = await t.requests()
    expect(rest).toEqual([])
    expect(request?.system.map((part) => part.text)).toEqual(['Be brief.'])
    expect(request && messageParts(request)).toEqual([
      { role: 'user', parts: ['text'] },
    ])
    expect(request?.tools.map((tool) => tool.name)).toEqual(['execute'])
  })

  it('runs a Code Mode tool step, feeds the result back, then stops', async () => {
    const t = await start()
    await Effect.runPromise(
      t.llm.push(
        toolCallsWith(
          usage(10, 5),
          ...text('t1', 'Let me check.'),
          executeCall('call_1', 'return await tools.echo({ text: "pong" })'),
        ),
        stopWith(usage(20, 4), ...text('t2', 'It said pong.')),
      ),
    )

    await t.app.command(prompt)
    await t.waitFor(() => t.types().includes('session-execution-settled'))

    expect(t.types()).toEqual([
      'session-inbox-enqueued',
      'session-execution-started',
      'session-inbox-delivered',
      'session-step-started',
      'session-block-recorded',
      'session-tool-requested',
      'session-tool-settled',
      'session-step-settled',
      'session-step-started',
      'session-block-recorded',
      'session-step-settled',
      'session-execution-settled',
    ])
    // Durable call strictly before its result.
    expect(t.types().indexOf('session-tool-requested')).toBeLessThan(
      t.types().indexOf('session-tool-settled'),
    )
    expect(t.payloads('session-tool-requested')[0]).toMatchObject({
      id: 'call_1',
      input: { code: 'return await tools.echo({ text: "pong" })' },
      executed: false,
    })
    expect(t.payloads('session-tool-settled')[0]).toMatchObject({
      id: 'call_1',
      content: [{ type: 'text', text: '{"text":"pong"}' }],
    })
    const ends = t.payloads('session-step-settled')
    expect(ends.map((end) => end.finish)).toEqual(['tool-calls', 'stop'])
    expect(ends.map((end) => (end.tokens as { input: number }).input)).toEqual([
      10, 20,
    ])
    expect(t.deltas().map((delta) => delta.text)).toEqual([
      'Let me check.',
      'It said pong.',
    ])

    // The second request replays the first step from durable history: the
    // assistant text and tool call, then the tool result as a tool message.
    const requests = await t.requests()
    expect(requests).toHaveLength(2)
    const second = requests[1]
    expect(second && messageParts(second)).toEqual([
      { role: 'user', parts: ['text'] },
      { role: 'assistant', parts: ['text', 'tool-call'] },
      { role: 'tool', parts: ['tool-result'] },
    ])
    expect(second?.messages[2]?.content[0]).toMatchObject({
      type: 'tool-result',
      id: 'call_1',
      result: { type: 'text', value: '{"text":"pong"}' },
    })
  })

  it('records a failing program as a failed tool result and continues', async () => {
    const t = await start()
    await Effect.runPromise(
      t.llm.push(
        toolCallsWith(usage(1, 1), executeCall('call_1', 'return nope(')),
        stopWith(usage(2, 2), ...text('t2', 'That did not parse.')),
      ),
    )

    await t.app.command(prompt)
    await t.waitFor(() => t.types().includes('session-execution-settled'))

    expect(t.types().filter((type) => type.startsWith('session-tool'))).toEqual(
      ['session-tool-requested', 'session-tool-settled'],
    )
    expect(t.payloads('session-tool-settled')[0]).toMatchObject({
      id: 'call_1',
      error: { type: 'tool.execution' },
    })
    const second = (await t.requests())[1]
    expect(second?.messages.at(-1)?.content[0]).toMatchObject({
      type: 'tool-result',
      result: { type: 'error' },
    })
  })

  it('answers an unknown tool with a failed result instead of running anything', async () => {
    const t = await start()
    await Effect.runPromise(
      t.llm.push(
        toolCallsWith(
          usage(1, 1),
          LLMEvent.toolCall({ id: 'call_1', name: 'shell', input: {} }),
        ),
        stopWith(usage(1, 1), ...text('t2', 'ok')),
      ),
    )

    await t.app.command(prompt)
    await t.waitFor(() => t.types().includes('session-execution-settled'))

    expect(t.payloads('session-tool-settled')[0]).toMatchObject({
      error: { type: 'tool.unknown', message: 'Unknown tool: shell' },
    })
  })

  it('retries a retryable provider failure as the same step', async () => {
    const t = await start()
    await Effect.runPromise(
      t.llm.push(
        TestLLM.failAfter(
          new AIError({ reason: new RateLimitError({ message: 'slow down' }) }),
        ),
        stopWith(usage(3, 1), ...text('t1', 'done')),
      ),
    )

    await t.app.command(prompt)
    await t.waitFor(() => t.types().includes('session-execution-settled'))

    expect(t.types()).toEqual([
      'session-inbox-enqueued',
      'session-execution-started',
      'session-inbox-delivered',
      'session-step-started',
      'session-step-settled',
      'session-step-started',
      'session-block-recorded',
      'session-step-settled',
      'session-execution-settled',
    ])
    expect(t.payloads('session-step-settled')[0]).toMatchObject({
      outcome: 'failed',
      error: { type: 'provider.RateLimit', message: 'slow down' },
    })
  })

  it('fails the execution when the stored credential has expired, without calling the provider', async () => {
    const t = await start({
      integrationID: 'openai',
      label: 'oauth',
      type: 'oauth',
      access: 'tok',
      expires: Date.now() - 1000,
      methodID: 'oauth',
    })

    await t.app.command(prompt)
    await t.waitFor(() => t.types().includes('session-execution-settled'))

    expect(t.payloads('session-step-settled')[0]).toMatchObject({
      outcome: 'failed',
      error: { type: 'auth.credential-expired' },
    })
    expect(await t.requests()).toEqual([])
  })

  it('settles an open tool call as aborted atomically with the interrupt, and stays quiet after the call is released', async () => {
    const gate = Effect.runSync(Deferred.make<void>())
    const entered = Effect.runSync(Deferred.make<void>())
    const t = await start(undefined, {
      gate: Tool.make({
        description: 'Blocks until the test releases it.',
        input: Schema.Struct({}),
        output: Schema.Struct({ ok: Schema.Boolean }),
        execute: () =>
          Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(gate)),
            Effect.as({ ok: true }),
          ),
      }),
    })
    await Effect.runPromise(
      t.llm.push(
        toolCallsWith(
          usage(10, 5),
          executeCall('call_1', 'return await tools.gate({})'),
        ),
        stopWith(usage(20, 4), ...text('t2', 'unreachable')),
      ),
    )

    await t.app.command(prompt)
    await Effect.runPromise(Deferred.await(entered))
    await t.app.command({
      type: 'interruptExecution',
      payload: { sessionID: 'ses_1' },
    })

    const expected = [
      'session-inbox-enqueued',
      'session-execution-started',
      'session-inbox-delivered',
      'session-step-started',
      'session-tool-requested',
      'session-tool-settled',
      'session-step-settled', // the interrupted step, aborted
      'session-execution-settled',
    ]
    expect(t.types()).toEqual(expected)
    expect(t.payloads('session-tool-settled')[0]).toMatchObject({
      id: 'call_1',
      error: {
        type: 'aborted',
        message: 'Tool execution interrupted: execute',
      },
    })

    // Release the program: its late result is rejected (execution not
    // active), so nothing more is recorded and the model is never called again.
    await Effect.runPromise(Deferred.succeed(gate, undefined))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(t.types()).toEqual(expected)
    expect(await t.requests()).toHaveLength(1)
  })
})
