import { createCommandSlice, event } from '@specter-ts/spec'

const thread = event('gmail-thread-recorded', {
  threadId: 'thread-1',
  messageId: 'message-1',
  historyId: '101',
  sender: 'News <newsletter@example.com>',
  subject: 'Weekly update',
  snippet: 'This week...',
  bodyText: 'This week in the project...',
  receivedAt: '2026-07-22T12:00:00.000Z',
  unread: true,
  labels: ['INBOX', 'UNREAD'],
})

const rulePayload = {
  ruleId: 'rule-1',
  name: 'Archive newsletters',
  senderContains: 'newsletter@example.com',
  subjectContains: '',
  action: 'archive',
  enabled: true,
  createdAt: '2026-07-22T12:02:00.000Z',
} as const

const rule = event('automation-rule-created', rulePayload)

const requested = event('mailbox-action-requested', {
  actionId: 'action-1',
  threadId: 'thread-1',
  action: 'archive',
  source: 'automation',
  authorizedByRuleId: 'rule-1',
  requestedAt: '2026-07-22T12:03:00.000Z',
})

const command = {
  actionId: 'action-1',
  threadId: 'thread-1',
  action: 'archive' as const,
  source: 'automation' as const,
  authorizedByRuleId: 'rule-1',
  requestedAt: '2026-07-22T12:03:00.000Z',
}

export default createCommandSlice('requestMailboxAction')
  .description(
    'Requests a mailbox mutation only when the caller or a matching explicit rule authorizes it.',
  )
  .scenarios(
    {
      description:
        'Accepts an automatic action authorized by a matching enabled rule.',
      given: [thread, rule],
      when: command,
      expect: [requested],
    },
    {
      description:
        'Accepts a manual action without pretending a rule authorized it.',
      given: [thread],
      when: {
        ...command,
        source: 'manual',
        authorizedByRuleId: null,
      },
      expect: [
        event('mailbox-action-requested', {
          ...command,
          source: 'manual',
          authorizedByRuleId: null,
        }),
      ],
    },
    {
      description: 'Rejects an automatic action when its rule does not match.',
      given: [
        thread,
        event('automation-rule-created', {
          ...rulePayload,
          ruleId: 'rule-other',
          senderContains: 'other@example.com',
        }),
      ],
      when: { ...command, authorizedByRuleId: 'rule-other' },
      expect: [],
      reject: {
        reason: 'Automation rule does not authorize this thread and action',
      },
    },
    {
      description: 'Rejects a duplicate action identity while it is pending.',
      given: [thread, rule, requested],
      when: command,
      expect: [],
      reject: { reason: 'Mailbox action identity already exists' },
    },
    {
      description:
        'Retains applied outcomes when rejecting a repeated action identity.',
      given: [
        thread,
        rule,
        requested,
        event('mailbox-action-applied', {
          actionId: 'action-1',
          threadId: 'thread-1',
          action: 'archive',
          gmailHistoryId: '102',
          appliedAt: '2026-07-22T12:04:00.000Z',
        }),
      ],
      when: command,
      expect: [],
      reject: { reason: 'Mailbox action identity already exists' },
    },
    {
      description:
        'Retains failed outcomes when rejecting a repeated action identity.',
      given: [
        thread,
        rule,
        requested,
        event('mailbox-action-failed', {
          actionId: 'action-1',
          threadId: 'thread-1',
          action: 'archive',
          reason: 'Gmail rejected the request',
          failedAt: '2026-07-22T12:04:00.000Z',
        }),
      ],
      when: command,
      expect: [],
      reject: { reason: 'Mailbox action identity already exists' },
    },
    {
      description:
        'Retains ambiguous outcomes when rejecting a repeated action identity.',
      given: [
        thread,
        rule,
        requested,
        event('mailbox-action-reconciliation-needed', {
          actionId: 'action-1',
          threadId: 'thread-1',
          action: 'archive',
          reason: 'Connection closed after request started',
          detectedAt: '2026-07-22T12:04:00.000Z',
        }),
      ],
      when: command,
      expect: [],
      reject: { reason: 'Mailbox action identity already exists' },
    },
  )
