import { describe, expect, it } from 'vitest'
import type { CommandScenario, QueryScenario } from '@specter-ts/spec'

import { createFusedReactivityApp } from './app'
import { reactiveNodeValue } from './features/reactivity/reactive-node-value/impl'
import { reactiveRegistrations } from './features/reactivity/registrations'
import { reactiveStore } from './features/reactivity/state'
import {
  FusedCommandRejectedError,
  type FusedSyncRuntime,
} from './runtime/fused-runtime'
import type { FusedEventDraft } from './runtime/fused-slices'

describe('approved reactive Slice specifications', () => {
  for (const slice of Object.values(reactiveRegistrations)) {
    describe(slice.name, () => {
      for (const scenario of slice.scenarios) {
        it(scenario.description, () => {
          const runtime = createFusedReactivityApp()
          registerScenarioCallbacks(runtime)
          runtime.replay(
            scenario.given.map((given) => ({
              type: given.eventType,
              payload: given.examplePayload,
            })),
          )
          const before = runtime.version

          if (slice.kind === 'query') {
            const queryScenario = scenario as QueryScenario
            expect(
              runtime.queryEnvelope(slice.name, queryScenario.when),
            ).toEqual(queryScenario.expect)
            return
          }

          const commandScenario = scenario as CommandScenario
          if (commandScenario.reject) {
            let rejection: unknown
            try {
              runtime.commandEnvelope(slice.name, commandScenario.when)
            } catch (error) {
              rejection = error
            }
            expect(rejection).toBeInstanceOf(FusedCommandRejectedError)
            expect((rejection as FusedCommandRejectedError).reason).toBe(
              commandScenario.reject.reason,
            )
            expect(runtime.eventsAfter(before)).toEqual([])
            return
          }

          runtime.commandEnvelope(slice.name, commandScenario.when)
          expect(runtime.eventsAfter(before)).toEqual(
            commandScenario.expect.map(
              (expected): FusedEventDraft => ({
                type: expected.eventType,
                payload: expected.examplePayload,
              }),
            ),
          )
        })
      }
    })
  }
})

function registerScenarioCallbacks(runtime: FusedSyncRuntime): void {
  const graphId = 'graph-1'
  const state = runtime.state(reactiveStore)
  const read = (nodeId: string) =>
    runtime.query(reactiveNodeValue, { graphId, nodeId })
  const number = (nodeId: string) => read(nodeId) as number
  const boolean = (nodeId: string) => read(nodeId) as boolean
  const observe = (nodeId: string) => () => {
    read(nodeId)
    return undefined
  }

  const callbacks = {
    'double-signal-1': () => number('signal-1') * 2,
    'observe-computed-1': observe('computed-1'),
    'sum-left-right': () => number('left') + number('right'),
    'head-plus-one': () => number('head') + 1,
    'head-times-two': () => number('head') * 2,
    'observe-sum': observe('sum'),
    'constant-zero-from-head': () => {
      read('head')
      return 0
    },
    'expensive-constant-plus-one': () => number('constant') + 1,
    'observe-downstream': observe('downstream'),
    'select-left-or-right': () =>
      boolean('selector') ? number('right') : number('left'),
    'read-head-three-times': () =>
      number('head') + number('head') + number('head'),
    'double-head': () => number('head') * 2,
  } as const

  for (const [callbackId, callback] of Object.entries(callbacks)) {
    state.registerCallback(graphId, callbackId, callback)
  }
}
