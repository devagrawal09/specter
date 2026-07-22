import { createCommandSlice, event } from '@specter-ts/spec'

export default createCommandSlice('recordIncomingTwilioMessage')
  .description('Records an inbound Twilio WhatsApp message once.')
  .scenarios(
    {
      description: 'Records a new inbound Twilio message.',
      given: [],
      when: {
        inboundMessageId: 'inbound-message-scenario-1',
        twilioMessageSid: 'SM-inbound-scenario-1',
        from: 'whatsapp:+155****0001',
        to: 'whatsapp:+141****8886',
        body: 'Namaste',
        receivedAt: '2026-06-29T10:00:00.000Z',
      },
      expect: [
        event('twilio-inbound-message-recorded', {
          inboundMessageId: 'inbound-message-scenario-1',
          twilioMessageSid: 'SM-inbound-scenario-1',
          from: 'whatsapp:+155****0001',
          to: 'whatsapp:+141****8886',
          body: 'Namaste',
          receivedAt: '2026-06-29T10:00:00.000Z',
        }),
      ],
    },
    {
      description: 'Ignores duplicate Twilio message SIDs.',
      given: [
        event('twilio-inbound-message-recorded', {
          inboundMessageId: 'inbound-duplicate-scenario-1',
          twilioMessageSid: 'SM-duplicate-scenario-1',
          from: 'whatsapp:+155****0001',
          to: 'whatsapp:+141****8886',
          body: 'Namaste',
          receivedAt: '2026-06-29T10:00:00.000Z',
        }),
      ],
      when: {
        inboundMessageId: 'inbound-duplicate-scenario-2',
        twilioMessageSid: 'SM-duplicate-scenario-1',
        from: 'whatsapp:+155****0001',
        to: 'whatsapp:+141****8886',
        body: 'Namaste again',
        receivedAt: '2026-06-29T10:01:00.000Z',
      },
      expect: [
        event('twilio-inbound-duplicate-ignored', {
          twilioMessageSid: 'SM-duplicate-scenario-1',
          from: 'whatsapp:+155****0001',
          to: 'whatsapp:+141****8886',
          body: 'Namaste again',
          receivedAt: '2026-06-29T10:01:00.000Z',
        }),
      ],
    },
  )
