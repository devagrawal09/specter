import { createCommandSlice, event } from '@specter-ts/spec'

export default createCommandSlice('createAutomationRule')
  .description('Creates explicit authority for one class of mailbox mutation.')
  .scenarios(
    {
      description: 'Creates a narrow enabled sender rule.',
      given: [],
      when: {
        ruleId: 'rule-1',
        name: 'Archive newsletters',
        senderContains: 'newsletter@example.com',
        subjectContains: '',
        action: 'archive',
        enabled: true,
        createdAt: '2026-07-22T12:02:00.000Z',
      },
      expect: [
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
    },
    {
      description: 'Rejects a rule that would authorize every message.',
      given: [],
      when: {
        ruleId: 'rule-all',
        name: 'Everything',
        senderContains: ' ',
        subjectContains: '',
        action: 'archive',
        enabled: true,
        createdAt: '2026-07-22T12:02:00.000Z',
      },
      expect: [],
      reject: { reason: 'A rule must match a sender or subject' },
    },
  )
