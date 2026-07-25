import { createCommandSlice, event } from '@specter-ts/spec'

export default createCommandSlice('recordThreadAnalysis')
  .description('Records an AI analysis returned by the selected provider.')
  .scenarios({
    description: 'Records the provider and structured analysis exactly.',
    given: [],
    when: {
      analysisId: 'analysis-1',
      threadId: 'thread-1',
      provider: 'local',
      summary: 'A project update needs review.',
      priority: 'high',
      suggestedAction: 'reply',
      analyzedAt: '2026-07-22T12:01:00.000Z',
    },
    expect: [
      event('thread-analyzed', {
        analysisId: 'analysis-1',
        threadId: 'thread-1',
        provider: 'local',
        summary: 'A project update needs review.',
        priority: 'high',
        suggestedAction: 'reply',
        analyzedAt: '2026-07-22T12:01:00.000Z',
      }),
    ],
  })
