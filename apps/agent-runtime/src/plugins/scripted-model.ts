import { Effect } from 'effect'

import type { Model, ModelInput, Outcome } from './model.ts'

// M1 stand-in for a provider and one implementation of the Model service: a
// per-Session queue of fixed outcomes. 'stop' means the execution is done
// after this step; 'tool-calls' means another step follows. No LLM, no
// @ocpp/ai.
export type ScriptedOutcome = Outcome & {
  // Test hook: the step stays in flight until this settles.
  gate?: Promise<void>
}

export type ScriptedModel = Model['Service'] & {
  script(sessionID: string, outcomes: readonly ScriptedOutcome[]): void
}

export const makeScriptedModel = (): ScriptedModel => {
  const queues = new Map<string, ScriptedOutcome[]>()
  return {
    ref: { id: 'scripted', providerID: 'test' },
    script: (sessionID, outcomes) => {
      queues.set(sessionID, [...(queues.get(sessionID) ?? []), ...outcomes])
    },
    // An exhausted script ends the execution rather than looping forever.
    nextOutcome: (input: ModelInput) =>
      Effect.gen(function* () {
        const { gate, ...outcome }: ScriptedOutcome = queues
          .get(input.sessionID)
          ?.shift() ?? { finish: 'stop' }
        if (gate) yield* Effect.promise(() => gate)
        // The scripted text arrives as one delta, after the gate.
        if (outcome.text !== undefined) yield* input.onText(outcome.text)
        return outcome
      }),
  }
}
