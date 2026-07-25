import type { ReactionPlugin } from '@specter-ts/core'
import { Context, Effect } from 'effect'

import type { AnalyzeThreadEffect } from './impl'

export type ThreadAnalysis = {
  summary: string
  priority: 'low' | 'normal' | 'high'
  suggestedAction: 'none' | 'archive' | 'markRead' | 'star' | 'reply'
}

export class AiAnalyzer extends Context.Service<
  AiAnalyzer,
  { analyze(effect: AnalyzeThreadEffect): Promise<ThreadAnalysis> }
>()('@specter/personal-mail/AiAnalyzer') {}

export const analyzeThreadPlugin: ReactionPlugin<{
  type: 'analyzeThread'
  payload: AnalyzeThreadEffect
}> = (command) =>
  Effect.gen(function* () {
    const analyzer = yield* AiAnalyzer
    return (output, context) =>
      Effect.gen(function* () {
        const analysis = yield* Effect.tryPromise(() =>
          analyzer.analyze(output.payload),
        )
        yield* command(
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
      })
  })
