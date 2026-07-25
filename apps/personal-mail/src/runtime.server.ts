import {
  createSpecterApp,
  EventLog,
  type ReactionPlugin,
  type SpecterApp,
} from '@specter-ts/core'
import {
  createReactionOutboxWorker,
  type OutboxedReaction,
  type ReactionOutboxStore,
  type ReactionOutboxWorkerOptions,
  runReactionOutboxWorker,
} from '@specter-ts/reaction-outbox'
import {
  createSqliteReactionSchedulerLayer,
  createSpecterSqlitePersistence,
  prepareSqliteReactionScheduler,
  prepareSpecterSqlite,
} from '@specter-ts/sqlite'
import { Effect, Layer } from 'effect'

import { createAiAnalyzer } from './adapters/ai.server'
import { createGmailService, type GmailService } from './adapters/gmail.server'
import { openApplicationDatabase } from './db/client.server'
import { createSqliteSliceStoreLayer } from './db/specter-sqlite'
import { AiAnalyzer } from './features/mail/analyze-thread-reaction/plugin.server'
import type { ApplyMailboxActionEffect } from './features/mail/apply-mailbox-action-reaction/impl'
import {
  GmailActions,
  type GmailActionResult,
} from './features/mail/apply-mailbox-action-reaction/plugin.server'
import type { MailDeliveryOutput } from './features/mail/delivery-plugin.server'
import {
  createMailSpecterAppConfig,
  type MailSpecterAppConfig,
} from './features/mail/registry'

type AiAnalyzerService = ReturnType<typeof createAiAnalyzer>
type GmailActionsService = {
  apply(
    effect: ApplyMailboxActionEffect,
    deliveryId: string,
  ): Promise<GmailActionResult>
}

export type PersonalMailRuntimeOptions = {
  sqlitePath?: string
  env?: NodeJS.ProcessEnv
  gmailFetch?: typeof fetch
  gmailSleep?: (milliseconds: number) => Promise<void>
  aiAnalyzer?: AiAnalyzerService
  gmailActions?: GmailActionsService
  outboxWorker?: Omit<
    ReactionOutboxWorkerOptions<OutboxedReaction<MailDeliveryOutput>>,
    'store' | 'handle' | 'signal'
  >
  outboxPollIntervalMs?: number
}

export type PersonalMailRuntime = {
  app: SpecterApp<MailSpecterAppConfig>
  gmail: GmailService
  outbox: ReactionOutboxStore<OutboxedReaction<MailDeliveryOutput>>
  close(): Promise<void>
}

export async function createPersonalMailRuntime(
  options: PersonalMailRuntimeOptions = {},
): Promise<PersonalMailRuntime> {
  const env = options.env ?? process.env
  const { client: sqliteClient, db } = openApplicationDatabase(
    options.sqlitePath,
  )
  await prepareSpecterSqlite(sqliteClient)
  await prepareSqliteReactionScheduler(sqliteClient)

  const gmail = createGmailService({
    db,
    env,
    fetch: options.gmailFetch,
    sleep: options.gmailSleep,
  })
  const persistence = createSpecterSqlitePersistence(sqliteClient)
  const outbox =
    persistence.createReactionOutboxStore<
      OutboxedReaction<MailDeliveryOutput>
    >()
  const enqueueDelivery: ReactionPlugin<MailDeliveryOutput> = () =>
    Effect.succeed((output, context) =>
      Effect.gen(function* () {
        const requestedAt = new Date(context.scheduledAt)
        if (Number.isNaN(requestedAt.getTime())) {
          throw new Error('Reaction scheduledAt must be ISO-8601')
        }
        yield* outbox.enqueue({
          id: context.deliveryId,
          idempotencyKey: context.deliveryId,
          payload: { output, context },
          requestedAt,
          availableAt: requestedAt,
        })
      }),
    )
  const config = createMailSpecterAppConfig(enqueueDelivery)

  let resolveApp: ((app: SpecterApp<MailSpecterAppConfig>) => void) | undefined
  const appReady = new Promise<SpecterApp<MailSpecterAppConfig>>((resolve) => {
    resolveApp = resolve
  })
  const gmailActions =
    options.gmailActions ??
    ({
      apply: async (effect, deliveryId) => {
        if (effect.source === 'automation') {
          const app = await appReady
          const rules = await app.query({ type: 'rulesQuery', payload: {} })
          const rule = rules.find(
            (candidate) => candidate.ruleId === effect.authorizedByRuleId,
          )
          if (!rule?.enabled) {
            return {
              status: 'failed' as const,
              reason: 'Automation authority was revoked before delivery',
            }
          }
        }
        return gmail.applyMailboxAction(effect, deliveryId)
      },
    } satisfies GmailActionsService)
  const analyzer = options.aiAnalyzer ?? createAiAnalyzer({ env })

  const app = await createSpecterApp(
    config,
    Layer.mergeAll(
      Layer.succeed(EventLog, persistence.eventLog),
      createSqliteReactionSchedulerLayer(sqliteClient, {
        context: persistence.context,
      }),
      createSqliteSliceStoreLayer(persistence.context),
      Layer.succeed(AiAnalyzer, analyzer),
      Layer.succeed(GmailActions, gmailActions),
    ),
  )
  resolveApp?.(app)
  const deliveryController = new AbortController()
  const deliveryWorker = createReactionOutboxWorker({
    ...(options.outboxWorker ?? {
      maxAttempts: 5,
      leaseMs: 90_000,
      backoffMs: (attemptNumber) =>
        Math.min(60_000, 1_000 * 2 ** (attemptNumber - 1)),
    }),
    store: outbox,
    signal: deliveryController.signal,
    handle: async (delivery) => {
      const { output, context } = delivery
      if (output.type === 'analyzeThread') {
        const analysis = await analyzer.analyze(output.payload)
        await app.command(
          {
            type: 'recordThreadAnalysis',
            payload: {
              analysisId: output.payload.analysisId,
              threadId: output.payload.threadId,
              provider: output.payload.provider,
              ...analysis,
              analyzedAt: context.scheduledAt,
            },
          },
          { idempotencyKey: `${context.deliveryId}:analysis` },
        )
        return
      }
      const result = await gmailActions.apply(
        output.payload,
        context.deliveryId,
      )
      await app.command(
        {
          type: 'recordMailboxActionResult',
          payload: {
            actionId: output.payload.actionId,
            threadId: output.payload.threadId,
            action: output.payload.action,
            status: result.status,
            gmailHistoryId:
              result.status === 'applied' ? result.gmailHistoryId : '',
            reason: result.status === 'applied' ? '' : result.reason,
            occurredAt: context.scheduledAt,
          },
        },
        { idempotencyKey: `${context.deliveryId}:result` },
      )
    },
  })
  const deliveryWorkerTask = runReactionOutboxWorker(deliveryWorker, {
    signal: deliveryController.signal,
    pollIntervalMs: options.outboxPollIntervalMs ?? 500,
    onError: logOutboxError,
  })

  return {
    app,
    gmail,
    outbox,
    async close() {
      deliveryController.abort()
      await deliveryWorkerTask
      await app.close()
      sqliteClient.close()
    },
  }
}

function logOutboxError(cause: unknown) {
  const nested =
    cause instanceof Error && cause.cause instanceof Error
      ? `: ${cause.cause.message}`
      : ''
  console.error(
    '[personal-mail delivery]',
    cause instanceof Error ? `${cause.message}${nested}` : cause,
  )
}
