import { createQuerySlice, event } from '@specter-ts/spec'

const created = event('automation-rule-created', {
  ruleId: 'rule-1',
  name: 'Archive newsletters',
  senderContains: 'newsletter@example.com',
  subjectContains: '',
  action: 'archive',
  enabled: true,
  createdAt: '2026-07-22T12:02:00.000Z',
})

const projectedRule = {
  ruleId: 'rule-1',
  name: 'Archive newsletters',
  senderContains: 'newsletter@example.com',
  subjectContains: '',
  action: 'archive' as const,
  enabled: true,
  createdAt: '2026-07-22T12:02:00.000Z',
}

export default createQuerySlice('rulesQuery')
  .description('Lists the explicit rules that may authorize automatic actions.')
  .scenarios(
    {
      description: 'Lists an enabled rule without widening its criteria.',
      given: [created],
      when: {},
      expect: [projectedRule],
    },
    {
      description: 'Shows that previously granted authority was disabled.',
      given: [
        created,
        event('automation-rule-enabled-changed', {
          ruleId: 'rule-1',
          enabled: false,
          changedAt: '2026-07-22T12:03:00.000Z',
        }),
      ],
      when: {},
      expect: [{ ...projectedRule, enabled: false }],
    },
  )
