import { createReactionSlice, event } from '@specter-ts/spec'

const requested = event('mailbox-action-requested', {
  actionId: 'action-1',
  threadId: 'thread-1',
  action: 'archive',
  source: 'automation',
  authorizedByRuleId: 'rule-1',
  requestedAt: '2026-07-22T12:03:00.000Z',
})

export default createReactionSlice('applyMailboxActionReaction')
  .description('Applies pending label mutations through the Gmail adapter.')
  .scenarios(
    {
      description: 'Applies the oldest pending Gmail label mutation.',
      given: [requested],
      expect: [
        {
          type: 'applyMailboxAction',
          payload: {
            actionId: 'action-1',
            threadId: 'thread-1',
            action: 'archive',
            source: 'automation',
            authorizedByRuleId: 'rule-1',
          },
        },
      ],
    },
    {
      description: 'Does not apply an action again after confirmation.',
      given: [
        requested,
        event('mailbox-action-applied', {
          actionId: 'action-1',
          threadId: 'thread-1',
          action: 'archive',
          gmailHistoryId: '102',
          appliedAt: '2026-07-22T12:04:00.000Z',
        }),
      ],
      expect: [],
    },
    {
      description: 'Does not retry a definitively failed action automatically.',
      given: [
        requested,
        event('mailbox-action-failed', {
          actionId: 'action-1',
          threadId: 'thread-1',
          action: 'archive',
          reason: 'Gmail rejected the request',
          failedAt: '2026-07-22T12:04:00.000Z',
        }),
      ],
      expect: [],
    },
    {
      description: 'Waits for reconciliation after an ambiguous result.',
      given: [
        requested,
        event('mailbox-action-reconciliation-needed', {
          actionId: 'action-1',
          threadId: 'thread-1',
          action: 'archive',
          reason: 'Connection closed after request started',
          detectedAt: '2026-07-22T12:04:00.000Z',
        }),
      ],
      expect: [],
    },
  )
