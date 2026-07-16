import { createCommandSlice, event } from '@specter-ts/core/spec'

export default createCommandSlice('recordTwilioMessageSent')
  .description('Records a successful Twilio outbound send.')
  .scenarios({
    description: 'Records Twilio send status.',
    given: [],
    when: {
      outboundMessageId: 'outbound-sent-scenario-1',
      twilioMessageSid: 'SM-sent-scenario-1',
      status: 'delivered',
      sentAt: '2026-06-29T10:02:00.000Z',
    },
    expect: [
      event('twilio-outbound-message-sent', {
        outboundMessageId: 'outbound-sent-scenario-1',
        twilioMessageSid: 'SM-sent-scenario-1',
        status: 'delivered',
        sentAt: '2026-06-29T10:02:00.000Z',
      }),
    ],
  })
