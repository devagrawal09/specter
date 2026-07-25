import { createQuerySlice, event } from '@specter-ts/spec'

export default createQuerySlice('activityQuery')
  .description('Projects auditable AI and mailbox-action lifecycle status.')
  .scenarios({
    description: 'Shows completed, failed, and ambiguous outcomes distinctly.',
    given: [
      event('thread-analysis-requested', {
        analysisId: 'analysis-1',
        threadId: 'thread-1',
        provider: 'local',
        requestedAt: '2026-07-22T12:01:00.000Z',
      }),
      event('thread-analyzed', {
        analysisId: 'analysis-1',
        threadId: 'thread-1',
        provider: 'local',
        summary: 'Needs review.',
        priority: 'high',
        suggestedAction: 'reply',
        analyzedAt: '2026-07-22T12:01:10.000Z',
      }),
      event('mailbox-action-requested', {
        actionId: 'action-1',
        threadId: 'thread-1',
        action: 'archive',
        source: 'automation',
        authorizedByRuleId: 'rule-1',
        requestedAt: '2026-07-22T12:03:00.000Z',
      }),
      event('mailbox-action-applied', {
        actionId: 'action-1',
        threadId: 'thread-1',
        action: 'archive',
        gmailHistoryId: '102',
        appliedAt: '2026-07-22T12:04:00.000Z',
      }),
      event('mailbox-action-requested', {
        actionId: 'action-2',
        threadId: 'thread-2',
        action: 'star',
        source: 'manual',
        authorizedByRuleId: null,
        requestedAt: '2026-07-22T12:05:00.000Z',
      }),
      event('mailbox-action-failed', {
        actionId: 'action-2',
        threadId: 'thread-2',
        action: 'star',
        reason: 'Gmail rejected the request',
        failedAt: '2026-07-22T12:05:10.000Z',
      }),
      event('mailbox-action-requested', {
        actionId: 'action-3',
        threadId: 'thread-3',
        action: 'markRead',
        source: 'manual',
        authorizedByRuleId: null,
        requestedAt: '2026-07-22T12:06:00.000Z',
      }),
      event('mailbox-action-reconciliation-needed', {
        actionId: 'action-3',
        threadId: 'thread-3',
        action: 'markRead',
        reason: 'Connection closed after request started',
        detectedAt: '2026-07-22T12:06:10.000Z',
      }),
    ],
    when: { limit: 10 },
    expect: [
      {
        activityId: 'action:action-3',
        threadId: 'thread-3',
        kind: 'mailboxAction',
        status: 'reconciliationNeeded',
        detail: 'markRead: Connection closed after request started',
        occurredAt: '2026-07-22T12:06:10.000Z',
      },
      {
        activityId: 'action:action-2',
        threadId: 'thread-2',
        kind: 'mailboxAction',
        status: 'failed',
        detail: 'star: Gmail rejected the request',
        occurredAt: '2026-07-22T12:05:10.000Z',
      },
      {
        activityId: 'action:action-1',
        threadId: 'thread-1',
        kind: 'mailboxAction',
        status: 'applied',
        detail: 'archive: Gmail history 102',
        occurredAt: '2026-07-22T12:04:00.000Z',
      },
      {
        activityId: 'analysis:analysis-1',
        threadId: 'thread-1',
        kind: 'analysis',
        status: 'complete',
        detail: 'local: Needs review.',
        occurredAt: '2026-07-22T12:01:10.000Z',
      },
    ],
  })
