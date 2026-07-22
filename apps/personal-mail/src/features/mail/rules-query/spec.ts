import { createQuerySlice, event } from '@specter-ts/spec'

export default createQuerySlice('rulesQuery')
  .description('Lists the explicit rules that may authorize automatic actions.')
  .scenarios({
    description: 'Lists an enabled rule without widening its criteria.',
    given: [
      event('automation-rule-created', {
        ruleId: 'rule-1',
        name: 'Archive newsletters',
        senderContains: 'newsletter@example.com',
        subjectContains: '',
        action: 'archive',
        enabled: true,
        createdAt: '2026-07-22T12:02:00.000Z',
      }),
    ],
    when: {},
    expect: [
      {
        ruleId: 'rule-1',
        name: 'Archive newsletters',
        senderContains: 'newsletter@example.com',
        subjectContains: '',
        action: 'archive',
        enabled: true,
        createdAt: '2026-07-22T12:02:00.000Z',
      },
    ],
  })
