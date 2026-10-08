import type { TokenUsage } from '@ocpp/schema/token-usage'
import { Context, type Effect } from 'effect'

import type { ModelMessage } from '../features/session/model-transcript-query/impl.ts'

// What the step Plugin needs from a model, whether scripted or a real
// provider: one physical attempt in, one settled outcome out. Text deltas are
// pushed through `onText` as they arrive so the Plugin (which owns the
// DeltaChannel) can publish them; the outcome carries the final text.
export type ToolSpec = {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
}

export type ModelToolCall = {
  readonly id: string
  readonly name: string
  readonly input: Record<string, unknown>
}

export type ModelInput = {
  readonly sessionID: string
  readonly system: string
  readonly messages: readonly ModelMessage[]
  readonly tools: readonly ToolSpec[]
  readonly onText: (text: string) => Effect.Effect<void>
}

export type Outcome = {
  readonly text?: string
  readonly toolCalls?: readonly ModelToolCall[]
  readonly usage?: TokenUsage.Info
} & (
  | { readonly finish: 'tool-calls' | 'stop' | 'length' | 'unknown' }
  // A failed physical attempt. Whether it is worth retrying is the model
  // adapter's classification (session.md: Retry Is Narrow And Observable).
  | {
      readonly finish: 'error'
      readonly retryable: boolean
      readonly error: { type: string; message: string }
    }
)

export class Model extends Context.Service<
  Model,
  {
    // Recorded on step.started.
    readonly ref: { readonly id: string; readonly providerID: string }
    readonly nextOutcome: (input: ModelInput) => Effect.Effect<Outcome>
  }
>()('@specter/agent-runtime/Model') {}
