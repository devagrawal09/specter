import { createCommandSlice, event } from '@specter-ts/spec'

export default createCommandSlice('recordTwilioMessageFailed')
  .description('Records a failed Twilio outbound send.')
  .scenarios({
    description: 'Records Twilio send failures.',
    given: [],
    when: {
      outboundMessageId: 'outbound-failed-scenario-1',
      error: 'Twilio rejected the message',
      failedAt: '2026-06-29T10:03:00.000Z',
    },
    expect: [
      event('twilio-outbound-message-failed', {
        outboundMessageId: 'outbound-failed-scenario-1',
        error: 'Twilio rejected the message',
        failedAt: '2026-06-29T10:03:00.000Z',
      }),
    ],
  })
