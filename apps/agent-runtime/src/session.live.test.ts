import { ProjectID } from '@ocpp/schema/project-id'
import { SessionID } from '@ocpp/schema/session-id'
import { AbsolutePath } from '@ocpp/schema/schema'
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
import { Context, Effect, Exit, Layer, PubSub, Scope } from 'effect'
import { describe, expect, it } from 'vitest'

import { createSessionAppConfig, memorySliceStoreLayer } from './app.ts'
import { sessionEvent, sessionEventDefinitions } from './events.ts'
import type { RunStepRequest } from './features/session/run-step-reaction/impl.ts'
import { type Delta, DeltaChannel } from './plugins/delta-channel.ts'
import { Model } from './plugins/model.ts'
import {
  llmClientLayer,
  ocppAiModelLayer,
  type ProviderSelection,
} from './plugins/ocpp-ai-model.ts'
import {
  credentialFor,
  isExpired,
  OcppCredentialsLive,
  ocppDatabasePath,
  readCredentials,
} from './plugins/ocpp-credentials.ts'

// GATED live test: a real provider, OC++'s stored credential, the real Code
// Mode tool. It runs only when AGENT_RUNTIME_LIVE=1 is set AND OC++'s store
// has a non-expired credential for the chosen provider. It asserts only the
// durable event-type sequence and payload schema validity, never text.
//
//   AGENT_RUNTIME_LIVE=1 [AGENT_RUNTIME_LIVE_PROVIDER=openai|anthropic] \
//   [AGENT_RUNTIME_LIVE_MODEL=<model id>] pnpm --filter @specter/agent-runtime test

const selection: ProviderSelection = {
  providerID:
    process.env.AGENT_RUNTIME_LIVE_PROVIDER === 'anthropic'
      ? 'anthropic'
      : 'openai',
  modelID:
    process.env.AGENT_RUNTIME_LIVE_MODEL ??
    (process.env.AGENT_RUNTIME_LIVE_PROVIDER === 'anthropic'
      ? 'claude-sonnet-4-5'
      : 'gpt-5.4-mini'),
}

const skipReason = (): string | undefined => {
  if (process.env.AGENT_RUNTIME_LIVE !== '1')
    return 'AGENT_RUNTIME_LIVE=1 is not set'
  const outcome = readCredentials(ocppDatabasePath())
  if (outcome._tag === 'not-found')
    return `OC++'s credential store is unavailable (${outcome.reason}: ${outcome.path})`
  const credential = credentialFor(outcome, selection.providerID)
  if (!credential)
    return `OC++'s store has no ${selection.providerID} credential`
  if (isExpired(credential, Date.now()))
    return `the ${selection.providerID} credential in OC++'s store has expired`
  return undefined
}

const reason = skipReason()

// head, then steps (text block and Code Mode calls optional), then success.
const sequence =
  /^session-inbox-enqueued session-execution-started session-inbox-delivered( session-step-started( session-text-started session-text-ended)?( session-tool-input-started session-tool-input-ended session-tool-called session-tool-(success|failed))* session-step-ended)+ session-execution-succeeded$/

describe.skipIf(reason !== undefined)(
  reason === undefined
    ? `live ${selection.providerID}/${selection.modelID} through Code Mode`
    : `live (skipped: ${reason})`,
  () => {
    it('completes a session whose durable events follow the OC++ sequence and validate', async () => {
      const scope = Effect.runSync(Scope.make())
      const context = await Effect.runPromise(
        Layer.build(
          ocppAiModelLayer(selection).pipe(
            Layer.provide(Layer.mergeAll(llmClientLayer, OcppCredentialsLive)),
          ),
        ).pipe(Scope.provide(scope)),
      )
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
          Layer.succeed(Model, Context.get(context, Model)),
          Layer.succeed(DeltaChannel, { pubsub }),
        ),
      )
      try {
        await app.command({
          type: 'enqueueInput',
          payload: {
            sessionID: 'ses_1',
            inboxID: 'msg_a',
            type: 'user',
            payload: {
              text: 'Use the execute tool to call tools.echo with the text "ping", then reply with one short sentence.',
            },
          },
        })
        const deadline = Date.now() + 110_000
        const types = () =>
          log
            .inspect()
            .map((event) => event.type)
            .filter((type) => type !== 'session-created')
        while (
          !types().some(
            (type) =>
              type === 'session-execution-succeeded' ||
              type === 'session-execution-failed',
          )
        ) {
          if (Date.now() > deadline)
            throw new Error(`Timed out; events: ${types().join(' ')}`)
          await new Promise((resolve) => setTimeout(resolve, 100))
        }

        // Observed sequence only; provider-dependent text and ids are never
        // compared.
        expect(types().join(' ')).toMatch(sequence)
        for (const event of log.inspect()) {
          const definition = sessionEventDefinitions.find(
            (candidate) => candidate.type === event.type,
          )
          expect(definition, event.type).toBeDefined()
          await expect(definition?.decode(event.payload)).resolves.toBeDefined()
        }
      } finally {
        await app.close()
        await Effect.runPromise(Scope.close(scope, Exit.void))
      }
    }, 120_000)
  },
)
