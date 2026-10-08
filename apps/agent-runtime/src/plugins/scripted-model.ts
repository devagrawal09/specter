import { Context, Effect, Layer } from 'effect'

// M1 stand-in for a provider: a per-Session queue of fixed outcomes. 'stop'
// means the execution is done after this step; 'tool-calls' means another step
// follows. No LLM, no @ocpp/ai.
export type ScriptedOutcome = {
  finish: 'tool-calls' | 'stop'
  text?: string
  // Test hook: the step stays in flight until this settles.
  gate?: Promise<void>
}

export class ScriptedModel extends Context.Service<
  ScriptedModel,
  {
    script(sessionID: string, outcomes: readonly ScriptedOutcome[]): void
    next(sessionID: string): Effect.Effect<ScriptedOutcome>
  }
>()('@specter/agent-runtime/ScriptedModel') {}

export const makeScriptedModel = (): ScriptedModel['Service'] => {
  const queues = new Map<string, ScriptedOutcome[]>()
  return {
    script: (sessionID, outcomes) => {
      queues.set(sessionID, [...(queues.get(sessionID) ?? []), ...outcomes])
    },
    // An exhausted script ends the execution rather than looping forever.
    next: (sessionID) =>
      Effect.promise(async () => {
        const outcome = queues.get(sessionID)?.shift() ?? { finish: 'stop' }
        if (outcome.gate) await outcome.gate
        return outcome
      }),
  }
}

export const scriptedModelLayer = Layer.sync(ScriptedModel, makeScriptedModel)
