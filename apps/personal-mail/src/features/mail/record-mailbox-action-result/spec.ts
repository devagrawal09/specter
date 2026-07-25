import { createCommandSlice, event } from '@specter-ts/spec'

const base = {
  actionId: 'action-1',
  threadId: 'thread-1',
  action: 'archive' as const,
}

export default createCommandSlice('recordMailboxActionResult')
  .description(
    'Records a Gmail mutation result without claiming exactly-once delivery.',
  )
  .scenarios(
    {
      description: 'Records a confirmed Gmail mutation.',
      given: [],
      when: {
        ...base,
        status: 'applied',
        gmailHistoryId: '102',
        reason: '',
        occurredAt: '2026-07-22T12:04:00.000Z',
      },
      expect: [
        event('mailbox-action-applied', {
          ...base,
          gmailHistoryId: '102',
          appliedAt: '2026-07-22T12:04:00.000Z',
        }),
      ],
    },
    {
      description: 'Records a definitive Gmail rejection.',
      given: [],
      when: {
        ...base,
        status: 'failed',
        gmailHistoryId: '',
        reason: 'Gmail rejected the request',
        occurredAt: '2026-07-22T12:04:00.000Z',
      },
      expect: [
        event('mailbox-action-failed', {
          ...base,
          reason: 'Gmail rejected the request',
          failedAt: '2026-07-22T12:04:00.000Z',
        }),
      ],
    },
    {
      description: 'Records an ambiguous mutation for reconciliation.',
      given: [],
      when: {
        ...base,
        status: 'reconciliationNeeded',
        gmailHistoryId: '',
        reason: 'Connection closed after request started',
        occurredAt: '2026-07-22T12:04:00.000Z',
      },
      expect: [
        event('mailbox-action-reconciliation-needed', {
          ...base,
          reason: 'Connection closed after request started',
          detectedAt: '2026-07-22T12:04:00.000Z',
        }),
      ],
    },
  )
