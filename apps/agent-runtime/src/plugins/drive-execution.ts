import {
  type ReactionPlugin,
  SpecterCommandRejectedError,
} from '@specter-ts/core'
import { Effect } from 'effect'

import type { DriveExecutionRequest } from '../features/session/drive-execution-reaction/impl.ts'
import { executionStatus } from '../features/session/execution-status-query/impl.ts'
import { nextStep } from '../features/session/next-step-query/impl.ts'
import { StepHost } from './step-host.ts'

// A rejected Command means the world moved on (the execution was interrupted
// meanwhile): stop quietly.
const unlessRejected = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.asVoid,
    Effect.catch((error) =>
      error instanceof SpecterCommandRejectedError
        ? Effect.void
        : Effect.fail(error),
    ),
  )

// One job = one execution of a Session an external agent runs: the host
// drives it whole (delivery included, through the facts it records), and the
// runtime settles the execution from the outcome.
export const makeDriveExecutionPlugin =
  (): ReactionPlugin<DriveExecutionRequest, StepHost> =>
  ({ command, query }) =>
    Effect.gen(function* () {
      const host = yield* StepHost
      return (request, delivery) =>
        Effect.gen(function* () {
          const { sessionID, execution } = request.payload
          // A duplicate request, or one for an execution that has settled.
          const status = yield* query(executionStatus, { sessionID })
          if (status.status !== 'active' || status.executions !== execution)
            return
          const key = (outcome: string) => ({
            idempotencyKey: `${delivery.deliveryId}:${outcome}`,
          })
          const fail = (error: { type: string; message: string }) =>
            unlessRejected(
              command(
                { type: 'failExecution', payload: { sessionID, error } },
                key('failed'),
              ),
            )
          if (host.drive === undefined)
            return yield* fail({
              type: 'driver.unavailable',
              message: 'This host does not run external agents',
            })
          // An execution that continues an interrupted turn takes steers and
          // queued control items only.
          const { boundary } = yield* query(nextStep, { sessionID })
          const outcome = yield* host.drive({
            sessionID,
            continues: boundary === 'entry',
          })
          switch (outcome.outcome) {
            case 'succeeded':
              return yield* unlessRejected(
                command(
                  { type: 'finishExecution', payload: { sessionID } },
                  key('finished'),
                ),
              )
            case 'failed':
              return yield* fail(outcome.error)
            case 'interrupted':
              return yield* unlessRejected(
                command(
                  { type: 'interruptExecution', payload: { sessionID } },
                  key('interrupted'),
                ),
              )
            case 'stopped':
              return
          }
        })
    })
