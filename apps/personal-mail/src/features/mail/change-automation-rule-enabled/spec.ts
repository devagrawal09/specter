import { createCommandSlice, event } from '@specter-ts/spec'

const created = event('automation-rule-created', {
  ruleId: 'rule-1',
  name: 'Archive newsletters',
  senderContains: 'newsletter@example.com',
  subjectContains: '',
  action: 'archive',
  enabled: true,
  createdAt: '2026-07-22T12:02:00.000Z',
})

export default createCommandSlice('changeAutomationRuleEnabled')
  .description(
    'Changes whether a rule may authorize automatic mailbox actions.',
  )
  .scenarios(
    {
      description: 'Revokes previously granted automation authority.',
      given: [created],
      when: {
        ruleId: 'rule-1',
        enabled: false,
        changedAt: '2026-07-22T12:03:00.000Z',
      },
      expect: [
        event('automation-rule-enabled-changed', {
          ruleId: 'rule-1',
          enabled: false,
          changedAt: '2026-07-22T12:03:00.000Z',
        }),
      ],
    },
    {
      description: 'Rejects a change for an unknown rule.',
      given: [],
      when: {
        ruleId: 'rule-missing',
        enabled: false,
        changedAt: '2026-07-22T12:03:00.000Z',
      },
      expect: [],
      reject: { reason: 'Automation rule is not known' },
    },
    {
      description: 'Restores previously revoked automation authority.',
      given: [
        created,
        event('automation-rule-enabled-changed', {
          ruleId: 'rule-1',
          enabled: false,
          changedAt: '2026-07-22T12:03:00.000Z',
        }),
      ],
      when: {
        ruleId: 'rule-1',
        enabled: true,
        changedAt: '2026-07-22T12:04:00.000Z',
      },
      expect: [
        event('automation-rule-enabled-changed', {
          ruleId: 'rule-1',
          enabled: true,
          changedAt: '2026-07-22T12:04:00.000Z',
        }),
      ],
    },
  )
